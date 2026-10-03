/*
 ╔══════════════════════════════════════════════════════════════════════╗
 ║           ESP32-CAM  —  Vercel Edition  v1.0                        ║
 ║                                                                      ║
 ║  Architecture (pattern from WorkBetter v3.0):                        ║
 ║   1. Captive-portal Wi-Fi setup: scan → dropdown → save (Prefs)      ║
 ║   2. NTP time sync + reconnect watchdog                              ║
 ║   3. Local HTTP server on the home network:                          ║
 ║        GET /stream      → MJPEG live stream                          ║
 ║        GET /snapshot    → single JPEG                                ║
 ║        GET /flash/on|off → toggle LED                                ║
 ║        GET /reset       → erase saved Wi-Fi credentials              ║
 ║   4. HTTPS poll every POLL_INTERVAL_MS:                              ║
 ║        GET VERCEL_HOST/api/esp32-ping                                ║
 ║        Response: { "command": "none|snapshot|flash_on|flash_off",    ║
 ║                    "commandId": "..." }                              ║
 ║   5. Execute command:                                                ║
 ║        snapshot  → capture JPEG → POST /api/snapshot (raw bytes)     ║
 ║        flash_on  → GPIO 4 HIGH                                       ║
 ║        flash_off → GPIO 4 LOW                                        ║
 ║   6. Optional auto-upload: send a snapshot every AUTO_UPLOAD_MS      ║
 ║      (0 = disabled).  Lets the Vercel dashboard work as a           ║
 ║      time-lapse / remote monitor without pressing a button.          ║
 ║                                                                      ║
 ║  Hardware: AI Thinker ESP32-CAM                                      ║
 ║                                                                      ║
 ║  Required library (Arduino Library Manager):                         ║
 ║    ArduinoJson  (by Benoit Blanchon)                                 ║
 ║                                                                      ║
 ║  Everything else ships with the ESP32 Arduino core:                  ║
 ║    esp_camera, WiFi, WebServer, DNSServer, Preferences,              ║
 ║    HTTPClient, WiFiClientSecure, time.h                              ║
 ╚══════════════════════════════════════════════════════════════════════╝
*/

// ─────────────────────────────────────────────────────────────────────────────
//  INCLUDES
// ─────────────────────────────────────────────────────────────────────────────
#include "esp_camera.h"
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <time.h>

// ─────────────────────────────────────────────────────────────────────────────
//  AI THINKER ESP32-CAM PIN MAP
// ─────────────────────────────────────────────────────────────────────────────
#define PWDN_GPIO_NUM  32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM   0
#define SIOD_GPIO_NUM  26
#define SIOC_GPIO_NUM  27
#define Y9_GPIO_NUM    35
#define Y8_GPIO_NUM    34
#define Y7_GPIO_NUM    39
#define Y6_GPIO_NUM    36
#define Y5_GPIO_NUM    21
#define Y4_GPIO_NUM    19
#define Y3_GPIO_NUM    18
#define Y2_GPIO_NUM     5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM  23
#define PCLK_GPIO_NUM  22

// ─────────────────────────────────────────────────────────────────────────────
//  ★  USER CONFIGURATION  — edit only this block
// ─────────────────────────────────────────────────────────────────────────────

// Wi-Fi captive-portal AP name (open network, no password needed)
#define AP_SSID             "ESP32CAM-Setup"
#define AP_PASSWORD         ""

// Your Vercel deployment URL — no trailing slash
// Example: "https://myowncctv-abc123.vercel.app"
#define VERCEL_HOST         "https://myowncctv.vercel.app"

// How often to ask Vercel for a command (milliseconds)
#define POLL_INTERVAL_MS     5000UL

// Auto-upload: set > 0 to push a snapshot automatically every N ms
// (0 = only upload when the dashboard explicitly requests one)
#define AUTO_UPLOAD_MS       0UL

// NTP / timezone
#define NTP_SERVER          "pool.ntp.org"
#define GMT_OFFSET_SEC       19800   // IST +5:30 — adjust for your zone
#define DAYLIGHT_OFFSET_SEC  0

// Wi-Fi timeouts
#define WIFI_CONNECT_MS      15000UL
#define WIFI_RETRY_MS        30000UL
#define NTP_RESYNC_MS        (6UL * 3600000UL)   // every 6 hours

