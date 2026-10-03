import { redis, requireRedis } from "./_redis.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end("Method Not Allowed");
  if (!requireRedis(res)) return;

  await redis.set("esp32:lastSeen", Date.now(), { ex: 30 });

  const raw = await redis.get("esp32:command");
  if (raw) {
    await redis.del("esp32:command");
    const pending = typeof raw === "string" ? JSON.parse(raw) : raw;
    return res.status(200).json(pending);
  }

  return res.status(200).json({ command: "none" });
}
