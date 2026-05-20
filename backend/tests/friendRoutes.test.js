import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import mongoose from "mongoose";

vi.mock("../models/User.js", () => ({
  default: {
    find: vi.fn(),
    findById: vi.fn(),
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
import friendRoutes from "../routes/friendRoutes.js";

const userId = new mongoose.Types.ObjectId();
const otherId = new mongoose.Types.ObjectId();

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

describe("GET /api/friends", () => {
  it("returns empty array when user has no friends", async () => {
    const app = createApp({ _id: userId, friends: [] });
    const res = await request(app).get("/api/friends");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns friends list", async () => {
    const app = createApp({ _id: userId, friends: [otherId] });
    User.find.mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        { _id: otherId, username: "friend1", displayName: "Friend One" },
      ]),
    });
    const res = await request(app).get("/api/friends");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].username).toBe("friend1");
  });
});

describe("POST /api/friends/add/:userId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when adding yourself", async () => {
    const app = createApp({ _id: userId });
    const res = await request(app).post(`/api/friends/add/${userId}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Cannot add yourself");
  });

  it("returns 404 when target user not found", async () => {
    const app = createApp({ _id: userId });
    User.findById.mockImplementation((id) => {
      if (String(id) === String(userId)) return { _id: userId, friends: { includes: () => false, push: vi.fn() }, save: vi.fn() };
      return null;
    });
    const res = await request(app).post(`/api/friends/add/${otherId}`);
    expect(res.status).toBe(404);
  });

  it("succeeds when adding a valid friend", async () => {
    const app = createApp({ _id: userId });
    const meFriends = [];
    const otherFriends = [];
    User.findById.mockImplementation((id) => {
      if (String(id) === String(userId)) {
        return { _id: userId, friends: { includes: () => false, push: (id) => meFriends.push(id) }, save: vi.fn() };
      }
      return { _id: otherId, friends: { push: (id) => otherFriends.push(id) }, save: vi.fn() };
    });
    const res = await request(app).post(`/api/friends/add/${otherId}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe("DELETE /api/friends/remove/:userId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when removing yourself", async () => {
    const app = createApp({ _id: userId });
    const res = await request(app).delete(`/api/friends/remove/${userId}`);
    expect(res.status).toBe(400);
  });

  it("returns 404 when target user not found", async () => {
    const app = createApp({ _id: userId });
    User.findById.mockImplementation((id) => {
      if (String(id) === String(userId)) return { _id: userId, friends: { pull: vi.fn() }, save: vi.fn() };
      return null;
    });
    const res = await request(app).delete(`/api/friends/remove/${otherId}`);
    expect(res.status).toBe(404);
  });

  it("removes friend successfully", async () => {
    const app = createApp({ _id: userId });
    const pullMe = vi.fn();
    const pullOther = vi.fn();
    User.findById.mockImplementation((id) => {
      if (String(id) === String(userId)) return { _id: userId, friends: { pull: pullMe }, save: vi.fn() };
      return { _id: otherId, friends: { pull: pullOther }, save: vi.fn() };
    });
    const res = await request(app).delete(`/api/friends/remove/${otherId}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(pullMe).toHaveBeenCalledWith(String(otherId));
    expect(pullOther).toHaveBeenCalled();
  });
});
