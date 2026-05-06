import express from "express";
import { registerRoutes } from "./routes/index.js";

export function createApp() {
  const app = express();

  app.use(express.json());
  registerRoutes(app);

  return app;
}

