// flatsat-console.js -- console USB directe vers le FlatSat.
//
// Page separee du Ground Station (index.html / app.js) : lien de debug
// Mac<->FlatSat explicitement autorise par l'auteur, independant du
// Ground Station Shell radio (port serie different, thread different,
// WebSocket different -- /ws/usb_console). Pas de filtrage de commandes :
// c'est la vraie console du FlatSat (menu texte, SC STATUS, SC INJECT,
// etc.), transmise telle quelle sur le port serie.

setInterval(() => {
  document.getElementById("clock").textContent = new Date().toLocaleTimeString();
}, 1000);

const usbTerm = new Terminal({
  convertEol: true,
  fontSize: 13,
  theme: { background: "#060a12", foreground: "#ffd9b8", cursor: "#ff7a1a" },
  scrollback: 5000,
});
const usbFit = new FitAddon.FitAddon();
usbTerm.loadAddon(usbFit);
usbTerm.open(document.getElementById("usb-terminal"));
usbFit.fit();
window.addEventListener("resize", () => { usbFit.fit(); });

let usbBuffer = "";
usbTerm.writeln(`\x1b[1m${t("console_intro_title")}\x1b[0m`);
usbTerm.writeln(t("console_intro_sub"));
usbTerm.write("\x1b[33m$ \x1b[0m");

usbTerm.onData((data) => {
  for (const ch of data) {
    if (ch === "\r" || ch === "\n") {
      const line = usbBuffer;
      usbBuffer = "";
      usbTerm.write("\r\n");
      sendUsbLine(line);
    } else if (ch === "\u007f" || ch === "\b") {
      if (usbBuffer.length > 0) {
        usbBuffer = usbBuffer.slice(0, -1);
        usbTerm.write("\b \b");
      }
    } else if (ch >= " ") {
      usbBuffer += ch;
      usbTerm.write(ch);
    }
  }
});

function sendUsbLine(line) {
  if (!usbWs || usbWs.readyState !== WebSocket.OPEN) {
    usbTerm.writeln(`\x1b[31m${t("console_no_connection")}\x1b[0m`);
    usbTerm.write("\x1b[33m$ \x1b[0m");
    return;
  }
  usbWs.send(JSON.stringify({ action: "usb_send", line }));
}

let usbWs = null;
function connectUsbConsole() {
  const ws = new WebSocket(`ws://${location.host}/ws/usb_console`);
  usbWs = ws;
  ws.onopen = () => {
    document.getElementById("usb-status").textContent = t("status_connected");
    document.getElementById("usb-status").classList.add("connected");
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "usb_line") {
      usbTerm.writeln(msg.line);
    } else if (msg.type === "usb_error") {
      const detail = msg.code ? t(msg.code) : msg.detail;
      usbTerm.writeln(`\x1b[31m${t("console_usb_error", { detail })}\x1b[0m`);
    }
  };
  ws.onclose = () => {
    document.getElementById("usb-status").textContent = t("status_disconnected");
    document.getElementById("usb-status").classList.remove("connected");
    setTimeout(connectUsbConsole, 2000);
  };
}
connectUsbConsole();
