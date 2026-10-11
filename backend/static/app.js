// app.js -- logique de la page station sol PwnSat

// ---------- Horloge ----------
setInterval(() => {
  document.getElementById("clock").textContent = new Date().toLocaleTimeString();
}, 1000);

// ---------- Minimap Equal Earth ----------
const mapSvg = d3.select("#map");
const mapWidth = 420, mapHeight = 220;
mapSvg.attr("viewBox", `0 0 ${mapWidth} ${mapHeight}`);
const projection = d3.geoEqualEarth().fitSize([mapWidth, mapHeight], {type: "Sphere"});
const path = d3.geoPath(projection);
mapSvg.append("path").attr("class", "sphere").attr("d", path({type: "Sphere"}));

fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json")
  .then(r => r.json())
  .then(land => {
    const geo = topojson.feature(land, land.objects.land);
    mapSvg.append("path").attr("class", "land").attr("d", path(geo));
  })
  .catch(() => {}); // pas de reseau -> la carte reste juste vide, pas bloquant

let satMarker = null;
function updateMapPosition(lat, lon) {
  const coords = projection([lon, lat]);
  if (!coords) return;
  if (!satMarker) {
    satMarker = mapSvg.append("circle").attr("class", "sat-marker").attr("r", 4);
  }
  satMarker.attr("cx", coords[0]).attr("cy", coords[1]);
  document.getElementById("map-hint").textContent =
    t("map_hint_fix", { lat: lat.toFixed(4), lon: lon.toFixed(4) });
}

// ---------- Panneau satellite ----------
const satPanel = document.getElementById("panel-sat");
const satStatus = document.getElementById("sat-status");
let lastContactTs = null;

function markContact() {
  lastContactTs = Date.now();
  satPanel.classList.add("connected");
  satStatus.textContent = t("sat_connected");
}
setInterval(() => {
  if (!lastContactTs) return;
  const sinceS = Math.floor((Date.now() - lastContactTs) / 1000);
  document.getElementById("d-since").textContent = sinceS + "s";
  if (sinceS > 30) {
    satPanel.classList.remove("connected");
    satStatus.textContent = t("sat_silence");
  }
}, 1000);

function applyDecoded(decoded) {
  if (!decoded) return;
  if (decoded.accel) {
    const a = decoded.accel;
    document.getElementById("d-accel").textContent =
      `${a.x.toFixed(1)} / ${a.y.toFixed(1)} / ${a.z.toFixed(1)}`;
    document.getElementById("d-accel-t").textContent = a.temp.toFixed(1) + " C";
  }
  if (decoded.bme) {
    document.getElementById("d-bme-t").textContent = decoded.bme.temp.toFixed(1) + " C";
    document.getElementById("d-bme-p").textContent = decoded.bme.pressure.toFixed(1) + " hPa";
    document.getElementById("d-bme-h").textContent = decoded.bme.humidity.toFixed(1) + " %";
    document.getElementById("d-bme-a").textContent = decoded.bme.altitude.toFixed(1) + " m";
  }
  if (decoded.thruster) {
    document.getElementById("d-thrust").textContent =
      `${decoded.thruster.t0} / ${decoded.thruster.t1}`;
  }
  if (decoded.satellites !== undefined) {
    document.getElementById("d-gps").textContent = decoded.satellites;
  }
  if (decoded.has_fix) {
    updateMapPosition(decoded.lat, decoded.lon);
  }
  if (decoded.uptime_s !== undefined) {
    const h = Math.floor(decoded.uptime_s / 3600);
    const m = Math.floor((decoded.uptime_s % 3600) / 60);
    const s = decoded.uptime_s % 60;
    document.getElementById("d-uptime").textContent = `${h}h ${m}m ${s}s`;
  }
  if (decoded.firmware) {
    document.getElementById("d-fw").textContent = "v" + decoded.firmware;
  }
}

// ---------- LEDs RX/TX ----------
const ledRx = document.getElementById("led-rx");
const ledTx = document.getElementById("led-tx");
function blink(el, cls, ms) {
  el.classList.add("active");
  if (cls) el.classList.add(cls);
  setTimeout(() => {
    el.classList.remove("active");
    if (cls) el.classList.remove(cls);
  }, ms || 300);
}

