import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validateRequest } from "../../middleware/validation.js";
import { profileController } from "./profile.controller.js";
import {
  profileActivitiesQuerySchema,
  profileListQuerySchema,
  profileUpdateSchema,
  userIdParamsSchema,
  userSearchQuerySchema,
} from "./profile.schemas.js";

export const profileRouter = Router();

profileRouter.get("/profile/me", requireAuth, profileController.getMe);

profileRouter.patch(
  "/profile/me",
  requireAuth,
  validateRequest({ body: profileUpdateSchema }),
  profileController.updateMe,
);

profileRouter.get(
  "/profile/following",
  requireAuth,
  validateRequest({ query: profileListQuerySchema }),
  profileController.getFollowing,
);

profileRouter.get(
  "/profile/followers",
  requireAuth,
  validateRequest({ query: profileListQuerySchema }),
  profileController.getFollowers,
);

profileRouter.get(
  "/profile/activities",
  requireAuth,
  validateRequest({ query: profileActivitiesQuerySchema }),
  profileController.getActivities,
);

profileRouter.get(
  "/users/search",
  requireAuth,
  validateRequest({ query: userSearchQuerySchema }),
  profileController.searchUsers,
);

profileRouter.get(
  "/users/:userId/activities",
  requireAuth,
  validateRequest({
    params: userIdParamsSchema,
    query: profileActivitiesQuerySchema,
  }),
  profileController.getUserActivities,
);

profileRouter.get(
  "/users/:userId/profile",
  requireAuth,
  validateRequest({ params: userIdParamsSchema }),
  profileController.getUserProfile,
);

