import { redis, requireRedis } from "./_redis.js";

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end",  () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (!requireRedis(res)) return;

  if (req.method === "POST") {
    const buf = await readBody(req);
    if (!buf.length) return res.status(400).json({ error: "Empty body" });

    const capturedAt = req.headers["x-captured-at"] || new Date().toISOString();
    const commandId  = req.headers["x-command-id"]  || "";

    await redis.set("esp32:snapshot",     buf.toString("base64"), { ex: 3600 });
    await redis.set("esp32:snapshotTime", capturedAt,              { ex: 3600 });
    await redis.set("esp32:snapshotSize", buf.length,              { ex: 3600 });

    console.log(`[snapshot] ${buf.length}B  cmd=${commandId}  at=${capturedAt}`);
    return res.status(200).json({ ok: true, size: buf.length });
  }

  if (req.method === "GET") {
    const b64 = await redis.get("esp32:snapshot");
    if (!b64) return res.status(404).json({ error: "No snapshot stored yet" });

    const buf = Buffer.from(b64, "base64");
    res.setHeader("Content-Type",   "image/jpeg");
    res.setHeader("Cache-Control",  "no-store");
    res.setHeader("Content-Length", buf.length);
    return res.end(buf);
  }

  return res.status(405).end("Method Not Allowed");
}
