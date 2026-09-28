import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import mongoose from "mongoose";

vi.mock("../models/User.js", () => ({
  default: {
    find: vi.fn(),
    findById: vi.fn(),
    exists: vi.fn(),
    updateOne: vi.fn(),
  },
}));

vi.mock("../models/FriendRequest.js", () => ({
  default: {
    find: vi.fn(),
    create: vi.fn(),
    findOneAndDelete: vi.fn(),
  },
}));

vi.mock("../models/Notification.js", () => ({
  default: {
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
}));

vi.mock("../models/Activity.js", () => ({
  default: {
    find: vi.fn(() => ({
      sort: vi.fn(() => ({
        limit: vi.fn(() => ({
          populate: vi.fn(() => ({
            lean: vi.fn(() => []),
          })),
        })),
      })),
    })),
  },
}));

vi.mock("../utils/createNotification.js", () => ({
  createNotification: vi.fn(),
}));

vi.mock("../utils/createActivity.js", () => ({
  createActivity: vi.fn(),
}));

vi.mock("../social/realtime.js", () => ({
  emitToUsers: vi.fn(),
  emitToUser: vi.fn(),
}));

vi.mock("../config/logger.js", () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("../middleware/rateLimiter.js", () => ({
  writeLimiter: (req, res, next) => next(),
}));

vi.mock("../middleware/requireAuth.js", () => ({
  requireAuth: (req, res, next) => next(),
}));

import User from "../models/User.js";
import FriendRequest from "../models/FriendRequest.js";
import { createNotification } from "../utils/createNotification.js";
import { createActivity } from "../utils/createActivity.js";
import { emitToUsers } from "../social/realtime.js";
import friendRoutes from "../routes/friendRoutes.js";

const userId = new mongoose.Types.ObjectId();
const otherId = new mongoose.Types.ObjectId();

const me = (friends = []) => ({
  _id: userId,
  username: "me",
  displayName: "Me",
  friends,
});

function createApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = user;
    next();
  });
  app.use("/api/friends", friendRoutes);
  return app;
}

// Mongoose query chains used by the routes: find().lean(), findById().lean()
const lean = (value) => ({ lean: vi.fn().mockResolvedValue(value) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/friends", () => {
  it("returns empty array when user has no friends", async () => {
    const res = await request(createApp(me())).get("/api/friends");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns friends list", async () => {
    User.find.mockReturnValue(lean([{ _id: otherId, username: "other" }]));
    const res = await request(createApp(me([otherId]))).get("/api/friends");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].username).toBe("other");
  });
});

describe("POST /api/friends/request/:userId", () => {
  it("rejects sending a request to yourself", async () => {
    const res = await request(createApp(me())).post(`/api/friends/request/${userId}`);
    expect(res.status).toBe(400);
  });

  it("rejects an invalid id", async () => {
    const res = await request(createApp(me())).post("/api/friends/request/not-an-id");
    expect(res.status).toBe(400);
  });

  it("404s for an unknown user", async () => {
    User.findById.mockReturnValue(lean(null));
    const res = await request(createApp(me())).post(`/api/friends/request/${otherId}`);
    expect(res.status).toBe(404);
  });

  it("creates a pending request and notifies the recipient, without befriending", async () => {
    User.findById.mockReturnValue(lean({ _id: otherId, username: "other" }));
    FriendRequest.findOneAndDelete.mockResolvedValue(null);
    FriendRequest.create.mockResolvedValue({ _id: new mongoose.Types.ObjectId() });

    const res = await request(createApp(me())).post(`/api/friends/request/${otherId}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("outgoing");
    expect(FriendRequest.create).toHaveBeenCalledWith({ from: userId, to: String(otherId) });
    expect(User.updateOne).not.toHaveBeenCalled();
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: otherId, type: "friend_request" })
    );
    expect(emitToUsers).toHaveBeenCalled();
  });

  it("accepts instead when the other user already sent me a request", async () => {
    User.findById.mockReturnValue(lean({ _id: otherId, username: "other" }));
    FriendRequest.findOneAndDelete.mockResolvedValue({ from: otherId, to: userId });

    const res = await request(createApp(me())).post(`/api/friends/request/${otherId}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("friends");
    expect(FriendRequest.create).not.toHaveBeenCalled();
    expect(User.updateOne).toHaveBeenCalledTimes(2);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: otherId, type: "friend_accept" })
    );
  });

  it("is a no-op for an existing friend", async () => {
    User.findById.mockReturnValue(lean({ _id: otherId, username: "other" }));
    const res = await request(createApp(me([otherId]))).post(`/api/friends/request/${otherId}`);
    expect(res.body.status).toBe("friends");
    expect(FriendRequest.create).not.toHaveBeenCalled();
  });

  it("the old /add route only sends a request", async () => {
    User.findById.mockReturnValue(lean({ _id: otherId, username: "other" }));
    FriendRequest.findOneAndDelete.mockResolvedValue(null);
    FriendRequest.create.mockResolvedValue({ _id: new mongoose.Types.ObjectId() });

    const res = await request(createApp(me())).post(`/api/friends/add/${otherId}`);
    expect(res.body.status).toBe("outgoing");
    expect(User.updateOne).not.toHaveBeenCalled();
  });
});

