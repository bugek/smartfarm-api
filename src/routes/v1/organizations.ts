import { Router } from "express";

export const organizationsRouter = Router();

organizationsRouter.get("/", (_req, res) => {
  res.json({
    items: [],
    nextAction: "Implement tenancy and role-aware organization listing for OME-10."
  });
});
