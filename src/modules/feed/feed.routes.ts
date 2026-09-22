import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { commentLimiter, kudosLimiter } from "../../middleware/rate-limit.js";
import { validateRequest } from "../../middleware/validation.js";
import { feedController } from "./feed.controller.js";
import {
  commentParamsSchema,
  commentsQuerySchema,
  createCommentBodySchema,
  feedQuerySchema,
  kudosListQuerySchema,
  postParamsSchema,
  suggestedUsersQuerySchema,
  userPostsParamsSchema,
  userPostsQuerySchema,
} from "./feed.schemas.js";

export const feedRouter = Router();

feedRouter.get(
  "/feed",
  requireAuth,
  validateRequest({ query: feedQuerySchema }),
  feedController.getFeed,
);

// Two segments, so it never collides with /users/:userId/<action> routes.
feedRouter.get(
  "/users/suggested",
  requireAuth,
  validateRequest({ query: suggestedUsersQuerySchema }),
  feedController.getSuggestedUsers,
);

feedRouter.get(
  "/users/:userId/posts",
  requireAuth,
  validateRequest({ params: userPostsParamsSchema, query: userPostsQuerySchema }),
  feedController.getUserPosts,
);

feedRouter.get(
  "/posts/:sessionId",
  requireAuth,
  validateRequest({ params: postParamsSchema }),
  feedController.getPost,
);

feedRouter.get(
  "/posts/:sessionId/kudos",
  requireAuth,
  validateRequest({ params: postParamsSchema, query: kudosListQuerySchema }),
  feedController.listKudos,
);

feedRouter.post(
  "/posts/:sessionId/kudos",
  requireAuth,
  kudosLimiter,
  validateRequest({ params: postParamsSchema }),
  feedController.giveKudo,
);

feedRouter.delete(
  "/posts/:sessionId/kudos",
  requireAuth,
  kudosLimiter,
  validateRequest({ params: postParamsSchema }),
  feedController.removeKudo,
);

feedRouter.get(
  "/posts/:sessionId/comments",
  requireAuth,
  validateRequest({ params: postParamsSchema, query: commentsQuerySchema }),
  feedController.listComments,
);

feedRouter.post(
  "/posts/:sessionId/comments",
  requireAuth,
  commentLimiter,
  validateRequest({ params: postParamsSchema, body: createCommentBodySchema }),
  feedController.addComment,
);

feedRouter.delete(
  "/posts/:sessionId/comments/:commentId",
  requireAuth,
  validateRequest({ params: commentParamsSchema }),
  feedController.deleteComment,
);
