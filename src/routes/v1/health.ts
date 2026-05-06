import { Router } from "express";
import { prisma } from "../../lib/prisma.js";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.json({
    status: "ok",
    service: "smartfarm-api"
  });
});

healthRouter.get("/ready", async (_req, res, next) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.json({
      status: "ready",
      service: "smartfarm-api",
      checks: {
        database: "ok"
      }
    });
  } catch (error) {
    next(error);
  }
});