describe("POST /api/friends/requests/:id/accept", () => {
  it("befriends both sides, notifies the sender and records activity", async () => {
    FriendRequest.findOneAndDelete.mockResolvedValue({ from: otherId, to: userId });
    User.findById.mockReturnValue(lean({ _id: otherId, username: "other" }));

    const id = new mongoose.Types.ObjectId();
    const res = await request(createApp(me())).post(`/api/friends/requests/${id}/accept`);

    expect(res.status).toBe(200);
    expect(FriendRequest.findOneAndDelete).toHaveBeenCalledWith({ _id: String(id), to: userId });
    expect(User.updateOne).toHaveBeenCalledTimes(2);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: otherId, type: "friend_accept" })
    );
    expect(createActivity).toHaveBeenCalledTimes(2);
  });

  it("404s when the request isn't addressed to me", async () => {
    FriendRequest.findOneAndDelete.mockResolvedValue(null);
    const res = await request(createApp(me())).post(
      `/api/friends/requests/${new mongoose.Types.ObjectId()}/accept`
    );
    expect(res.status).toBe(404);
    expect(User.updateOne).not.toHaveBeenCalled();
  });
});

describe("POST /api/friends/requests/:id/decline", () => {
  it("removes the request without befriending", async () => {
    FriendRequest.findOneAndDelete.mockResolvedValue({ from: otherId, to: userId });
    const res = await request(createApp(me())).post(
      `/api/friends/requests/${new mongoose.Types.ObjectId()}/decline`
    );
    expect(res.status).toBe(200);
    expect(User.updateOne).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/friends/requests/:id (cancel)", () => {
  it("only lets the sender cancel", async () => {
    FriendRequest.findOneAndDelete.mockResolvedValue({ from: userId, to: otherId });
    const id = new mongoose.Types.ObjectId();
    const res = await request(createApp(me())).delete(`/api/friends/requests/${id}`);
    expect(res.status).toBe(200);
    expect(FriendRequest.findOneAndDelete).toHaveBeenCalledWith({ _id: String(id), from: userId });
  });
});

describe("DELETE /api/friends/remove/:userId", () => {
  it("returns 400 when removing yourself", async () => {
    const res = await request(createApp(me())).delete(`/api/friends/remove/${userId}`);
    expect(res.status).toBe(400);
  });

  it("returns 404 when user not found", async () => {
    User.exists.mockResolvedValue(null);
    const res = await request(createApp(me())).delete(`/api/friends/remove/${otherId}`);
    expect(res.status).toBe(404);
  });

  it("removes the friendship on both sides", async () => {
    User.exists.mockResolvedValue({ _id: otherId });
    const res = await request(createApp(me([otherId]))).delete(`/api/friends/remove/${otherId}`);
    expect(res.status).toBe(200);
    expect(User.updateOne).toHaveBeenCalledWith({ _id: userId }, { $pull: { friends: String(otherId) } });
    expect(User.updateOne).toHaveBeenCalledWith({ _id: String(otherId) }, { $pull: { friends: userId } });
  });
});
