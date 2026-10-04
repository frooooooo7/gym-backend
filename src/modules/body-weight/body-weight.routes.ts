import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validateRequest } from "../../middleware/validation.js";
import { bodyWeightController } from "./body-weight.controller.js";
import {
  bodyWeightDateParamsSchema,
  bodyWeightListQuerySchema,
  bodyWeightUpsertSchema,
} from "./body-weight.schemas.js";

/** Private body weight log, one entry per calendar day. `/api/v1` only. */
export const bodyWeightRouter = Router();

bodyWeightRouter.get(
  "/profile/me/body-weight",
  requireAuth,
  validateRequest({ query: bodyWeightListQuerySchema }),
  bodyWeightController.list,
);

bodyWeightRouter.put(
  "/profile/me/body-weight/:date",
  requireAuth,
  validateRequest({
    params: bodyWeightDateParamsSchema,
    body: bodyWeightUpsertSchema,
  }),
  bodyWeightController.upsert,
);

bodyWeightRouter.delete(
  "/profile/me/body-weight/:date",
  requireAuth,
  validateRequest({ params: bodyWeightDateParamsSchema }),
  bodyWeightController.delete,
);