// Flash LED
#define FLASH_LED_PIN        4

// ─────────────────────────────────────────────────────────────────────────────
//  GLOBALS
// ─────────────────────────────────────────────────────────────────────────────
WebServer   localServer(80);
DNSServer   dns;
Preferences prefs;

bool apMode       = false;
bool flashOn      = false;
bool ntpSynced    = false;

unsigned long tPoll       = 0;
unsigned long tRetry      = 0;
unsigned long tNtp        = 0;
unsigned long tAutoUpload = 0;

String netOptions = "";   // pre-scanned <option> HTML for the portal

// ─────────────────────────────────────────────────────────────────────────────
//  FORWARD DECLARATIONS
// ─────────────────────────────────────────────────────────────────────────────
bool   initCamera();
bool   wifiConnect();
void   startPortal();
void   syncNtp();
void   pollVercel();
void   executeCommand(const String& cmd, const String& cmdId);
void   uploadSnapshot(const String& cmdId = "");

void   serveStream();
void   serveSnapshot();
void   serveFlashOn();
void   serveFlashOff();
void   servePortalRoot();
void   servePortalScan();
void   servePortalConnect();
void   serveReset();
void   serveNotFound();

String buildNetOptions();

// ─────────────────────────────────────────────────────────────────────────────
//  SETUP
// ─────────────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(200);

  // Flash LED — always start with it off
  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(FLASH_LED_PIN, LOW);

  Serial.println(F("\n╔═══════════════════════════════╗"));
  Serial.println(F("║  ESP32-CAM  Vercel Edition    ║"));
  Serial.println(F("╚═══════════════════════════════╝"));

  if (!initCamera()) {
    Serial.println(F("[CAM] Fatal: camera init failed"));
    // Blink flash LED to signal error
    while (true) {
      digitalWrite(FLASH_LED_PIN, HIGH); delay(200);
      digitalWrite(FLASH_LED_PIN, LOW);  delay(200);
    }
  }

  prefs.begin("cam-wifi", false);

  if (wifiConnect()) {
    // ── STA mode — register all local endpoints ──────────────────────────
    localServer.on("/stream",    HTTP_GET, serveStream);
    localServer.on("/snapshot",  HTTP_GET, serveSnapshot);
    localServer.on("/flash/on",  HTTP_GET, serveFlashOn);
    localServer.on("/flash/off", HTTP_GET, serveFlashOff);
    localServer.on("/reset",     HTTP_GET, serveReset);
    localServer.begin();

    Serial.printf("[HTTP] Local server at http://%s\n",
                  WiFi.localIP().toString().c_str());

    syncNtp();

    // First Vercel poll happens immediately so commands are picked up fast
    pollVercel();
    tPoll = millis();
  } else {
    startPortal();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN LOOP
// ─────────────────────────────────────────────────────────────────────────────
void loop() {
  // ── AP (captive portal) mode ─────────────────────────────────────────────
  if (apMode) {
    dns.processNextRequest();
    localServer.handleClient();
    return;
  }

  // ── STA mode ─────────────────────────────────────────────────────────────
  localServer.handleClient();

  // Wi-Fi watchdog
  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - tRetry > WIFI_RETRY_MS) {
      tRetry = millis();
      Serial.println(F("[WiFi] Connection lost — reconnecting…"));
      WiFi.reconnect();
      unsigned long t = millis();
      while (WiFi.status() != WL_CONNECTED && millis() - t < WIFI_CONNECT_MS)
        delay(300);
      if (WiFi.status() == WL_CONNECTED) {
        Serial.println(F("[WiFi] Reconnected"));
        ntpSynced = false;
        syncNtp();
      } else {
        Serial.println(F("[WiFi] Reconnect failed — will retry"));
      }
    }
    return;  // don't poll Vercel while offline
  }

  // Periodic NTP resync
  if (!ntpSynced || millis() - tNtp > NTP_RESYNC_MS)
    syncNtp();

  // Poll Vercel for commands
  if (millis() - tPoll >= POLL_INTERVAL_MS) {
    tPoll = millis();
    pollVercel();
  }

  // Auto-upload (if enabled)
  if (AUTO_UPLOAD_MS > 0 && millis() - tAutoUpload >= AUTO_UPLOAD_MS) {
    tAutoUpload = millis();
    Serial.println(F("[Auto] Uploading snapshot to Vercel…"));
    uploadSnapshot("auto");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  CAMERA INIT
// ─────────────────────────────────────────────────────────────────────────────
bool initCamera() {
  camera_config_t cfg;

  cfg.ledc_channel = LEDC_CHANNEL_0;
  cfg.ledc_timer   = LEDC_TIMER_0;
  cfg.pin_d0       = Y2_GPIO_NUM;
  cfg.pin_d1       = Y3_GPIO_NUM;
  cfg.pin_d2       = Y4_GPIO_NUM;
  cfg.pin_d3       = Y5_GPIO_NUM;
  cfg.pin_d4       = Y6_GPIO_NUM;
  cfg.pin_d5       = Y7_GPIO_NUM;
  cfg.pin_d6       = Y8_GPIO_NUM;
  cfg.pin_d7       = Y9_GPIO_NUM;
  cfg.pin_xclk     = XCLK_GPIO_NUM;
  cfg.pin_pclk     = PCLK_GPIO_NUM;
  cfg.pin_vsync    = VSYNC_GPIO_NUM;
  cfg.pin_href     = HREF_GPIO_NUM;
  cfg.pin_sccb_sda = SIOD_GPIO_NUM;
  cfg.pin_sccb_scl = SIOC_GPIO_NUM;
  cfg.pin_pwdn     = PWDN_GPIO_NUM;
  cfg.pin_reset    = RESET_GPIO_NUM;
  cfg.xclk_freq_hz = 20000000;
  cfg.pixel_format = PIXFORMAT_JPEG;

  if (psramFound()) {
    cfg.frame_size   = FRAMESIZE_VGA;   // 640×480 for local stream
    cfg.jpeg_quality = 12;
    cfg.fb_count     = 2;
    cfg.grab_mode    = CAMERA_GRAB_LATEST;
  } else {
    cfg.frame_size   = FRAMESIZE_QVGA;  // 320×240 fallback
    cfg.jpeg_quality = 15;
    cfg.fb_count     = 1;
    cfg.grab_mode    = CAMERA_GRAB_WHEN_EMPTY;
  }

  if (esp_camera_init(&cfg) != ESP_OK) {
    Serial.println(F("[CAM] esp_camera_init failed"));
    return false;
  }

  sensor_t* s = esp_camera_sensor_get();
  s->set_brightness(s,  0);
  s->set_contrast(s,    0);
  s->set_saturation(s,  0);
  s->set_whitebal(s,    1);
  s->set_awb_gain(s,    1);
  s->set_exposure_ctrl(s, 1);
  s->set_gain_ctrl(s,   1);

  Serial.println(F("[CAM] Initialized"));
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
//  WI-FI: CONNECT FROM SAVED CREDENTIALS
// ─────────────────────────────────────────────────────────────────────────────
bool wifiConnect() {
  String ssid = prefs.getString("ssid", "");
  String pass = prefs.getString("pass", "");

  if (ssid.isEmpty()) {
    Serial.println(F("[WiFi] No saved credentials"));
    return false;
  }

  Serial.printf("[WiFi] Connecting to \"%s\"…\n", ssid.c_str());
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid.c_str(), pass.c_str());

  unsigned long t = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t < WIFI_CONNECT_MS)
    delay(300);

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[WiFi] Connected  IP: %s\n", WiFi.localIP().toString().c_str());
    return true;
  }

  Serial.println(F("[WiFi] Failed — launching captive portal"));
  WiFi.disconnect(true);
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
//  WI-FI: CAPTIVE PORTAL (AP MODE)
// ─────────────────────────────────────────────────────────────────────────────
void startPortal() {
  apMode = true;
  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID);   // open AP (no password)
  IPAddress ip = WiFi.softAPIP();

  dns.start(53, "*", ip);  // redirect all DNS to us

  netOptions = buildNetOptions();   // pre-scan so the first page loads fast

  localServer.on("/",        HTTP_GET,  servePortalRoot);
  localServer.on("/scan",    HTTP_GET,  servePortalScan);
  localServer.on("/connect", HTTP_POST, servePortalConnect);
  localServer.on("/reset",   HTTP_GET,  serveReset);
  localServer.onNotFound(serveNotFound);
  localServer.begin();

  Serial.printf("[AP] SSID: %s  IP: %s\n", AP_SSID, ip.toString().c_str());
  Serial.println(F("[AP] Connect to ESP32CAM-Setup and open http://192.168.4.1"));
}

