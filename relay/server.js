/**
 * ESP32-CAM Local Relay Server
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs on your machine (same Wi-Fi as the ESP32-CAM) and proxies all requests
 * to the camera. Expose it to the internet via Cloudflare Tunnel or ngrok so
 * your Vercel dashboard can reach it over HTTPS.
 *
 * Usage:
 *   node server.js                        # default: ESP32 at 192.168.4.1:80
 *   ESP32_IP=10.0.0.42 node server.js     # custom IP
 *   PORT=3001 node server.js              # custom port
 */

import express  from "express";
import cors     from "cors";
import fetch    from "node-fetch";
import http     from "http";

// ─── config ──────────────────────────────────────────────────────────────────
const PORT     = parseInt(process.env.PORT    ?? "3000", 10);
const ESP32_IP = process.env.ESP32_IP         ?? "192.168.4.1";
const ESP32_PORT = parseInt(process.env.ESP32_PORT ?? "80", 10);

const CAM_BASE = `http://${ESP32_IP}:${ESP32_PORT}`;

// ─── app ─────────────────────────────────────────────────────────────────────
const app = express();

// Allow requests from any origin (the Vercel dashboard)
app.use(cors({ origin: "*" }));

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Proxy a simple JSON/text response from the ESP32 */
async function proxySimple(espPath, res) {
  try {
    const upstream = await fetch(`${CAM_BASE}${espPath}`, { timeout: 5000 });
    const text = await upstream.text();
    res.status(upstream.status).send(text);
  } catch (err) {
    console.error(`[relay] ${espPath} →`, err.message);
    res.status(502).json({ error: "ESP32 unreachable", detail: err.message });
  }
}

// ─── health ──────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    relay: "ok",
    esp32: CAM_BASE,
    ts: new Date().toISOString(),
  });
});

// ─── flash control ───────────────────────────────────────────────────────────
app.get("/flash/on",  (_req, res) => proxySimple("/flash/on",  res));
app.get("/flash/off", (_req, res) => proxySimple("/flash/off", res));

// ─── snapshot ─────────────────────────────────────────────────────────────────
app.get("/snapshot", async (_req, res) => {
  try {
    const upstream = await fetch(`${CAM_BASE}/snapshot`, { timeout: 8000 });
    if (!upstream.ok) {
      return res.status(upstream.status).send("ESP32 error");
    }
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "no-store");
    upstream.body.pipe(res);
  } catch (err) {
    console.error("[relay] /snapshot →", err.message);
    res.status(502).json({ error: "ESP32 unreachable", detail: err.message });
  }
});

// ─── MJPEG stream ─────────────────────────────────────────────────────────────
// The MJPEG stream is a long-lived multipart HTTP response.
// We pipe it straight through so the browser receives the raw frames.
app.get("/stream", (req, res) => {
  const agent = new http.Agent({ keepAlive: true });

  console.log(`[relay] /stream  client connected  (${req.ip})`);

  const upstreamReq = http.get(
    { hostname: ESP32_IP, port: ESP32_PORT, path: "/stream", agent },
    (upstreamRes) => {
      // Forward every header the ESP32 sends
      Object.entries(upstreamRes.headers).forEach(([k, v]) => res.setHeader(k, v));
      // Ensure CORS is set even for the stream
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "no-store");

      res.writeHead(200);
      upstreamRes.pipe(res);

      upstreamRes.on("end", () => {
        console.log("[relay] /stream  upstream ended");
      });
    }
  );

  upstreamReq.on("error", (err) => {
    console.error("[relay] /stream →", err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: "ESP32 stream unreachable", detail: err.message });
    } else {
      res.end();
    }
  });

  // If the dashboard client disconnects, kill the upstream request too
  req.on("close", () => {
    console.log(`[relay] /stream  client disconnected (${req.ip})`);
    upstreamReq.destroy();
  });
});

// ─── start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log("");
  console.log("╔══════════════════════════════════════════╗");
  console.log("║       ESP32-CAM Local Relay Server       ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log(`  ESP32-CAM target : ${CAM_BASE}`);
  console.log(`  Relay listening  : http://localhost:${PORT}`);
  console.log("");
  console.log("  Endpoints:");
  console.log(`    GET /health      → relay status`);
  console.log(`    GET /stream      → proxied MJPEG stream`);
  console.log(`    GET /snapshot    → proxied JPEG snapshot`);
  console.log(`    GET /flash/on    → flash on`);
  console.log(`    GET /flash/off   → flash off`);
  console.log("");
  console.log("  To expose via Cloudflare Tunnel (free, no sign-up):");
  console.log(`    cloudflared tunnel --url http://localhost:${PORT}`);
  console.log("");
  console.log("  Then paste the tunnel URL into the dashboard → Relay URL field.");
  console.log("══════════════════════════════════════════════");
});
