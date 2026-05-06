import type { Express, Request, Response } from "express";
import { healthRouter } from "./v1/health.js";
import { organizationsRouter } from "./v1/organizations.js";

export function registerRoutes(app: Express) {
  app.get("/", (_req: Request, res: Response) => {
    res.json({
      service: "smartfarm-api",
      status: "ok"
    });
  });

  app.use("/api/v1/health", healthRouter);
  app.use("/api/v1/organizations", organizationsRouter);
}

