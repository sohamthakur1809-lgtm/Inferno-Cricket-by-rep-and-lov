import { Router, type IRouter } from "express";

const router: IRouter = Router();

// Render health check hits /health at the root (see render.yaml).
router.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Kept for API consumers that expect /api/healthz
router.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

export default router;
