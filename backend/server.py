# server.py -- station sol PwnSat, serveur local.
#
# REGLE DU PROJET (explicite, revisee le 2026-10-11) : le lien officiel
# "Ground Station" -- le Ground Station Shell (ping/status/nav/fw/thruster/
# beacon) et tout ce qui passe par le pont Heltec -- reste et restera 100%
# radio, jamais de repli USB. Separement, ce serveur peut aussi ouvrir une
# console USB directe Mac<->FlatSat (/dev/cu.usbmodemfsat1) : un lien de
# debug distinct, choisi explicitement par l'auteur, qui n'a jamais ete et
# ne sera jamais mélangé au chemin radio. Les deux liens sont independants :
# ce fichier ouvre deux ports serie, chacun dans son propre thread, chacun
# avec son propre WebSocket, et aucune commande ne passe de l'un a l'autre.
# Voir note 23 du vault pour l'historique de cette regle.
#
# - Lit le pont radio Heltec (lignes "RX <hex> RSSI=.. SNR=..", "TXDONE ..",
#   "TXERR ..") et diffuse la telemetrie decodee en WebSocket (/ws/telemetry).
# - Le meme canal accepte des commandes shell tapees sur la page, qu'il
#   construit et chiffre puis envoie par radio.
# - Lit en parallele la console USB du FlatSat (si branchee) et diffuse ses
#   lignes brutes en WebSocket (/ws/usb_console) ; accepte aussi des lignes
#   tapees sur la page, envoyees telles quelles sur ce port (SC STATUS,
#   SC INJECT, menu texte, etc. -- c'est une vraie console, pas un protocole
#   filtre).
# - Sert la page web statique.
#
# Reutilise PWNSAT-C3/pwnsat_tools pour tout ce qui est protocole/crypto --
# aucune logique SPP/AES reimplementee ici.
import asyncio
import json
import os
import sys
import threading
import time
from pathlib import Path

import serial
import serial.tools.list_ports
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "PWNSAT-C3" / "pwnsat_tools"))
sys.path.insert(0, str(REPO_ROOT / "FlatSat" / "Attacks" / "lib"))
from spp_tools import decode_packet  # noqa: E402
from pwnsat_crypto import decrypt_payload  # noqa: E402
from pwnsat_packets import build_command_packet  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from decode import DECODERS  # noqa: E402

# Port du pont Heltec, configurable par variable d'environnement. C'est le
# SEUL port serie que ce serveur ouvre. Sous Windows, un nom du type "COM5"
# (Gestionnaire de peripheriques) ; sous Linux, "/dev/ttyUSB0".
#   HELTEC_PORT=COM5 python -m uvicorn server:app


def _autodetect_port(name_hint: str, default: str) -> str:
    """Cherche un port serie dont la description USB contient name_hint
    (insensible a la casse). Fonctionne sur macOS/Linux/Windows -- pyserial
    expose les memes descriptions partout. Retourne `default` si rien trouve."""
    for p in serial.tools.list_ports.comports():
        if name_hint.lower() in (p.description or "").lower():
            return p.device
    return default


_HELTEC_PORT_ENV = os.environ.get("HELTEC_PORT")


def resolve_heltec_port() -> str:
    """Si HELTEC_PORT est fixe en variable d'environnement, toujours
    l'utiliser tel quel. Sinon, re-detecte a chaque appel -- utile si
    l'appareil a ete debranche/rebranche et a change de chemin OS."""
    return _HELTEC_PORT_ENV or _autodetect_port("CP210", "/dev/cu.usbserial-0001")


HELTEC_PORT = resolve_heltec_port()
BAUD = 115200

# Port USB direct vers la console FlatSat (fsat1), independant du pont
# Heltec. Pas d'autodetection par description : fsat1 (console) et fsat3
# (lien binaire SPP) partagent la meme description USB, et se tromper de
# port enverrait du texte brut sur le lien binaire. Chemin fixe + variable
# d'environnement, comme pour le Heltec.
FLATSAT_USB_PORT = os.environ.get("FLATSAT_USB_PORT", "/dev/cu.usbmodemfsat1")
FLATSAT_USB_BAUD = 921600

RADIO_CONFIG = {
    "downlink_mhz": 916, "uplink_mhz": 918,
    "bw_khz": 250, "sf": 7, "cr": "4/5",
}

app = FastAPI()
loop: asyncio.AbstractEventLoop | None = None

telemetry_clients: set[WebSocket] = set()
heltec_serial: serial.Serial | None = None
tc_seq = 20000  # compteur de sequence TC, part haut pour ne pas croiser le trafic normal

usb_console_clients: set[WebSocket] = set()
flatsat_usb_serial: serial.Serial | None = None