// Scan visible networks and build HTML <option> elements
String buildNetOptions() {
  int n = WiFi.scanNetworks();
  if (n <= 0) return F("<option value=''>No networks found — tap Rescan</option>");

  // De-duplicate SSIDs, keep strongest RSSI per name
  struct Net { String ssid; int rssi; bool locked; };
  static Net pool[32];
  int count = 0;

  for (int i = 0; i < n && count < 32; i++) {
    String s = WiFi.SSID(i);
    if (s.isEmpty()) continue;
    bool dup = false;
    for (int j = 0; j < count; j++) {
      if (pool[j].ssid == s) {
        if (WiFi.RSSI(i) > pool[j].rssi) pool[j].rssi = WiFi.RSSI(i);
        dup = true; break;
      }
    }
    if (!dup) pool[count++] = { s, WiFi.RSSI(i), WiFi.encryptionType(i) != WIFI_AUTH_OPEN };
  }

  // Sort strongest first (simple bubble sort — tiny N)
  for (int i = 0; i < count - 1; i++)
    for (int j = i + 1; j < count; j++)
      if (pool[j].rssi > pool[i].rssi) { Net t = pool[i]; pool[i] = pool[j]; pool[j] = t; }

  String html;
  for (int i = 0; i < count; i++) {
    html += "<option value='" + pool[i].ssid + "'>"
          + pool[i].ssid
          + " (" + pool[i].rssi + " dBm)"
          + (pool[i].locked ? " \xf0\x9f\x94\x92" : "")
          + "</option>";
  }
  WiFi.scanDelete();
  return html;
}

