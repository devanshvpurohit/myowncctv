import { redis } from "./_redis.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end("Method Not Allowed");

  const [lastSeen, snapshotTime, snapshotSize, flashState] = await Promise.all([
    redis.get("esp32:lastSeen"),
    redis.get("esp32:snapshotTime"),
    redis.get("esp32:snapshotSize"),
    redis.get("esp32:flashState"),
  ]);

  const online = lastSeen !== null && Date.now() - Number(lastSeen) < 15_000;

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    online,
    lastSeen:     lastSeen ? new Date(Number(lastSeen)).toISOString() : null,
    hasSnapshot:  snapshotTime !== null,
    snapshotTime: snapshotTime || null,
    snapshotSize: snapshotSize ? Number(snapshotSize) : null,
    flashOn:      flashState === "on",
  });
}