// ======================================================================
// Ground Station Shell -- panneau radio, interactif.
// Reste et restera 100% radio : seules les commandes officielles
// (ping/status/nav/fw/thruster/beacon) sont acceptees ici ; tout le reste
// (SC INJECT, menu texte, etc.) est refuse avec un message clair, car ca
// n'a pas d'equivalent dans le protocole radio du FlatSat (voir note 23 du
// vault). Ces commandes-la restent possibles, mais uniquement sur la page
// separee "Console FlatSat" (flatsat-console.html, USB direct) -- jamais
// melangees a ce shell-ci, ni a cette page.
// ======================================================================
const shellTerm = new Terminal({
  convertEol: true,
  fontSize: 13,
  theme: { background: "#060a12", foreground: "#cfe8ff", cursor: "#2bd9ff" },
  scrollback: 3000,
});
const shellFit = new FitAddon.FitAddon();
shellTerm.loadAddon(shellFit);
shellTerm.open(document.getElementById("shell-terminal"));
shellFit.fit();
window.addEventListener("resize", () => { shellFit.fit(); });

let shellBuffer = "";
function shellPrompt() { shellTerm.write("\r\n\x1b[36mgs>\x1b[0m "); }
shellTerm.writeln(`\x1b[1m${t("shell_intro_title")}\x1b[0m`);
shellTerm.writeln(t("shell_intro_cmds"));
shellTerm.writeln(t("shell_intro_radio_only"));
shellTerm.writeln(t("shell_intro_help"));
shellPrompt();

function reprintPrompt() {
  shellTerm.write(`\r\n\x1b[36mgs>\x1b[0m ${shellBuffer}`);
}

shellTerm.onData((data) => {
  for (const ch of data) {
    if (ch === "\r" || ch === "\n") {
      const line = shellBuffer;
      shellBuffer = "";
      shellTerm.write("\r\n");
      if (!line.trim()) { shellPrompt(); continue; }
      if (line.trim().toLowerCase() === "help") {
        shellTerm.writeln(t("shell_intro_cmds"));
        shellTerm.writeln(t("shell_help_radio_only"));
        shellPrompt();
        continue;
      }
      sendShellLine(line.trim());
    } else if (ch === "\u007f" || ch === "\b") {
      if (shellBuffer.length > 0) {
        shellBuffer = shellBuffer.slice(0, -1);
        shellTerm.write("\b \b");
      }
    } else if (ch >= " ") {
      shellBuffer += ch;
      shellTerm.write(ch);
    }
  }
});

function sendShellLine(line) {
  if (!telemetryWs || telemetryWs.readyState !== WebSocket.OPEN) {
    shellTerm.writeln(`\x1b[31m${t("shell_no_connection")}\x1b[0m`);
    shellPrompt();
    return;
  }
  telemetryWs.send(JSON.stringify({ action: "shell", line }));
}

// ---------- WebSocket telemetrie + resultats de commande ----------
let telemetryWs = null;

function connectTelemetry() {
  const ws = new WebSocket(`ws://${location.host}/ws/telemetry`);
  telemetryWs = ws;
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "config") {
      document.getElementById("r-down").textContent = msg.downlink_mhz + " MHz";
      document.getElementById("r-up").textContent = msg.uplink_mhz + " MHz";
      document.getElementById("r-mod").textContent =
        `${msg.bw_khz} kHz / SF${msg.sf} / CR ${msg.cr}`;
    } else if (msg.type === "rx") {
      blink(ledRx);
      markContact();
      document.getElementById("d-apid").textContent =
        `0x${msg.apid.toString(16).padStart(3, "0")} (${msg.apid_name})`;
      document.getElementById("r-rssi").textContent = msg.rssi ?? "--";
      document.getElementById("r-snr").textContent = msg.snr ?? "--";
      applyDecoded(msg.decoded);
      let extra = "";
      if (msg.decoded && msg.decoded.bme) {
        extra = ` temp=${msg.decoded.bme.temp.toFixed(1)}C press=${msg.decoded.bme.pressure.toFixed(0)}hPa`;
      }
      shellTerm.write(`\r\n\x1b[90m< 0x${msg.apid.toString(16).padStart(3, "0")} ${msg.apid_name} seq=${msg.seq}${extra}\x1b[0m`);
      reprintPrompt();
    } else if (msg.type === "tx_done") {
      blink(ledTx, "tx", 400);
    } else if (msg.type === "shell_result") {
      const color = msg.ok ? "\x1b[32m" : "\x1b[33m";
      shellTerm.writeln(`${color}${t(msg.code, msg.params)}\x1b[0m`);
      shellPrompt();
      if (msg.ok) blink(ledTx, "tx", 400);
    }
  };
  ws.onclose = () => setTimeout(connectTelemetry, 2000);
}
connectTelemetry();
