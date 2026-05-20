import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../models/User.js", () => ({
  default: {
    findOne: vi.fn(),
    exists: vi.fn(),
  },
}));

vi.mock("../config/otpStore.js", () => ({
  setOtp: vi.fn(),
  getOtp: vi.fn(),
  deleteOtp: vi.fn(),
}));

vi.mock("../config/emailService.js", () => ({
  sendOtpEmail: vi.fn(),
}));

vi.mock("../utils/generateUsername.js", () => ({
  generateUniqueUsername: vi.fn(() => "player_123"),
}));

vi.mock("../utils/validation.js", () => ({
  USERNAME_REGEX: /^[a-zA-Z0-9_-]{3,20}$/,
}));

vi.mock("../middleware/requireAuth.js", () => ({
  requireAuth: (req, res, next) => next(),
}));

vi.mock("../middleware/rateLimiter.js", () => ({
  strictAuthLimiter: (req, res, next) => next(),
  emailLimiter: (req, res, next) => next(),
  publicLimiter: (req, res, next) => next(),
}));

vi.mock("passport", () => {
  const passthrough = (req, res, next) => next();
  return {
    default: {
      authenticate: () => passthrough,
    },
  };
});

vi.mock("bcryptjs", async () => {
  return {
    default: {
      hash: vi.fn(() => "hashed_password"),
      compare: vi.fn(),
    },
  };
});

import User from "../models/User.js";
import { setOtp, getOtp, deleteOtp } from "../config/otpStore.js";
import { sendOtpEmail } from "../config/emailService.js";
import bcrypt from "bcryptjs";
import authRoutes from "../routes/authRoutes.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/auth", authRoutes);
  return app;
}

describe("POST /auth/check-username/:username", () => {
  it("returns available: true when username is free", async () => {
    User.exists.mockResolvedValue(null);
    const res = await request(createApp()).get("/auth/check-username/newuser");
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
  });

  it("returns available: false when username is taken", async () => {
    User.exists.mockResolvedValue({ _id: "123" });
    const res = await request(createApp()).get("/auth/check-username/taken");
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
  });
});

describe("POST /auth/send-otp", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when fields are missing", async () => {
    const res = await request(createApp())
      .post("/auth/send-otp")
      .send({ email: "test@test.com" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("All fields required");
  });

  it("returns 400 for invalid username", async () => {
    const res = await request(createApp())
      .post("/auth/send-otp")
      .send({ name: "Test", email: "t@t.com", password: "pass", username: "a" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Username must be/);
  });

  it("returns 400 when username is taken", async () => {
    User.exists.mockResolvedValue({ _id: "123" });
    const res = await request(createApp())
      .post("/auth/send-otp")
      .send({ name: "Test", email: "t@t.com", password: "pass", username: "taken_user" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Username already taken");
  });

  it("sends OTP and stores it when input is valid", async () => {
    User.exists.mockResolvedValue(null);
    sendOtpEmail.mockResolvedValue();
    const res = await request(createApp())
      .post("/auth/send-otp")
      .send({ name: "Test", email: "t@t.com", password: "pass", username: "valid_user" });
    expect(res.status).toBe(200);
    expect(setOtp).toHaveBeenCalled();
    expect(sendOtpEmail).toHaveBeenCalled();
  });
});

describe("POST /auth/login", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when user is not found", async () => {
    User.findOne.mockResolvedValue(null);
    const res = await request(createApp())
      .post("/auth/login")
      .send({ identifier: "nobody@test.com", password: "pass" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("User not found");
  });

  it("returns 400 when user has no native account", async () => {
    User.findOne.mockResolvedValue({
      linkedAccounts: [{ provider: "google", providerId: "g123" }],
    });
    const res = await request(createApp())
      .post("/auth/login")
      .send({ identifier: "google@test.com", password: "pass" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("No native account");
  });

  it("returns 400 when password is wrong", async () => {
    User.findOne.mockResolvedValue({
      linkedAccounts: [{ provider: "native", providerId: "hashed" }],
    });
    bcrypt.compare.mockResolvedValue(false);
    const res = await request(createApp())
      .post("/auth/login")
      .send({ identifier: "user@test.com", password: "wrong" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Invalid password");
  });
});

describe("POST /auth/forgot-password", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns generic message when user doesn't exist (no email sent)", async () => {
    User.findOne.mockResolvedValue(null);
    const res = await request(createApp())
      .post("/auth/forgot-password")
      .send({ email: "nobody@test.com" });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/If that email exists/);
    expect(sendOtpEmail).not.toHaveBeenCalled();
  });

  it("sends OTP when user exists", async () => {
    User.findOne.mockResolvedValue({ _id: "123", email: "user@test.com" });
    sendOtpEmail.mockResolvedValue();
    const res = await request(createApp())
      .post("/auth/forgot-password")
      .send({ email: "user@test.com" });
    expect(res.status).toBe(200);
    expect(setOtp).toHaveBeenCalled();
    expect(sendOtpEmail).toHaveBeenCalled();
  });
});

describe("POST /auth/reset-password", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when OTP is expired", async () => {
    getOtp.mockResolvedValue({ otp: "123456", expiresAt: Date.now() - 1000 });
    const res = await request(createApp())
      .post("/auth/reset-password")
      .send({ email: "u@t.com", otp: "123456", newPassword: "newpass" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("OTP expired");
  });

  it("returns 400 when OTP is wrong", async () => {
    getOtp.mockResolvedValue({ otp: "123456", expiresAt: Date.now() + 60000 });
    const res = await request(createApp())
      .post("/auth/reset-password")
      .send({ email: "u@t.com", otp: "000000", newPassword: "newpass" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Invalid OTP");
  });

  it("returns 400 when no entry exists", async () => {
    getOtp.mockResolvedValue(null);
    const res = await request(createApp())
      .post("/auth/reset-password")
      .send({ email: "u@t.com", otp: "123456", newPassword: "newpass" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("OTP expired");
  });

  it("returns 400 when user not found", async () => {
    getOtp.mockResolvedValue({ otp: "123456", expiresAt: Date.now() + 60000 });
    User.findOne.mockResolvedValue(null);
    const res = await request(createApp())
      .post("/auth/reset-password")
      .send({ email: "u@t.com", otp: "123456", newPassword: "newpass" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("User not found");
  });

  it("returns 400 for OAuth-only user (no native account)", async () => {
    getOtp.mockResolvedValue({ otp: "123456", expiresAt: Date.now() + 60000 });
    User.findOne.mockResolvedValue({
      linkedAccounts: [{ provider: "google", providerId: "g123" }],
      save: vi.fn(),
    });
    const res = await request(createApp())
      .post("/auth/reset-password")
      .send({ email: "u@t.com", otp: "123456", newPassword: "newpass" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Google\/Steam/);
  });

  it("resets password for valid native user", async () => {
    const saveFn = vi.fn();
    const native = { provider: "native", providerId: "old_hash" };
    getOtp.mockResolvedValue({ otp: "123456", expiresAt: Date.now() + 60000 });
    User.findOne.mockResolvedValue({
      linkedAccounts: [native],
      save: saveFn,
    });
    bcrypt.hash.mockResolvedValue("new_hash");

    const res = await request(createApp())
      .post("/auth/reset-password")
      .send({ email: "u@t.com", otp: "123456", newPassword: "newpass" });

    expect(res.status).toBe(200);
    expect(native.providerId).toBe("new_hash");
    expect(saveFn).toHaveBeenCalled();
    expect(deleteOtp).toHaveBeenCalledWith("u@t.com");
  });
});
