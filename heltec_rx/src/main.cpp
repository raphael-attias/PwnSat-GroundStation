// heltec_bridge -- pont radio USB<->LoRa pour la station sol PwnSat.
//
// Ecoute en permanence le downlink FlatSat (916 MHz) et rapporte chaque
// paquet recu sur le port serie. Accepte une commande "TX <hex>\n" venant
// du Mac : bascule sur l'uplink (918 MHz, parametres FlatSat), emet
// exactement les octets donnes (deja construits et chiffres cote Python,
// via PWNSAT-C3/pwnsat_tools -- aucune cle ni logique AES ici), puis
// revient ecouter le downlink.
//
// Parametres copies de Firmware/rdownlink.{h,cpp} (downlink) et
// Firmware/ruplink.{h,cpp} (uplink).
#include <Arduino.h>
#include <RadioLib.h>
#include <SPI.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#define LORA_SCK  9
#define LORA_MISO 11
#define LORA_MOSI 10
#define LORA_CS   8
#define LORA_RST  12
#define LORA_BUSY 13
#define LORA_DIO1 14

#define VEXT_PIN  36
#define OLED_SDA  17
#define OLED_SCL  18
#define OLED_RST  21
#define SCREEN_WIDTH  128
#define SCREEN_HEIGHT 64

#define DOWNLINK_FREQ 916.0
#define UPLINK_FREQ   918.0
#define LORA_BW   250.0
#define LORA_SF   7
#define LORA_CR   5
#define TX_POWER_DBM 10   // puissance modeste pour un test de bureau

SPIClass loraSPI(FSPI);
SX1262 radio = new Module(LORA_CS, LORA_DIO1, LORA_RST, LORA_BUSY, loraSPI);
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RST);

volatile bool receivedFlag = false;
static void onReceive() { receivedFlag = true; }

unsigned long lastPacketMillis = 0;
unsigned long lastPacketApid = 0;
float lastRssi = 0, lastSnr = 0;
unsigned long packetCount = 0;
unsigned long rxBlinkUntil = 0;
unsigned long txBlinkUntil = 0;

static void configureForRx() {
  radio.standby();
  radio.setFrequency(DOWNLINK_FREQ);
  radio.setBandwidth(LORA_BW);
  radio.setSpreadingFactor(LORA_SF);
  radio.setCodingRate(LORA_CR);
  radio.setPacketReceivedAction(onReceive);
  radio.startReceive();
}

static void configureForTx() {
  radio.standby();
  radio.setFrequency(UPLINK_FREQ);
  radio.setBandwidth(LORA_BW);
  radio.setSpreadingFactor(LORA_SF);
  radio.setCodingRate(LORA_CR);
  radio.explicitHeader();
  radio.setCRC(0);
  radio.setOutputPower(TX_POWER_DBM);
}

static void drawRxTxIndicators() {
  bool rxActive = millis() < rxBlinkUntil;
  bool txActive = millis() < txBlinkUntil;
  display.drawRect(92, 0, 16, 10, SSD1306_WHITE);
  if (rxActive) display.fillRect(92, 0, 16, 10, SSD1306_WHITE);
  display.setTextSize(1);
  display.setTextColor(rxActive ? SSD1306_BLACK : SSD1306_WHITE);
  display.setCursor(95, 1);
  display.print("RX");
  display.drawRect(110, 0, 16, 10, SSD1306_WHITE);
  if (txActive) display.fillRect(110, 0, 16, 10, SSD1306_WHITE);
  display.setTextColor(txActive ? SSD1306_BLACK : SSD1306_WHITE);
  display.setCursor(113, 1);
  display.print("TX");
  display.setTextColor(SSD1306_WHITE);
}

static void drawStatus() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println("PwnSat GS");
  display.drawLine(0, 9, 127, 9, SSD1306_WHITE);
  drawRxTxIndicators();

  bool connected = (lastPacketMillis != 0) &&
                   (millis() - lastPacketMillis < 30000);
  display.setCursor(0, 16);
  if (connected) display.println("Statut: CONNECTE");
  else if (lastPacketMillis != 0) display.println("Statut: SILENCE");
  else display.println("Statut: ECOUTE...");

  display.setCursor(0, 32);
  if (lastPacketMillis != 0) {
    display.printf("APID 0x%03lX  #%lu\n", lastPacketApid, packetCount);
    display.printf("RSSI %.0f SNR %.1f\n", lastRssi, lastSnr);
    display.printf("Il y a %lus\n", (millis() - lastPacketMillis) / 1000);
  } else {
    display.println("Aucun paquet recu");
  }
  display.display();
}

