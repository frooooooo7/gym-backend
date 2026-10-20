import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import {
  followLimiter,
  handleCheckLimiter,
  searchLimiter,
  writeLimiter,
} from "../../middleware/rate-limit.js";
import { validateRequest } from "../../middleware/validation.js";
import { singleImageUpload } from "../../common/image-upload.js";
import { profileController } from "./profile.controller.js";
import {
  handleAvailabilityQuerySchema,
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
  writeLimiter,
  validateRequest({ body: profileUpdateSchema }),
  profileController.updateMe,
);

profileRouter.get(
  "/profile/handle-availability",
  requireAuth,
  handleCheckLimiter,
  validateRequest({ query: handleAvailabilityQuerySchema }),
  profileController.checkHandleAvailability,
);

profileRouter.post(
  "/profile/me/onboarding/complete",
  requireAuth,
  profileController.completeOnboarding,
);

profileRouter.post(
  "/profile/me/avatar",
  requireAuth,
  writeLimiter,
  singleImageUpload("avatar"),
  profileController.uploadAvatar,
);

profileRouter.delete(
  "/profile/me/avatar",
  requireAuth,
  profileController.deleteAvatar,
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
  "/users/search",
  requireAuth,
  searchLimiter,
  validateRequest({ query: userSearchQuerySchema }),
  profileController.searchUsers,
);

profileRouter.get(
  "/users/:userId/profile",
  requireAuth,
  validateRequest({ params: userIdParamsSchema }),
  profileController.getUserProfile,
);

profileRouter.get(
  "/users/:userId/following",
  requireAuth,
  validateRequest({ params: userIdParamsSchema, query: profileListQuerySchema }),
  profileController.getUserFollowing,
);

profileRouter.get(
  "/users/:userId/followers",
  requireAuth,
  validateRequest({ params: userIdParamsSchema, query: profileListQuerySchema }),
  profileController.getUserFollowers,
);

profileRouter.post(
  "/users/:userId/follow",
  requireAuth,
  followLimiter,
  validateRequest({ params: userIdParamsSchema }),
  profileController.follow,
);

profileRouter.delete(
  "/users/:userId/follow",
  requireAuth,
  followLimiter,
  validateRequest({ params: userIdParamsSchema }),
  profileController.unfollow,
);