# APID -> nom de commande pwnsat_packets, et quels champs du shell
# deviennent quels overrides de build_command_packet.
COMMANDS = {
    "ping": {"command": "ping"},
    "status": {"command": "status"},
    "nav": {"command": "nav"},
    "fw": {"command": "fw"},
    "thruster0": {"command": "thruster", "thruster_id": 0},
    "thruster1": {"command": "thruster", "thruster_id": 1},
    "beacon": {"command": "beacon"},
}


def send_command_over_radio(action: str, power: int | None = None,
                            seconds: int | None = None) -> tuple[bool, str, dict]:
    """Retourne (ok, code_i18n, params) -- le texte affiche est choisi et
    traduit cote client (static/i18n.js), ce fichier ne produit aucun texte
    destine a l'utilisateur directement."""
    global tc_seq
    if heltec_serial is None:
        return False, "err_no_bridge", {}
    spec = COMMANDS.get(action)
    if spec is None:
        return False, "err_unknown_command", {"action": action}
    overrides = dict(spec)
    command = overrides.pop("command")
    if command == "thruster":
        overrides["power"] = power if power is not None else 0
    if command == "beacon":
        overrides["seconds"] = seconds if seconds is not None else 1
    tc_seq += 1
    raw_spp = build_command_packet(command, seq=tc_seq, encrypt=True, **overrides)
    heltec_serial.write(("TX " + raw_spp.hex() + "\n").encode())
    return True, "ok_sent", {"action": action, "seq": tc_seq}


# Mots reconnus par le shell -- strictement les commandes du protocole
# radio officiel (APID de worker.cpp). Toute commande hors de cette liste
# (y compris "SC INJECT ...", le menu texte, etc.) est refusee avec un
# message clair : ce projet n'ouvre aucun port USB vers le FlatSat, donc ces
# commandes-la (qui n'existent que sur la console USB, voir note 23 du
# vault) ne peuvent pas etre honorees ici, point final -- pas de repli USB.
SHELL_RADIO_WORDS = {"ping", "status", "nav", "fw", "thruster", "beacon"}


def handle_shell_line(line: str) -> tuple[bool, str, dict]:
    """Retourne (ok, code_i18n, params). Toute commande non radio est
    refusee. Voir send_command_over_radio : aucun texte utilisateur n'est
    produit ici, seulement une cle de traduction + ses parametres."""
    parts = line.strip().split()
    if not parts:
        return False, "", {}
    word = parts[0].lower()

    if word not in SHELL_RADIO_WORDS:
        return False, "err_not_radio_command", {"word": word}

    if word == "thruster":
        if len(parts) != 3 or parts[1] not in ("0", "1"):
            return False, "err_thruster_usage", {}
        action = "thruster" + parts[1]
        try:
            power = int(parts[2])
        except ValueError:
            return False, "err_invalid_power", {}
        return send_command_over_radio(action, power=power)

    if word == "beacon":
        if len(parts) != 2:
            return False, "err_beacon_usage", {}
        try:
            seconds = int(parts[1])
        except ValueError:
            return False, "err_invalid_value", {}
        return send_command_over_radio("beacon", seconds=seconds)

    return send_command_over_radio(word)


async def broadcast_telemetry(message: dict):
    dead = set()
    for ws in telemetry_clients:
        try:
            await ws.send_json(message)
        except Exception:
            dead.add(ws)
    telemetry_clients.difference_update(dead)


def heltec_reader_thread():
    """Tourne dans un thread a part : lit le pont radio Heltec en continu,
    decode/dechiffre ce qu'il peut, et pousse chaque evenement vers la
    boucle asyncio principale. Seul port serie ouvert par ce serveur."""
    global heltec_serial
    while True:
        port = resolve_heltec_port()
        try:
            ser = serial.Serial(port, BAUD, timeout=1)
            heltec_serial = ser
            print(f"[heltec] connecte sur {port}")
            while True:
                raw = ser.readline()
                if not raw:
                    continue
                line = raw.decode(errors="replace").strip()
                if not line:
                    continue
                event = parse_heltec_line(line)
                if event and loop:
                    asyncio.run_coroutine_threadsafe(
                        broadcast_telemetry(event), loop)
        except Exception as exc:
            print(f"[heltec] erreur ({exc}), nouvelle tentative dans 3s")
            heltec_serial = None
            time.sleep(3)


async def broadcast_usb_console(message: dict):
    dead = set()
    for ws in usb_console_clients:
        try:
            await ws.send_json(message)
        except Exception:
            dead.add(ws)
    usb_console_clients.difference_update(dead)