static int hexNibble(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  return -1;
}

static size_t hexToBytes(const String &s, uint8_t *out, size_t maxLen) {
  size_t n = 0;
  for (size_t i = 0; i + 1 < s.length() && n < maxLen; i += 2) {
    int hi = hexNibble(s[i]);
    int lo = hexNibble(s[i + 1]);
    if (hi < 0 || lo < 0) break;
    out[n++] = (uint8_t)((hi << 4) | lo);
  }
  return n;
}

static void handleSerialLine(const String &line) {
  if (line.startsWith("TX ")) {
    uint8_t buf[256];
    size_t len = hexToBytes(line.substring(3), buf, sizeof(buf));
    if (len == 0) {
      Serial.println("TXERR empty-or-invalid-hex");
      return;
    }
    receivedFlag = false;  // purge tout declenchement en attente avant d'emettre
    configureForTx();
    int state = radio.transmit(buf, len);
    configureForRx();
    receivedFlag = false;  // l'interruption DIO1 de fin d'emission peut avoir
                           // declenche a tort le callback de reception -- on
                           // ignore ce qui s'est passe pendant le TX lui-meme.
    if (state == RADIOLIB_ERR_NONE) {
      txBlinkUntil = millis() + 300;
      Serial.print("TXDONE ");
      for (size_t i = 0; i < len; i++) {
        if (buf[i] < 0x10) Serial.print('0');
        Serial.print(buf[i], HEX);
      }
      Serial.println();
    } else {
      Serial.print("TXERR code=");
      Serial.println(state);
    }
    drawStatus();
  } else if (line == "PING") {
    Serial.println("PONG");
  }
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println("=== heltec_bridge ===");

  pinMode(VEXT_PIN, OUTPUT);
  digitalWrite(VEXT_PIN, LOW);
  delay(100);
  Wire.begin(OLED_SDA, OLED_SCL);
  if (display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    drawStatus();
  } else {
    Serial.println("[ERREUR] Ecran OLED non detecte");
  }

  loraSPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_CS);
  int state = radio.begin(DOWNLINK_FREQ, LORA_BW, LORA_SF, LORA_CR,
                          RADIOLIB_SX126X_SYNC_WORD_PRIVATE, 10, 8, 1.6, false);
  if (state != RADIOLIB_ERR_NONE) {
    Serial.print("[ERREUR] radio.begin() code=");
    Serial.println(state);
    while (true) delay(1000);
  }
  configureForRx();
  Serial.println("READY");
}

void loop() {
  if (receivedFlag) {
    receivedFlag = false;
    size_t len = radio.getPacketLength();

    // Garde-fou : un paquet SPP valide fait au plus 206 octets (6 d'en-tete
    // + 200 de payload max, cf. SPP_MAX_PAYLOAD_CHUNK). Une longueur hors de
    // cette plage est un artefact (vu juste apres une bascule TX->RX), pas
    // un vrai paquet -- on l'ignore plutot que de l'afficher comme reel.
    if (len == 0 || len > 206) {
      radio.startReceive();
      return;
    }

    uint8_t buf[256];
    int state = radio.readData(buf, len);
    (void)state;

    lastPacketMillis = millis();
    lastPacketApid = ((unsigned long)buf[0] << 8 | buf[1]) & 0x7FF;
    lastRssi = radio.getRSSI();
    lastSnr = radio.getSNR();
    packetCount++;
    rxBlinkUntil = millis() + 300;

    Serial.print("RX ");
    for (size_t i = 0; i < len; i++) {
      if (buf[i] < 0x10) Serial.print('0');
      Serial.print(buf[i], HEX);
    }
    Serial.print(" RSSI=");
    Serial.print(lastRssi);
    Serial.print(" SNR=");
    Serial.println(lastSnr);

    drawStatus();
    radio.startReceive();
  }

  if (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    line.trim();
    if (line.length() > 0) handleSerialLine(line);
  }

  static unsigned long lastRedraw = 0;
  if (millis() - lastRedraw > 1000) {
    lastRedraw = millis();
    drawStatus();
  }
}
