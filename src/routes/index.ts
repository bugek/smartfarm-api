import type { Express, Request, Response } from "express";
import { ZodError } from "zod";
import { authRouter } from "./v1/auth.js";
import { cropCyclesRouter } from "./v1/crop-cycles.js";
import { documentsRouter } from "./v1/documents.js";
import { evidenceRouter } from "./v1/evidence.js";
import { gapRecordsRouter } from "./v1/gap-records.js";
import { healthRouter } from "./v1/health.js";
import { farmSitesRouter } from "./v1/farm-sites.js";
import { organizationsRouter } from "./v1/organizations.js";
import { plotsRouter } from "./v1/plots.js";
import { reviewQueueRouter } from "./v1/review-queue.js";
import { reviewsRouter } from "./v1/reviews.js";

export function registerRoutes(app: Express) {
  app.get("/", (_req: Request, res: Response) => {
    res.json({
      service: "smartfarm-api",
      status: "ok"
    });
  });

  app.use("/api/v1/health", healthRouter);
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/organizations", organizationsRouter);
  app.use("/api/v1/farm-sites", farmSitesRouter);
  app.use("/api/v1/plots", plotsRouter);
  app.use("/api/v1/crop-cycles", cropCyclesRouter);
  app.use("/api/v1/gap-records", gapRecordsRouter);
  app.use("/api/v1/documents", documentsRouter);
  app.use("/api/v1/evidence", evidenceRouter);
  app.use("/api/v1/review-queue", reviewQueueRouter);
  app.use("/api/v1/reviews", reviewsRouter);

  app.use((error: unknown, _req: Request, res: Response, _next: () => void) => {
    if (error instanceof ZodError) {
      return res.status(400).json({
        error: {
          code: "validation_error",
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message
          }))
        }
      });
    }

    console.error(error);

    return res.status(500).json({
      error: {
        code: "internal_server_error",
        message: "An unexpected error occurred."
      }
    });
  });
}
