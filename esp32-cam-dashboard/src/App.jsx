import { useState, useRef, useCallback, useEffect } from "react";
import "./App.css";

// ─── storage keys ─────────────────────────────────────────────────────────────
const KEY_IP        = "esp32cam_ip";
const KEY_RELAY_URL = "esp32cam_relay_url";
const KEY_MODE      = "esp32cam_mode"; // "direct" | "relay"

const DEFAULT_IP    = "192.168.4.1";

// ─── helpers ──────────────────────────────────────────────────────────────────
function buildUrl(mode, ip, relayUrl, path) {
  if (mode === "relay" && relayUrl) {
    return `${relayUrl.replace(/\/$/, "")}${path}`;
  }
  return `http://${ip}${path}`;
}

function isHttps() {
  return typeof window !== "undefined" && window.location.protocol === "https:";
}

function fmtUptime(s) {
  const h   = String(Math.floor(s / 3600)).padStart(2, "0");
  const m   = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

// ─── sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const MAP = {
    live:         { cls: "badge--online",  dot: true,  label: "Live"        },
    connecting:   { cls: "badge--warn",    dot: true,  label: "Connecting…" },
    disconnected: { cls: "badge--offline", dot: false, label: "Disconnected"},
  };
  const { cls, dot, label } = MAP[status] ?? MAP.disconnected;
  return (
    <span className={`badge ${cls}`}>
      {dot && <span className="badge__dot" />}
      {label}
    </span>
  );
}

function Card({ title, icon, children }) {
  return (
    <div className="card">
      <div className="card__header">
        <span className="card__icon">{icon}</span>
        <h3 className="card__title">{title}</h3>
      </div>
      <div className="card__body">{children}</div>
    </div>
  );
}

function IconButton({ onClick, disabled, active, icon, label, variant }) {
  return (
    <button
      className={`icon-btn icon-btn--${variant ?? "default"} ${active ? "icon-btn--active" : ""}`}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      <span className="icon-btn__icon">{icon}</span>
      <span className="icon-btn__label">{label}</span>
    </button>
  );
}

// ─── mixed-content banner (only in direct mode on HTTPS) ──────────────────────
function MixedContentBanner({ ip, mode }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || mode === "relay" || !isHttps()) return null;
  return (
    <div className="banner banner--warn">
      <div className="banner__body">
        <span className="banner__icon">⚠️</span>
        <div>
          <strong>HTTPS → HTTP Blocked (Direct mode)</strong>
          <p>
            Browsers block <code>http://</code> requests from an <code>https://</code> page.
            Switch to <strong>Relay mode</strong> to fix this — start the local relay server
            and paste its tunnel URL.
          </p>
        </div>
      </div>
      <button className="banner__close" onClick={() => setDismissed(true)}>✕</button>
    </div>
  );
}

// ─── connection panel ─────────────────────────────────────────────────────────
function ConnectionPanel({
  mode, setMode,
  ip, draftIp, setDraftIp, onApplyIp,
  relayUrl, draftRelay, setDraftRelay, onApplyRelay,
  testState, onTest,
}) {
  return (
    <Card title="Connection" icon="🌐">

      {/* mode tabs */}
      <div className="mode-tabs">
        <button
          className={`mode-tab ${mode === "direct" ? "mode-tab--active" : ""}`}
          onClick={() => setMode("direct")}
        >
          📡 Direct
        </button>
        <button
          className={`mode-tab ${mode === "relay" ? "mode-tab--active" : ""}`}
          onClick={() => setMode("relay")}
        >
          🔀 Relay (API)
        </button>
      </div>

      {mode === "direct" ? (
        <>
          <p className="mode-desc">
            Direct connection to the ESP32-CAM over your local Wi-Fi.
            Works when your device is on the same network as the camera.
          </p>
          <form className="ip-form" onSubmit={onApplyIp}>
            <label className="ip-form__label" htmlFor="ip-input">ESP32-CAM IP</label>
            <div className="ip-form__row">
              <input
                id="ip-input"
                className="ip-form__input"
                type="text"
                value={draftIp}
                onChange={(e) => setDraftIp(e.target.value)}
                placeholder="192.168.4.1"
                spellCheck={false}
                autoComplete="off"
              />
              <button className="ip-form__btn" type="submit">Apply</button>
            </div>
            <div className="ip-form__meta">
              <span className="ip-form__hint">Active: <code>{ip}</code></span>
              <TestButton state={testState} onClick={onTest} />
            </div>
          </form>
          <SetupSteps />
        </>
      ) : (
        <>
          <p className="mode-desc">
            Route all camera traffic through a local relay server exposed via a
            Cloudflare tunnel. Works from anywhere — even over Vercel HTTPS.
          </p>
          <form className="ip-form" onSubmit={onApplyRelay}>
            <label className="ip-form__label" htmlFor="relay-input">Relay / Tunnel URL</label>
            <div className="ip-form__row">
              <input
                id="relay-input"
                className="ip-form__input"
                type="url"
                value={draftRelay}
                onChange={(e) => setDraftRelay(e.target.value)}
                placeholder="https://xxxx.trycloudflare.com"
                spellCheck={false}
                autoComplete="off"
              />
              <button className="ip-form__btn" type="submit">Apply</button>
            </div>
            <div className="ip-form__meta">
              <span className="ip-form__hint">
                Active: <code>{relayUrl || "not set"}</code>
              </span>
              <TestButton state={testState} onClick={onTest} />
            </div>
          </form>
          <RelayInstructions />
        </>
      )}
    </Card>
  );
}

