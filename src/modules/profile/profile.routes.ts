import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { profileController } from "./profile.controller.js";

export const profileRouter = Router();

profileRouter.get("/profile/me", requireAuth, profileController.getMe);
profileRouter.patch("/profile/me", requireAuth, profileController.updateMe);
profileRouter.get(
  "/profile/following",
  requireAuth,
  profileController.getFollowing,
);
profileRouter.get(
  "/profile/followers",
  requireAuth,
  profileController.getFollowers,
);
profileRouter.get(
  "/profile/activities",
  requireAuth,
  profileController.getActivities,
);
profileRouter.get("/users/search", requireAuth, profileController.searchUsers);
profileRouter.get(
  "/users/:userId/profile",
  requireAuth,
  profileController.getUserProfile,
);
