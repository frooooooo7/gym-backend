import { Router } from "express";
import { healthController } from "./health.controller.js";

export const healthRouter = Router();

healthRouter.get("/health", healthController.getHealth);
healthRouter.get("/ready", healthController.getReady);