function TestButton({ state, onClick }) {
  const MAP = {
    idle:    { label: "🔍 Test",        cls: "" },
    testing: { label: "⏳ Testing…",    cls: "",             disabled: true },
    ok:      { label: "✅ Reachable",   cls: "test-btn--ok"  },
    fail:    { label: "❌ Unreachable", cls: "test-btn--fail"},
  };
  const { label, cls, disabled } = MAP[state] ?? MAP.idle;
  return (
    <button type="button" className={`test-btn ${cls}`} onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
}

function SetupSteps() {
  return (
    <div className="setup-help">
      <p className="setup-help__title">📶 Quick Setup</p>
      <ol className="setup-help__steps">
        <li>Power on your ESP32-CAM</li>
        <li>Connect to Wi-Fi: <code>ESP32-CAM-LIVE</code> / <code>12345678</code></li>
        <li>Default IP is <code>192.168.4.1</code> — click <strong>Test</strong></li>
      </ol>
    </div>
  );
}

function RelayInstructions() {
  return (
    <div className="setup-help">
      <p className="setup-help__title">🔀 Relay Setup (one-time)</p>
      <ol className="setup-help__steps">
        <li>
          Connect your computer to <code>ESP32-CAM-LIVE</code> Wi-Fi
        </li>
        <li>
          In <code>relay/</code> folder run: <code>npm install && npm start</code>
        </li>
        <li>
          In another terminal: <code>cloudflared tunnel --url http://localhost:3000</code>
        </li>
        <li>
          Copy the <code>https://xxxx.trycloudflare.com</code> URL and paste it above
        </li>
      </ol>
    </div>
  );
}

// ─── main app ─────────────────────────────────────────────────────────────────
export default function App() {
  const [ip,           setIp]          = useState(() => localStorage.getItem(KEY_IP) ?? DEFAULT_IP);
  const [draftIp,      setDraftIp]     = useState(() => localStorage.getItem(KEY_IP) ?? DEFAULT_IP);
  const [relayUrl,     setRelayUrl]    = useState(() => localStorage.getItem(KEY_RELAY_URL) ?? "");
  const [draftRelay,   setDraftRelay]  = useState(() => localStorage.getItem(KEY_RELAY_URL) ?? "");
  const [mode,         setMode]        = useState(() => localStorage.getItem(KEY_MODE) ?? "direct");

  const [streaming,    setStreaming]    = useState(false);
  const [streamStatus, setStreamStatus]= useState("disconnected");
  const [flashOn,      setFlashOn]     = useState(false);
  const [snapshot,     setSnapshot]    = useState(null);
  const [snapshotTime, setSnapshotTime]= useState(null);
  const [toasts,       setToasts]      = useState([]);
  const [frameCount,   setFrameCount]  = useState(0);
  const [streamKey,    setStreamKey]   = useState(0);
  const [testState,    setTestState]   = useState("idle");
  const [uptime,       setUptime]      = useState(0);

  const frameRef   = useRef(0);
  const uptimeRef  = useRef(null);

  // ── persist settings ──────────────────────────────────────────────────────
  useEffect(() => { localStorage.setItem(KEY_IP,        ip);       }, [ip]);
  useEffect(() => { localStorage.setItem(KEY_RELAY_URL, relayUrl); }, [relayUrl]);
  useEffect(() => { localStorage.setItem(KEY_MODE,      mode);     }, [mode]);

  // ── uptime ticker ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (streamStatus === "live") {
      uptimeRef.current = setInterval(() => setUptime((s) => s + 1), 1000);
    } else {
      clearInterval(uptimeRef.current);
      if (streamStatus !== "connecting") setUptime(0);
    }
    return () => clearInterval(uptimeRef.current);
  }, [streamStatus]);

  // ── current base URL based on mode ───────────────────────────────────────
  const url = useCallback(
    (path) => buildUrl(mode, ip, relayUrl, path),
    [mode, ip, relayUrl]
  );

  // ── toast ─────────────────────────────────────────────────────────────────
  const addToast = useCallback((msg, type = "info") => {
    const id = Date.now();
    setToasts((p) => [...p, { id, msg, type }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 4000);
  }, []);

  // ── connection test ───────────────────────────────────────────────────────
  async function testConnection() {
    setTestState("testing");
    const endpoint = mode === "relay"
      ? `${relayUrl.replace(/\/$/, "")}/health`
      : buildUrl("direct", ip, "", "/snapshot");
    try {
      await fetch(endpoint, {
        mode: mode === "relay" ? "cors" : "no-cors",
        signal: AbortSignal.timeout(5000),
      });
      setTestState("ok");
      addToast("Connection test passed ✅", "success");
    } catch {
      setTestState("fail");
      addToast("Cannot reach target ❌ — check IP / relay URL", "error");
    }
    setTimeout(() => setTestState("idle"), 6000);
  }

  // ── mode switch ───────────────────────────────────────────────────────────
  function switchMode(m) {
    setMode(m);
    setStreaming(false);
    setStreamStatus("disconnected");
    setTestState("idle");
  }

  // ── stream ────────────────────────────────────────────────────────────────
  function startStream() {
    if (mode === "relay" && !relayUrl) {
      addToast("Set a Relay URL first.", "error"); return;
    }
    setStreamKey((k) => k + 1);
    frameRef.current = 0;
    setFrameCount(0);
    setStreamStatus("connecting");
    setStreaming(true);
    addToast("Connecting to stream…", "info");
  }
  function stopStream() {
    setStreaming(false);
    setStreamStatus("disconnected");
    addToast("Stream stopped.", "info");
  }
  function onStreamLoad() {
    setStreamStatus("live");
    frameRef.current += 1;
    setFrameCount(frameRef.current);
  }
  function onStreamError() {
    if (streaming) {
      setStreamStatus("disconnected");
      addToast("Stream lost — check connection.", "error");
      setStreaming(false);
    }
  }

  // ── snapshot ──────────────────────────────────────────────────────────────
  async function takeSnapshot() {
    addToast("Capturing…", "info");
    try {
      const res = await fetch(url("/snapshot"));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      if (snapshot) URL.revokeObjectURL(snapshot);
      setSnapshot(objUrl);
      setSnapshotTime(new Date().toLocaleTimeString());
      addToast("Snapshot captured! 📸", "success");
    } catch (e) {
      addToast(`Snapshot failed: ${e.message}`, "error");
    }
  }

  function downloadSnapshot() {
    if (!snapshot) return;
    const a = document.createElement("a");
    a.href = snapshot;
    a.download = `esp32cam-${Date.now()}.jpg`;
    a.click();
  }

  // ── flash ─────────────────────────────────────────────────────────────────
  async function toggleFlash() {
    const path = flashOn ? "/flash/off" : "/flash/on";
    try {
      const res = await fetch(url(path));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setFlashOn((f) => !f);
      addToast(`Flash ${!flashOn ? "ON 💡" : "OFF 🔦"}`, "success");
    } catch (e) {
      addToast(`Flash failed: ${e.message}`, "error");
    }
  }

  // ── apply IP / relay ──────────────────────────────────────────────────────
  function onApplyIp(e) {
    e.preventDefault();
    const v = draftIp.trim();
    setIp(v);
    setStreaming(false);
    setStreamStatus("disconnected");
    addToast(`IP set → ${v}`, "info");
  }

  function onApplyRelay(e) {
    e.preventDefault();
    const v = draftRelay.trim();
    setRelayUrl(v);
    setStreaming(false);
    setStreamStatus("disconnected");
    addToast(`Relay URL set → ${v || "(cleared)"}`, "info");
  }

  // ─── render ───────────────────────────────────────────────────────────────
  return (
    <div className="app">
      <MixedContentBanner ip={ip} mode={mode} />

      {/* top bar */}
      <header className="topbar">
        <div className="topbar__left">
          <span className="topbar__logo">📷</span>
          <span className="topbar__title">ESP32-CAM</span>
          <span className="topbar__subtitle">Dashboard</span>
        </div>
        <div className="topbar__right">
          <span className={`mode-pill mode-pill--${mode}`}>
            {mode === "relay" ? "🔀 Relay" : "📡 Direct"}
          </span>
          <StatusBadge status={streamStatus} />
        </div>
      </header>

      <main className="main">
        {/* ── stream column ── */}
        <section className="col col--stream">
          <Card title="Live Stream" icon="🎥">
            <div className="stream-viewport">
              {streaming ? (
                <>
                  {streamStatus === "connecting" && (
                    <div className="stream-overlay">
                      <div className="spinner" />
                      <p>Connecting…</p>
                    </div>
                  )}
                  <img
                    key={streamKey}
                    className="stream-img"
                    src={url("/stream")}
                    alt="Live MJPEG feed"
                    onLoad={onStreamLoad}
                    onError={onStreamError}
                  />
                </>
              ) : (
                <div className="stream-placeholder">
                  <span className="stream-placeholder__icon">📷</span>
                  <p>Stream is off</p>
                  <p className="stream-placeholder__sub">Press <strong>Start Stream</strong> below</p>
                </div>
              )}
              {streamStatus === "live" && <div className="live-pill">● LIVE</div>}
            </div>

            <div className="stream-controls">
              {!streaming
                ? <IconButton icon="▶" label="Start Stream" variant="success" onClick={startStream} />
                : <IconButton icon="⏹" label="Stop Stream"  variant="danger"  onClick={stopStream}  />}
              <IconButton icon="📸" label="Snapshot" variant="primary" onClick={takeSnapshot} />
              <IconButton
                icon={flashOn ? "💡" : "🔦"}
                label={flashOn ? "Flash OFF" : "Flash ON"}
                variant={flashOn ? "warning" : "default"}
                active={flashOn}
                onClick={toggleFlash}
              />
            </div>
          </Card>

          {snapshot && (
            <Card title="Last Snapshot" icon="🖼️">
              <img className="snapshot-img" src={snapshot} alt={`Snapshot at ${snapshotTime}`} />
              <div className="snapshot-footer">
                <span className="snapshot-time">📅 {snapshotTime}</span>
                <button className="snapshot-dl-btn" onClick={downloadSnapshot}>⬇ Download</button>
              </div>
            </Card>
          )}
        </section>

        {/* ── side column ── */}
        <aside className="col col--side">
          <ConnectionPanel
            mode={mode}      setMode={switchMode}
            ip={ip}          draftIp={draftIp}    setDraftIp={setDraftIp}   onApplyIp={onApplyIp}
            relayUrl={relayUrl} draftRelay={draftRelay} setDraftRelay={setDraftRelay} onApplyRelay={onApplyRelay}
            testState={testState} onTest={testConnection}
          />

          {/* stats */}
          <Card title="Stats" icon="📊">
            <ul className="stats-list">
              {[
                ["Mode",     mode === "relay" ? "🔀 Relay" : "📡 Direct"],
                ["Stream",   streaming ? (streamStatus === "live" ? "🟢 Live" : "🟡 Connecting") : "⚫ Off"],
                ["Uptime",   streamStatus === "live" ? fmtUptime(uptime) : "—"],
                ["Frames",   frameCount],
                ["Flash",    flashOn ? "💡 ON" : "🔦 OFF"],
                ["Snapshot", snapshotTime ?? "—"],
              ].map(([k, v]) => (
                <li key={k} className="stats-list__item">
                  <span className="stats-list__key">{k}</span>
                  <span className="stats-list__val">{v}</span>
                </li>
              ))}
            </ul>
          </Card>

          {/* endpoints */}
          <Card title="Endpoints" icon="🔗">
            <ul className="endpoint-list">
              {[
                ["/health",    "Relay health",  "💚"],
                ["/stream",    "MJPEG Stream",  "🎥"],
                ["/snapshot",  "Snapshot",      "📸"],
                ["/flash/on",  "Flash ON",      "💡"],
                ["/flash/off", "Flash OFF",     "🔦"],
              ].map(([path, label, emo]) => (
                <li key={path} className="endpoint-list__item">
                  <a href={url(path)} target="_blank" rel="noreferrer" className="endpoint-list__link">
                    <span className="endpoint-list__emo">{emo}</span>
                    <code className="endpoint-list__path">{path}</code>
                    <span className="endpoint-list__desc">{label}</span>
                    <span className="endpoint-list__arrow">↗</span>
                  </a>
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </main>

      {/* toasts */}
      <div className="toast-rack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.type}`}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}
