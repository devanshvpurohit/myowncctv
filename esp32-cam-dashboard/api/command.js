import { redis } from "./_redis.js";

const VALID = new Set(["snapshot", "flash_on", "flash_off"]);

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end",  () => { try { resolve(JSON.parse(raw)); } catch { reject(new Error("Invalid JSON")); } });
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  let body;
  try { body = await readJson(req); }
  catch { return res.status(400).json({ error: "Invalid JSON" }); }

  const { command } = body;
  if (!command || !VALID.has(command))
    return res.status(400).json({ error: `Valid commands: ${[...VALID].join(", ")}` });

  const commandId = Date.now().toString();
  await redis.set("esp32:command", JSON.stringify({ command, commandId }), { ex: 60 });

  // Track flash state optimistically so /api/status reflects it instantly
  if (command === "flash_on")  await redis.set("esp32:flashState", "on",  { ex: 3600 });
  if (command === "flash_off") await redis.set("esp32:flashState", "off", { ex: 3600 });

  console.log(`[command] queued "${command}" id=${commandId}`);
  return res.status(200).json({ ok: true, commandId });
}