// Shared minimal CSS for all portal pages
static const char PORTAL_CSS[] PROGMEM =
  "<style>"
  "body{font-family:system-ui,sans-serif;background:#0d1117;color:#e6edf3;"
       "display:flex;justify-content:center;padding:28px;margin:0}"
  ".c{background:#161b22;border:1px solid #30363d;border-radius:14px;"
     "padding:28px;width:100%;max-width:400px}"
  "h2{margin:0 0 20px;color:#58a6ff;font-size:1.2rem}"
  "label{display:block;font-size:.78rem;color:#8b949e;margin:12px 0 4px}"
  "select,input{width:100%;padding:10px;border:1px solid #30363d;"
               "border-radius:8px;background:#1f2937;color:#e6edf3;"
               "font-size:1rem;box-sizing:border-box}"
  ".btn{display:block;width:100%;margin-top:16px;padding:11px;"
        "border:none;border-radius:8px;font-size:1rem;"
        "font-weight:700;cursor:pointer}"
  ".p{background:#238636;color:#fff}"
  ".s{background:#21262d;color:#8b949e;border:1px solid #30363d;margin-top:8px}"
  "small{display:block;margin-top:14px;font-size:.75rem;color:#484f58;text-align:center}"
  "a{color:#58a6ff}"
  "</style>";

void servePortalRoot() {
  String html = F("<!DOCTYPE html><html lang='en'><head>"
    "<meta charset='UTF-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>ESP32-CAM Setup</title>");
  html += FPSTR(PORTAL_CSS);
  html += F("</head><body><div class='c'>"
    "<h2>&#128247; ESP32-CAM Setup</h2>"
    "<form action='/connect' method='POST'>"
    "<label>Select your Wi-Fi network</label>"
    "<select name='ssid'>");
  html += netOptions;
  html += F("</select>"
    "<label>Password (leave blank if open)</label>"
    "<input type='password' name='pass' placeholder='Wi-Fi password'>"
    "<button class='btn p' type='submit'>Save &amp; Connect</button>"
    "</form>"
    "<button class='btn s' onclick=\"location='/scan'\">&#8635; Rescan</button>"
    "<small><a href='/reset'>Erase saved credentials</a></small>"
    "</div></body></html>");
  localServer.send(200, "text/html", html);
}

void servePortalScan() {
  netOptions = buildNetOptions();
  localServer.sendHeader("Location", "/");
  localServer.send(303);
}

