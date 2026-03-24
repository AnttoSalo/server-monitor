import { Router } from "express";
import { getLastProcesses, getPM2Logs } from "../collectors/pm2.js";

const router = Router();

router.get("/", (_req, res) => {
  res.json({ processes: getLastProcesses() });
});

router.get("/logs/:name", async (req, res) => {
  const { name } = req.params;
  const lines = Math.min(parseInt(req.query.lines as string) || 100, 500);

  // Validate name — alphanumeric, dashes, underscores only
  if (!/^[\w-]+$/.test(name)) {
    res.status(400).json({ error: "Invalid process name" });
    return;
  }

  const logLines = await getPM2Logs(name, lines);
  res.json({ processName: name, lines: logLines });
});

export default router;
