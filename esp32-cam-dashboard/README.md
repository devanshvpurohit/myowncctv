# ESP32-CAM Dashboard

A React dashboard for monitoring and controlling your **ESP32-CAM** over Wi-Fi.

Built with Vite + React. Deployable to [Vercel](https://vercel.com) in one click.

---

## Features

| Feature | Details |
|---|---|
| 🎥 Live MJPEG stream | Browser-native multipart via `<img>` |
| 📸 Snapshot | Captures JPEG, shows preview, download button |
| 💡 Flash toggle | ON / OFF in one click |
| 🌐 Configurable IP | Change target on the fly, persisted in `localStorage` |
| 🔍 Connection test | Quick reachability probe before streaming |
| 📊 Stats panel | Live uptime, frame counter, flash state |
| ⚠️ Mixed-content banner | Auto-detects HTTPS and guides user to fix it |

---

## Development

```bash
npm install
npm run dev
```

---

## Deploy to Vercel

### Option A — Vercel CLI

```bash
npm install -g vercel
vercel
```

### Option B — GitHub

1. Push this folder to a GitHub repo
2. Go to [vercel.com/new](https://vercel.com/new)
3. Import your repo — Vercel auto-detects Vite ✅

---

## ⚠️ HTTPS ↔ HTTP Mixed Content

Vercel always serves over **HTTPS**. Your ESP32-CAM speaks plain **HTTP**.  
Browsers block HTTP requests made from an HTTPS page (_mixed content policy_).

The dashboard detects this and shows a banner with three fix options:

1. **Open the dashboard directly on the ESP32** at `http://192.168.4.1`  
   _(copy the built `dist/` files to SPIFFS/LittleFS on the ESP32)_
2. **Open the Vercel URL over HTTP** (change `https://` → `http://` in the address bar)
3. **Allow insecure content** in browser settings for this site

---

## ESP32-CAM Endpoints

| Path | Description |
|---|---|
| `/` | HTML home page |
| `/stream` | MJPEG live stream |
| `/snapshot` | Single JPEG capture |
| `/flash/on` | Flash LED on |
| `/flash/off` | Flash LED off |

Default IP (AP mode): **`192.168.4.1`**  
Wi-Fi SSID: `ESP32-CAM-LIVE` / Password: `12345678`
