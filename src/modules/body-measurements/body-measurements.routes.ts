import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validateRequest } from "../../middleware/validation.js";
import { bodyMeasurementsController } from "./body-measurements.controller.js";
import {
  bodyMeasurementsDateParamsSchema,
  bodyMeasurementsListQuerySchema,
  bodyMeasurementsUpsertSchema,
} from "./body-measurements.schemas.js";

/** Private body measurements log, one entry per calendar day. `/api/v1` only. */
export const bodyMeasurementsRouter = Router();

bodyMeasurementsRouter.get(
  "/profile/me/body-measurements",
  requireAuth,
  validateRequest({ query: bodyMeasurementsListQuerySchema }),
  bodyMeasurementsController.list,
);

bodyMeasurementsRouter.put(
  "/profile/me/body-measurements/:date",
  requireAuth,
  validateRequest({
    params: bodyMeasurementsDateParamsSchema,
    body: bodyMeasurementsUpsertSchema,
  }),
  bodyMeasurementsController.upsert,
);

bodyMeasurementsRouter.delete(
  "/profile/me/body-measurements/:date",
  requireAuth,
  validateRequest({ params: bodyMeasurementsDateParamsSchema }),
  bodyMeasurementsController.delete,
);
