import { Router } from "express";
import { getLastConnectivity, getConnectivityHistory } from "../collectors/connectivity.js";

const router = Router();

const RANGE_MAP: Record<string, number> = {
  "1h": 3_600_000,
  "6h": 21_600_000,
  "24h": 86_400_000,
};

router.get("/", (_req, res) => {
  res.json(getLastConnectivity());
});

router.get("/history", async (req, res) => {
  const range = (req.query.range as string) || "1h";
  const rangeMs = RANGE_MAP[range] || RANGE_MAP["1h"];
  const entries = await getConnectivityHistory(rangeMs);
  res.json({ entries, range });
});

export default router;