def flatsat_usb_reader_thread():
    """Console USB directe Mac<->FlatSat (fsat1), independante du pont
    Heltec : son propre port serie, son propre thread, aucune commande
    radio ne transite ici. Lien de debug explicite, pas le Ground Station."""
    global flatsat_usb_serial
    while True:
        try:
            ser = serial.Serial(FLATSAT_USB_PORT, FLATSAT_USB_BAUD, timeout=1)
            flatsat_usb_serial = ser
            print(f"[flatsat-usb] connecte sur {FLATSAT_USB_PORT}")
            while True:
                raw = ser.readline()
                if not raw:
                    continue
                line = raw.decode(errors="replace").rstrip("\r\n")
                if loop:
                    asyncio.run_coroutine_threadsafe(
                        broadcast_usb_console({"type": "usb_line", "line": line}),
                        loop)
        except Exception as exc:
            print(f"[flatsat-usb] erreur ({exc}), nouvelle tentative dans 3s")
            flatsat_usb_serial = None
            time.sleep(3)


def parse_heltec_line(line: str) -> dict | None:
    if line.startswith("RX "):
        parts = line[3:].split()
        if not parts:
            return None
        hexstr = parts[0]
        rssi = snr = None
        for p in parts[1:]:
            if p.startswith("RSSI="):
                rssi = float(p[5:])
            elif p.startswith("SNR="):
                snr = float(p[4:])
        try:
            raw = bytes.fromhex(hexstr)
            packet = decode_packet(raw)
        except Exception as exc:
            return {"type": "rx_raw", "hex": hexstr, "rssi": rssi, "snr": snr,
                   "error": str(exc)}

        decoded = None
        try:
            plain = decrypt_payload(packet.data)
            decoder = DECODERS.get(packet.apid)
            if decoder:
                decoded = decoder(plain)
        except Exception:
            decoded = None  # pas chiffre, ou cle/format inattendu -- pas grave

        return {
            "type": "rx", "apid": packet.apid, "apid_name": packet.apid_name,
            "seq": packet.sequence_count, "rssi": rssi, "snr": snr,
            "decoded": decoded, "ts": time.time(),
        }

    if line.startswith("TXDONE"):
        return {"type": "tx_done", "ts": time.time()}
    if line.startswith("TXERR"):
        return {"type": "tx_error", "detail": line, "ts": time.time()}
    return None


@app.on_event("startup")
async def startup():
    global loop
    loop = asyncio.get_running_loop()
    print(f"[config] HELTEC_PORT={HELTEC_PORT} -- lien radio officiel, "
         "jamais de commande FlatSat ici en dehors du protocole radio")
    print(f"[config] FLATSAT_USB_PORT={FLATSAT_USB_PORT} -- console debug "
         "directe, independante de la radio (voir note 23 du vault)")
    threading.Thread(target=heltec_reader_thread, daemon=True).start()
    threading.Thread(target=flatsat_usb_reader_thread, daemon=True).start()


@app.websocket("/ws/telemetry")
async def ws_telemetry(ws: WebSocket):
    await ws.accept()
    await ws.send_json({"type": "config", **RADIO_CONFIG})
    telemetry_clients.add(ws)
    try:
        while True:
            raw = await ws.receive_text()
            try:
                cmd = json.loads(raw)
            except Exception:
                continue
            if cmd.get("action") == "shell":
                ok, code, params = handle_shell_line(cmd.get("line", ""))
                await ws.send_json({"type": "shell_result", "ok": ok,
                                    "code": code, "params": params})
    except WebSocketDisconnect:
        pass
    finally:
        telemetry_clients.discard(ws)


@app.websocket("/ws/usb_console")
async def ws_usb_console(ws: WebSocket):
    """Console USB directe vers le FlatSat (fsat1). Lignes tapees ici sont
    envoyees telles quelles sur le port serie -- pas de filtrage, pas de
    protocole : c'est la vraie console (menu texte, SC STATUS, SC INJECT,
    etc.). Totalement independant du Ground Station Shell radio."""
    await ws.accept()
    usb_console_clients.add(ws)
    try:
        while True:
            raw = await ws.receive_text()
            try:
                cmd = json.loads(raw)
            except Exception:
                continue
            if cmd.get("action") == "usb_send":
                if flatsat_usb_serial is None:
                    await ws.send_json({"type": "usb_error",
                                        "code": "console_usb_error_not_connected"})
                    continue
                line = cmd.get("line", "")
                flatsat_usb_serial.write((line + "\n").encode())
    except WebSocketDisconnect:
        pass
    finally:
        usb_console_clients.discard(ws)


app.mount("/", StaticFiles(directory=Path(__file__).parent / "static",
                           html=True), name="static")
