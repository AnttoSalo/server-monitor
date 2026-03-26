import { Router } from "express";
import { getHistory } from "../collectors/system.js";

const router = Router();

const RANGE_MAP: Record<string, number> = {
  "1h": 3_600_000,
  "6h": 21_600_000,
  "24h": 86_400_000,
  "7d": 604_800_000,
};

router.get("/json", async (req, res) => {
  const range = (req.query.range as string) || "24h";
  const rangeMs = RANGE_MAP[range] || RANGE_MAP["24h"];
  const entries = await getHistory(rangeMs);
  res.setHeader("Content-Disposition", `attachment; filename="system-history-${range}.json"`);
  res.json(entries);
});

router.get("/csv", async (req, res) => {
  const range = (req.query.range as string) || "24h";
  const rangeMs = RANGE_MAP[range] || RANGE_MAP["24h"];
  const entries = await getHistory(rangeMs);

  if (entries.length === 0) {
    res.setHeader("Content-Type", "text/csv");
    res.send("No data");
    return;
  }

  const headers = Object.keys(entries[0]);
  const csv = [
    headers.join(","),
    ...entries.map((e) => headers.map((h) => (e as unknown as Record<string, unknown>)[h] ?? "").join(",")),
  ].join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="system-history-${range}.csv"`);
  res.send(csv);
});

export default router;