void servePortalConnect() {
  if (!localServer.hasArg("ssid") || localServer.arg("ssid").isEmpty()) {
    localServer.send(400, "text/plain", "Missing SSID");
    return;
  }
  prefs.putString("ssid", localServer.arg("ssid"));
  prefs.putString("pass", localServer.hasArg("pass") ? localServer.arg("pass") : "");

  String html = F("<!DOCTYPE html><html><head>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>");
  html += FPSTR(PORTAL_CSS);
  html += F("</head><body><div class='c'>"
    "<h2>&#9989; Saved!</h2><p>Restarting and connecting to <b>");
  html += localServer.arg("ssid");
  html += F("</b>&hellip;</p></div></body></html>");

  localServer.send(200, "text/html", html);
  delay(1200);
  ESP.restart();
}

void serveReset() {
  prefs.remove("ssid");
  prefs.remove("pass");

  String html = F("<!DOCTYPE html><html><head>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>");
  html += FPSTR(PORTAL_CSS);
  html += F("</head><body><div class='c'>"
    "<h2>&#128465; Cleared</h2>"
    "<p>Wi-Fi credentials erased. Restarting into setup mode&hellip;</p>"
    "</div></body></html>");

  localServer.send(200, "text/html", html);
  delay(1200);
  ESP.restart();
}

void serveNotFound() {
  // Captive-portal redirect — any unknown URL → setup page
  localServer.sendHeader("Location",
    "http://" + WiFi.softAPIP().toString() + "/", true);
  localServer.send(302, "text/plain", "");
}

// ─────────────────────────────────────────────────────────────────────────────
//  LOCAL HTTP — LIVE STREAM  (MJPEG multipart, blocks while client connected)
// ─────────────────────────────────────────────────────────────────────────────
void serveStream() {
  WiFiClient client = localServer.client();
  Serial.println(F("[Stream] Client connected"));

  client.println(F("HTTP/1.1 200 OK"));
  client.println(F("Content-Type: multipart/x-mixed-replace; boundary=frame"));
  client.println(F("Cache-Control: no-cache"));
  client.println(F("Access-Control-Allow-Origin: *"));
  client.println();

  while (client.connected()) {
    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) { Serial.println(F("[Stream] Capture failed")); break; }

    client.printf("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n",
                  fb->len);
    client.write(fb->buf, fb->len);
    client.write("\r\n");
    esp_camera_fb_return(fb);
    delay(33);  // ~30 fps cap
  }

  Serial.println(F("[Stream] Client disconnected"));
}

// ─────────────────────────────────────────────────────────────────────────────
//  LOCAL HTTP — SINGLE SNAPSHOT
// ─────────────────────────────────────────────────────────────────────────────
void serveSnapshot() {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) { localServer.send(500, "text/plain", "Capture failed"); return; }

  localServer.sendHeader("Content-Type",                    "image/jpeg");
  localServer.sendHeader("Access-Control-Allow-Origin",     "*");
  localServer.sendHeader("Cache-Control",                   "no-store");
  localServer.send_P(200, "image/jpeg", (const char*)fb->buf, fb->len);

  esp_camera_fb_return(fb);
}

// ─────────────────────────────────────────────────────────────────────────────
//  LOCAL HTTP — FLASH CONTROL
// ─────────────────────────────────────────────────────────────────────────────
void serveFlashOn() {
  flashOn = true;
  digitalWrite(FLASH_LED_PIN, HIGH);
  localServer.send(200, "text/plain", "ON");
}

void serveFlashOff() {
  flashOn = false;
  digitalWrite(FLASH_LED_PIN, LOW);
  localServer.send(200, "text/plain", "OFF");
}

