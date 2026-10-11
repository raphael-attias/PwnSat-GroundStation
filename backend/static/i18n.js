// i18n.js -- traduction FR/EN, chargee avant app.js / flatsat-console.js sur
// chaque page. Langue choisie automatiquement : francais si la langue du
// navigateur commence par "fr", anglais sinon. Pas de selecteur manuel --
// comportement demande : "traductible eng si ordi pas FR".
//
// Usage dans le HTML : attribut data-i18n="cle" sur un element -> son
// textContent est remplace au chargement. Usage en JS : t("cle", {params}).

const LANG = (navigator.language || "fr").toLowerCase().startsWith("fr") ? "fr" : "en";

const STRINGS = {
  fr: {
    // ---------- Commun ----------
    nav_to_console: "Console FlatSat (USB direct) →",
    nav_to_groundstation: "← Ground Station (radio)",

    // ---------- index.html / Ground Station ----------
    title_groundstation: "PwnSat Ground Station",
    header_groundstation: "GROUND STATION",
    panel_map: "Position (projection Equal Earth)",
    map_hint_no_fix: "Pas de fix GPS pour l'instant.",
    map_hint_fix: "Dernier fix : {lat}, {lon}",
    panel_sat: "Satellite",
    sat_waiting: "EN ATTENTE",
    sat_connected: "CONNECTE",
    sat_silence: "SILENCE",
    d_accel: "Accel X/Y/Z",
    d_accel_t: "Temp. accel",
    d_bme_t: "Temp. BME",
    d_bme_p: "Pression",
    d_bme_h: "Humidite",
    d_bme_a: "Altitude",
    d_thrust: "Thruster T0/T1",
    d_gps: "GPS satellites",
    d_uptime: "Uptime",
    d_fw: "Firmware",
    d_apid: "Dernier APID",
    d_since: "Dernier contact",
    panel_shell: "Ground Station Shell",
    panel_radio: "Liaison radio",
    r_down: "Downlink",
    r_up: "Uplink",
    r_mod: "BW / SF / CR",
    r_rssi: "RSSI / SNR",

    // ---------- Shell (app.js) ----------
    shell_intro_title: "PwnSat Ground Station Shell -- radio uniquement",
    shell_intro_cmds: "Commandes : ping | status | nav | fw | thruster <0|1> <0-255> | beacon <0-30>",
    shell_intro_radio_only: "Ce shell reste 100% radio (voir le lien 'Console FlatSat' en haut a droite pour l'USB).",
    shell_intro_help: "Tapez 'help' pour revoir ce message.",
    shell_help_radio_only: "Ce shell reste 100% radio, meme si une console USB existe sur une page separee.",
    shell_no_connection: "[erreur] pas de connexion au serveur",

    // ---------- Codes de resultat shell (server.py) ----------
    err_no_bridge: "pont radio non connecte",
    err_unknown_command: "commande inconnue : {action}",
    ok_sent: "{action} envoye par radio (seq {seq})",
    err_not_radio_command: "'{word}' n'est pas une commande radio -- ce projet n'ouvre aucune connexion USB vers le FlatSat. Commandes disponibles : ping, status, nav, fw, thruster <0|1> <0-255>, beacon <0-30>",
    err_thruster_usage: "usage : thruster <0|1> <puissance 0-255>",
    err_invalid_power: "puissance invalide",
    err_beacon_usage: "usage : beacon <secondes 0-30>",
    err_invalid_value: "valeur invalide",

    // ---------- flatsat-console.html ----------
    title_console: "PwnSat Console FlatSat",
    header_console: "CONSOLE FLATSAT",
    badge_usb: "usb direct",
    status_connected: "CONNECTE",
    status_disconnected: "DECONNECTE",
    console_hint: "Lien de debug direct Mac↔FlatSat (port fsat1), totalement separe du Ground Station radio. Toute ligne tapee ici part telle quelle sur la console du FlatSat -- menu texte, SC STATUS, SC INJECT ..., etc.",
    console_intro_title: "Console FlatSat -- USB direct (debug)",
    console_intro_sub: "Lien separe du Ground Station radio. Toute ligne tapee ici part telle quelle sur fsat1.",
    console_no_connection: "[erreur] pas de connexion au serveur",
    console_usb_error: "[erreur] {detail}",
    console_usb_error_not_connected: "console FlatSat non connectee",
  },
  en: {
    nav_to_console: "FlatSat Console (direct USB) →",
    nav_to_groundstation: "← Ground Station (radio)",

    title_groundstation: "PwnSat Ground Station",
    header_groundstation: "GROUND STATION",
    panel_map: "Position (Equal Earth projection)",
    map_hint_no_fix: "No GPS fix yet.",
    map_hint_fix: "Last fix: {lat}, {lon}",
    panel_sat: "Satellite",
    sat_waiting: "WAITING",
    sat_connected: "CONNECTED",
    sat_silence: "SILENCE",
    d_accel: "Accel X/Y/Z",
    d_accel_t: "Accel temp.",
    d_bme_t: "BME temp.",
    d_bme_p: "Pressure",
    d_bme_h: "Humidity",
    d_bme_a: "Altitude",
    d_thrust: "Thruster T0/T1",
    d_gps: "GPS satellites",
    d_uptime: "Uptime",
    d_fw: "Firmware",
    d_apid: "Last APID",
    d_since: "Last contact",
    panel_shell: "Ground Station Shell",
    panel_radio: "Radio link",
    r_down: "Downlink",
    r_up: "Uplink",
    r_mod: "BW / SF / CR",
    r_rssi: "RSSI / SNR",

    shell_intro_title: "PwnSat Ground Station Shell -- radio only",
    shell_intro_cmds: "Commands: ping | status | nav | fw | thruster <0|1> <0-255> | beacon <0-30>",
    shell_intro_radio_only: "This shell stays 100% radio (see the 'FlatSat Console' link top-right for USB).",
    shell_intro_help: "Type 'help' to see this message again.",
    shell_help_radio_only: "This shell stays 100% radio, even though a USB console exists on a separate page.",
    shell_no_connection: "[error] no connection to the server",

    err_no_bridge: "radio bridge not connected",
    err_unknown_command: "unknown command: {action}",
    ok_sent: "{action} sent over radio (seq {seq})",
    err_not_radio_command: "'{word}' is not a radio command -- this project opens no USB connection to the FlatSat. Available commands: ping, status, nav, fw, thruster <0|1> <0-255>, beacon <0-30>",
    err_thruster_usage: "usage: thruster <0|1> <power 0-255>",
    err_invalid_power: "invalid power",
    err_beacon_usage: "usage: beacon <seconds 0-30>",
    err_invalid_value: "invalid value",

    title_console: "PwnSat FlatSat Console",
    header_console: "FLATSAT CONSOLE",
    badge_usb: "direct usb",
    status_connected: "CONNECTED",
    status_disconnected: "DISCONNECTED",
    console_hint: "Direct debug link Mac↔FlatSat (port fsat1), fully separate from the radio Ground Station. Any line typed here goes straight to the FlatSat console -- text menu, SC STATUS, SC INJECT ..., etc.",
    console_intro_title: "FlatSat Console -- direct USB (debug)",
    console_intro_sub: "Separate from the radio Ground Station. Any line typed here goes straight to fsat1.",
    console_no_connection: "[error] no connection to the server",
    console_usb_error: "[error] {detail}",
    console_usb_error_not_connected: "FlatSat console not connected",
  },
};

function t(key, params) {
  let s = (STRINGS[LANG] && STRINGS[LANG][key]) || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replaceAll(`{${k}}`, v);
    }
  }
  return s;
}

function applyI18n(root) {
  (root || document).querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  document.documentElement.lang = LANG;
}
document.addEventListener("DOMContentLoaded", () => applyI18n());
