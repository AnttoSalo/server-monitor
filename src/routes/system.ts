import { Router } from "express";
import { getLastStats, getHistory } from "../collectors/system.js";

const router = Router();

const RANGE_MAP: Record<string, number> = {
  "1h": 3_600_000,
  "6h": 21_600_000,
  "24h": 86_400_000,
  "7d": 604_800_000,
};

router.get("/", (_req, res) => {
  const stats = getLastStats();
  if (!stats) {
    res.json({ cpu: 0, memory: { used: 0, total: 0, percent: 0 }, disk: [], network: { rxKBps: 0, txKBps: 0, interfaces: [] } });
    return;
  }
  res.json(stats);
});

router.get("/history", async (req, res) => {
  const range = (req.query.range as string) || "1h";
  const rangeMs = RANGE_MAP[range] || RANGE_MAP["1h"];
  const entries = await getHistory(rangeMs);
  res.json({ entries, range });
});

export default router;