// ─────────────────────────────────────────────────────────────────────────────
//  NTP SYNC
// ─────────────────────────────────────────────────────────────────────────────
void syncNtp() {
  if (WiFi.status() != WL_CONNECTED) return;
  Serial.println(F("[NTP] Syncing…"));
  configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER);

  struct tm ti;
  unsigned long t = millis();
  while (!getLocalTime(&ti, 500) && millis() - t < 15000);

  if (getLocalTime(&ti, 100)) {
    ntpSynced = true;
    tNtp = millis();
    char buf[24];
    strftime(buf, sizeof(buf), "%H:%M:%S %d-%m-%Y", &ti);
    Serial.printf("[NTP] Synced: %s\n", buf);
  } else {
    Serial.println(F("[NTP] Timeout — will retry"));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  VERCEL POLLING  — GET /api/esp32-ping
// ─────────────────────────────────────────────────────────────────────────────
void pollVercel() {
  if (WiFi.status() != WL_CONNECTED) return;

  String url = String(VERCEL_HOST) + F("/api/esp32-ping");

  WiFiClientSecure tls;
  tls.setInsecure();   // skips cert check; pin the Vercel root CA for production

  HTTPClient http;
  if (!http.begin(tls, url)) { Serial.println(F("[Poll] begin() failed")); return; }

  http.setTimeout(8000);
  http.addHeader("User-Agent",    "ESP32-CAM-Vercel/1.0");
  http.addHeader("Cache-Control", "no-cache");

  int code = http.GET();
  if (code != 200) {
    Serial.printf("[Poll] HTTP %d\n", code);
    http.end(); return;
  }

  String body = http.getString();
  http.end();
  Serial.printf("[Poll] %s\n", body.c_str());

  StaticJsonDocument<128> doc;
  if (deserializeJson(doc, body)) { Serial.println(F("[Poll] JSON error")); return; }

  const char* cmd   = doc["command"]   | "none";
  const char* cmdId = doc["commandId"] | "";

  if (strcmp(cmd, "none") != 0)
    executeCommand(String(cmd), String(cmdId));
}

// ─────────────────────────────────────────────────────────────────────────────
//  COMMAND DISPATCHER
// ─────────────────────────────────────────────────────────────────────────────
void executeCommand(const String& cmd, const String& cmdId) {
  Serial.printf("[Cmd] \"%s\"  id=%s\n", cmd.c_str(), cmdId.c_str());

  if (cmd == "snapshot") {
    uploadSnapshot(cmdId);
  } else if (cmd == "flash_on") {
    flashOn = true;
    digitalWrite(FLASH_LED_PIN, HIGH);
    Serial.println(F("[Cmd] Flash ON"));
  } else if (cmd == "flash_off") {
    flashOn = false;
    digitalWrite(FLASH_LED_PIN, LOW);
    Serial.println(F("[Cmd] Flash OFF"));
  } else {
    Serial.printf("[Cmd] Unknown command: %s\n", cmd.c_str());
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SNAPSHOT UPLOAD  — POST /api/snapshot  (raw JPEG bytes)
// ─────────────────────────────────────────────────────────────────────────────
/*
 * Sends the JPEG frame buffer directly as the HTTP body.
 * The Vercel API route receives it as a binary stream, stores it in KV,
 * and serves it back to the dashboard on GET /api/snapshot.
 *
 * Header X-Command-Id lets the server acknowledge which command was fulfilled.
 */
void uploadSnapshot(const String& cmdId) {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) { Serial.println(F("[Upload] Capture failed")); return; }

  Serial.printf("[Upload] Sending %u bytes to Vercel…\n", fb->len);

  String url = String(VERCEL_HOST) + F("/api/snapshot");

  WiFiClientSecure tls;
  tls.setInsecure();

  HTTPClient http;
  if (!http.begin(tls, url)) {
    Serial.println(F("[Upload] begin() failed"));
    esp_camera_fb_return(fb);
    return;
  }

  http.setTimeout(15000);
  http.addHeader("Content-Type", "image/jpeg");
  http.addHeader("User-Agent",   "ESP32-CAM-Vercel/1.0");
  if (cmdId.length()) http.addHeader("X-Command-Id", cmdId);

  // Timestamp header lets the server record when the shot was taken
  struct tm ti;
  if (getLocalTime(&ti, 100)) {
    char ts[24];
    strftime(ts, sizeof(ts), "%Y-%m-%dT%H:%M:%S", &ti);
    http.addHeader("X-Captured-At", ts);
  }

  int code = http.POST(fb->buf, fb->len);
  esp_camera_fb_return(fb);   // return ASAP — frees the camera buffer
  http.end();

  if (code == 200) {
    Serial.println(F("[Upload] OK"));
  } else {
    Serial.printf("[Upload] HTTP %d\n", code);
  }
}
