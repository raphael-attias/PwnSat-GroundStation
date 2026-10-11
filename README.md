# PwnSat Ground Station

A local, **radio-only** ground station for the [FlatSat](https://github.com/Pwnsat/FlatSat)
(PWNSAT / Electronic Cats) training satellite: a web dashboard with live
decoded telemetry and an interactive command shell — built on top of a
[Heltec WiFi LoRa 32 V3](https://heltec.org/) board flashed as a dumb radio
bridge.

> **Project rule**: the Ground Station dashboard (`index.html`, the Ground
> Station Shell, the Heltec bridge handling) talks to the FlatSat over
> **LoRa only, ever** — no USB fallback, no exceptions. Commands outside the
> real radio protocol (e.g. FlatSat's USB-only `SC INJECT` SpaceCAN console)
> are refused by this shell by design, not merely unsupported — see
> `backend/server.py`'s `SHELL_RADIO_WORDS`.
>
> Separately, this server also exposes an optional, explicitly separate
> **direct USB debug console** to the FlatSat (`flatsat-console.html`,
> `/ws/usb_console`), for commands that have no radio equivalent at all. It
> runs on its own serial port and its own page — it is never reachable from,
> or mixed into, the radio dashboard. If you don't need `SC STATUS`/
> `SC INJECT`-style debugging, you can ignore it entirely and the Ground
> Station stays 100% radio as described above.

Built as part of a learning project documented at
[insert your article/vault link here].

> **Disclaimer**: this talks to **your own** FlatSat only, on the uplink/downlink
> frequencies it is configured for in its own firmware. Transmitting on those
> frequencies is only legal where the configured band (916/918 MHz) is an
> unlicensed ISM band for your region — check your local regulations before
> using the "send a command" feature. See the FlatSat project's own
> `15 - Sécurité RF et conformité` note if you have access to it, or your
> country's radio spectrum regulator.

## Architecture

```
FlatSat (916/918 MHz) <--LoRa only--> Heltec V3 "radio bridge"  <--USB serial-->  this server
        ^                                                                             |
        |                                                                        FastAPI + WebSocket
 no cable on this path, ever                                                          |
        :                                                                       your browser
        : optional, separate debug path (index.html never touches this):     index.html
        '-------------------------- USB serial -------------------------------> /ws/usb_console
                                                                                      |
                                                                           flatsat-console.html
```

- `heltec_rx/` — PlatformIO firmware for the Heltec V3. Listens on the FlatSat
  downlink (916 MHz) continuously, reports every received packet over serial,
  and accepts a `TX <hex>` command to transmit raw bytes on the uplink
  (918 MHz) then resume listening. It has **no AES key and no protocol logic**
  — that all lives in Python on the server, reusing FlatSat's own
  `pwnsat_tools` and `pwnsat_packets` helpers rather than reimplementing them.
- `backend/` — the FastAPI server + static web dashboard.

## Prerequisites

This repo depends on two sibling repositories for the SPP/CCSDS packet and
AES helpers (same convention as FlatSat's own `Attacks/` scripts) — it does
**not** vendor or duplicate that code:

```
some-parent-dir/
├── FlatSat/              <- https://github.com/Pwnsat/FlatSat
├── PWNSAT-C3/             <- https://github.com/Pwnsat/PWNSAT-C3
└── GroundStation/         <- this repo
```

Clone all three as siblings under the same parent directory.

## 1. Flash the Heltec V3

Needs [PlatformIO](https://platformio.org/) (CLI, or the VS Code extension —
works the same on macOS, Linux and Windows).

```bash
cd GroundStation/heltec_rx
pio run -t upload --upload-port <your-heltec-port>
```

- **macOS**: port looks like `/dev/cu.usbserial-XXXX` (`ls /dev/cu.*` to find it).
- **Linux**: port looks like `/dev/ttyUSB0`.
- **Windows**: port looks like `COM5` (check *Device Manager* → *Ports*).

If you omit `--upload-port`, PlatformIO will try to auto-detect it.

## 2. Run the server

```bash
cd GroundStation/backend
python3 -m venv .venv
# macOS/Linux:
source .venv/bin/activate
# Windows (PowerShell):
.venv\Scripts\Activate.ps1

pip install -r requirements.txt
python -m uvicorn server:app --host 127.0.0.1 --port 8800
```

Open **http://127.0.0.1:8800** in your browser.

### Serial port

The server auto-detects the Heltec (by USB description containing `CP210`,
its USB-serial chip). It re-detects on every reconnect attempt, so unplugging
and replugging it (even into a different port) is recovered automatically.
If auto-detection picks the wrong port, or finds none, set it explicitly:

```bash
# macOS/Linux example
HELTEC_PORT=/dev/cu.usbserial-0001 python -m uvicorn server:app --host 127.0.0.1 --port 8800

# Windows (PowerShell) example
$env:HELTEC_PORT="COM5"
python -m uvicorn server:app --host 127.0.0.1 --port 8800
```

This is the only serial port the **radio dashboard** path ever opens — the
Ground Station Shell, telemetry, everything on `index.html`, only reaches the
FlatSat over LoRa.

### Optional: direct USB console to the FlatSat

For `SC STATUS`/`SC INJECT`/SpaceCAN console access — commands with no radio
equivalent — open **http://127.0.0.1:8800/flatsat-console.html** (linked from
the main dashboard's header). It opens a second, independent serial port
straight to the FlatSat's console (`/dev/cu.usbmodemfsat1` by default,
override with `FLATSAT_USB_PORT`). This page and its WebSocket
(`/ws/usb_console`) are entirely separate from the radio dashboard: no code
path connects them. Ignore this page if you only want the radio-only Ground
Station.

## What's real vs. corrected

`PRESSION` and the accel `Z` field in the dashboard are affected by a
confirmed firmware bug: `float_to_fixed()` in FlatSat's `worker.cpp` casts
to `int16_t` without clamping, which silently overflows for realistic
pressure/accel-Z values. The dashboard detects and mathematically corrects
this in `decode.py`'s `_unwrap()` — it's not guessed, it's a deterministic
unwrap based on the known overflow period, confirmed against the FlatSat's
own USB console readout during development (see the project's vault notes
for the full derivation).

## License

This project talks to FlatSat firmware/scripts (GPL-2.0-or-later) and reuses
helper modules from PWNSAT-C3 under the same license. This repository's own
code is released under GPL-2.0-or-later for consistency.
