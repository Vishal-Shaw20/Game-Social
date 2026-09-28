import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../models/User.js", () => ({
  default: {
    findOne: vi.fn(),
    exists: vi.fn(),
    create: vi.fn(),
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
  // req.login, as passport would add it
  app.use((req, _res, next) => {
    req.login = (_user, done) => done();
    next();
  });
  app.use("/auth", authRoutes);
  return app;
}

const WRONG_LOGIN = "Wrong email/username or password.";
const VALID_SIGNUP = { name: "Test", email: "t@t.com", password: "longenough1", username: "valid_user" };

describe("GET /auth/check-username/:username", () => {
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

describe("POST /auth/send-otp (sign-up, step 1)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when fields are missing", async () => {
    const res = await request(createApp()).post("/auth/send-otp").send({ email: "test@test.com" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Fill in every field.");
  });

  it("returns 400 for an invalid email", async () => {
    const res = await request(createApp()).post("/auth/send-otp").send({ ...VALID_SIGNUP, email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/doesn't look like an email/);
  });

  it("returns 400 for an invalid username", async () => {
    const res = await request(createApp()).post("/auth/send-otp").send({ ...VALID_SIGNUP, username: "a" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Usernames are 3–20 characters/);
  });

  it("returns 400 for a password under 8 characters", async () => {
    const res = await request(createApp()).post("/auth/send-otp").send({ ...VALID_SIGNUP, password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("WEAK_PASSWORD");
  });

  it("returns 409 EMAIL_EXISTS for an email that already has an account, in any case", async () => {
    User.exists.mockResolvedValueOnce({ _id: "123" }); // the email check
    const res = await request(createApp()).post("/auth/send-otp").send({ ...VALID_SIGNUP, email: "  T@T.COM " });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EMAIL_EXISTS");
    // looked up lowercased and trimmed, matching any case
    const query = User.exists.mock.calls[0][0];
    expect(query.email).toBeInstanceOf(RegExp);
    expect(query.email.test("t@t.com")).toBe(true);
    expect(query.email.test("T@T.Com")).toBe(true);
    expect(sendOtpEmail).not.toHaveBeenCalled();
  });

  it("returns 409 USERNAME_TAKEN when the username is taken (case-insensitive)", async () => {
    User.exists.mockResolvedValueOnce(null).mockResolvedValueOnce({ _id: "123" });
    const res = await request(createApp()).post("/auth/send-otp").send({ ...VALID_SIGNUP, username: "Taken_User" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("USERNAME_TAKEN");
    expect(User.exists.mock.calls[1][0]).toEqual({ usernameLower: "taken_user" });
  });

  it("stores a sign-up code (under its own key) and emails it when input is valid", async () => {
    User.exists.mockResolvedValue(null);
    sendOtpEmail.mockResolvedValue();
    const res = await request(createApp()).post("/auth/send-otp").send(VALID_SIGNUP);
    expect(res.status).toBe(200);
    expect(setOtp).toHaveBeenCalledWith("signup:t@t.com", expect.objectContaining({ otp: expect.any(String) }));
    expect(sendOtpEmail).toHaveBeenCalledWith("t@t.com", expect.any(String));
  });

  it("discards the code and says so when the email can't be sent", async () => {
    User.exists.mockResolvedValue(null);
    sendOtpEmail.mockRejectedValue(new Error("smtp down"));
    const res = await request(createApp()).post("/auth/send-otp").send(VALID_SIGNUP);
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("EMAIL_FAILED");
    expect(deleteOtp).toHaveBeenCalledWith("signup:t@t.com");
  });
});

describe("POST /auth/verify-otp (sign-up, step 2)", () => {
  beforeEach(() => vi.clearAllMocks());
  const record = () => ({
    otp: "123456",
    expiresAt: Date.now() + 60000,
    userData: { name: "Test", email: "t@t.com", password: "longenough1", username: "valid_user" },
  });

  it("returns CODE_EXPIRED when there's no sign-up code (a reset code doesn't count)", async () => {
    getOtp.mockResolvedValue(null);
    const res = await request(createApp()).post("/auth/verify-otp").send({ email: "t@t.com", otp: "123456" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("CODE_EXPIRED");
    expect(getOtp).toHaveBeenCalledWith("signup:t@t.com");
  });

  it("counts a wrong code, and throws the code away after 5 wrong tries", async () => {
    getOtp.mockResolvedValue({ ...record(), tries: 3 });
    let res = await request(createApp()).post("/auth/verify-otp").send({ email: "t@t.com", otp: "000000" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("CODE_WRONG");
    expect(res.body.triesLeft).toBe(1);
    expect(setOtp).toHaveBeenCalledWith("signup:t@t.com", expect.objectContaining({ tries: 4 }));

    getOtp.mockResolvedValue({ ...record(), tries: 4 });
    res = await request(createApp()).post("/auth/verify-otp").send({ email: "t@t.com", otp: "000000" });
    expect(res.body.code).toBe("CODE_LOCKED");
    expect(deleteOtp).toHaveBeenCalledWith("signup:t@t.com");
  });

  it("never signs into an existing account: EMAIL_EXISTS if the email was taken meanwhile", async () => {
    getOtp.mockResolvedValue(record());
    User.exists.mockResolvedValueOnce({ _id: "someone" });
    const res = await request(createApp()).post("/auth/verify-otp").send({ email: "t@t.com", otp: "123456" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EMAIL_EXISTS");
    expect(User.create).not.toHaveBeenCalled();
  });

  it("creates the account (email marked verified) and signs in with the right code", async () => {
    getOtp.mockResolvedValue(record());
    User.exists.mockResolvedValue(null);
    User.create.mockResolvedValue({ _id: "new" });
    const res = await request(createApp()).post("/auth/verify-otp").send({ email: "t@t.com", otp: "123456" });
    expect(res.status).toBe(200);
    expect(User.create).toHaveBeenCalledWith(expect.objectContaining({ email: "t@t.com", username: "valid_user", emailVerifiedAt: expect.any(Date) }));
    expect(deleteOtp).toHaveBeenCalledWith("signup:t@t.com");
  });
});

describe("POST /auth/login", () => {
  beforeEach(() => vi.clearAllMocks());

  it("gives the same answer when the user doesn't exist", async () => {
    User.findOne.mockResolvedValue(null);
    const res = await request(createApp()).post("/auth/login").send({ identifier: "nobody@test.com", password: "pass" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(WRONG_LOGIN);
  });

  it("gives the same answer when the account has no password", async () => {
    User.findOne.mockResolvedValue({ linkedAccounts: [{ provider: "google", providerId: "g123" }] });
    const res = await request(createApp()).post("/auth/login").send({ identifier: "google@test.com", password: "pass" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(WRONG_LOGIN);
  });

  it("gives the same answer when the password is wrong", async () => {
    User.findOne.mockResolvedValue({ linkedAccounts: [{ provider: "native", providerId: "hashed" }] });
    bcrypt.compare.mockResolvedValue(false);
    const res = await request(createApp()).post("/auth/login").send({ identifier: "user@test.com", password: "wrong" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(WRONG_LOGIN);
  });

  it("looks a username up case-insensitively", async () => {
    User.findOne.mockResolvedValue(null);
    await request(createApp()).post("/auth/login").send({ identifier: "SomeUser", password: "pass" });
    expect(User.findOne).toHaveBeenCalledWith({ usernameLower: "someuser" });
  });

  it("signs in with the right password", async () => {
    User.findOne.mockResolvedValue({ linkedAccounts: [{ provider: "native", providerId: "hashed" }] });
    bcrypt.compare.mockResolvedValue(true);
    const res = await request(createApp()).post("/auth/login").send({ identifier: "user@test.com", password: "right" });
    expect(res.status).toBe(200);
  });
});

describe("POST /auth/forgot-password", () => {
  beforeEach(() => vi.clearAllMocks());

  it("gives the same answer (and sends nothing) when no account uses the email", async () => {
    User.findOne.mockResolvedValue(null);
    const res = await request(createApp()).post("/auth/forgot-password").send({ email: "nobody@test.com" });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/If an account uses nobody@test.com/);
    expect(sendOtpEmail).not.toHaveBeenCalled();
  });

  it("says up front when the account only signs in with Google or Steam (no code made)", async () => {
    User.findOne.mockResolvedValue({ _id: "123", email: "g@test.com", linkedAccounts: [{ provider: "google", providerId: "g1" }] });
    const res = await request(createApp()).post("/auth/forgot-password").send({ email: "g@test.com" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("NO_PASSWORD");
    expect(setOtp).not.toHaveBeenCalled();
    expect(sendOtpEmail).not.toHaveBeenCalled();
  });

  it("stores a reset code (under its own key) and emails it when the account has a password", async () => {
    User.findOne.mockResolvedValue({ _id: "123", email: "user@test.com", linkedAccounts: [{ provider: "native", providerId: "h" }] });
    sendOtpEmail.mockResolvedValue();
    const res = await request(createApp()).post("/auth/forgot-password").send({ email: "User@Test.com" });
    expect(res.status).toBe(200);
    expect(setOtp).toHaveBeenCalledWith("reset:user@test.com", expect.objectContaining({ otp: expect.any(String) }));
    expect(sendOtpEmail).toHaveBeenCalled();
  });

  it("copes with an account record that has no linked accounts at all", async () => {
    User.findOne.mockResolvedValue({ _id: "123", email: "user@test.com" });
    const res = await request(createApp()).post("/auth/forgot-password").send({ email: "user@test.com" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("NO_PASSWORD");
  });
});

describe("POST /auth/reset-password", () => {
  beforeEach(() => vi.clearAllMocks());
  const body = { email: "u@t.com", otp: "123456", newPassword: "longenough1" };

  it("returns 400 for a new password under 8 characters", async () => {
    const res = await request(createApp()).post("/auth/reset-password").send({ ...body, newPassword: "short" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("WEAK_PASSWORD");
  });

  it("returns CODE_EXPIRED when the code has expired", async () => {
    getOtp.mockResolvedValue({ otp: "123456", expiresAt: Date.now() - 1000 });
    const res = await request(createApp()).post("/auth/reset-password").send(body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("CODE_EXPIRED");
  });

  it("returns CODE_EXPIRED when there's no reset code (a sign-up code doesn't count)", async () => {
    getOtp.mockResolvedValue(null);
    const res = await request(createApp()).post("/auth/reset-password").send(body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("CODE_EXPIRED");
    expect(getOtp).toHaveBeenCalledWith("reset:u@t.com");
  });

  it("returns CODE_WRONG for a wrong code", async () => {
    getOtp.mockResolvedValue({ otp: "123456", expiresAt: Date.now() + 60000 });
    const res = await request(createApp()).post("/auth/reset-password").send({ ...body, otp: "000000" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("CODE_WRONG");
  });

  it("returns 400 when the account is gone", async () => {
    getOtp.mockResolvedValue({ otp: "123456", expiresAt: Date.now() + 60000 });
    User.findOne.mockResolvedValue(null);
    const res = await request(createApp()).post("/auth/reset-password").send(body);
    expect(res.status).toBe(400);
  });

  it("returns NO_PASSWORD for an OAuth-only user", async () => {
    getOtp.mockResolvedValue({ otp: "123456", expiresAt: Date.now() + 60000 });
    User.findOne.mockResolvedValue({ linkedAccounts: [{ provider: "google", providerId: "g123" }], save: vi.fn() });
    const res = await request(createApp()).post("/auth/reset-password").send(body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("NO_PASSWORD");
  });

  it("resets the password for a native user", async () => {
    const saveFn = vi.fn();
    const native = { provider: "native", providerId: "old_hash" };
    getOtp.mockResolvedValue({ otp: "123456", expiresAt: Date.now() + 60000 });
    User.findOne.mockResolvedValue({ linkedAccounts: [native], save: saveFn });
    bcrypt.hash.mockResolvedValue("new_hash");

    const res = await request(createApp()).post("/auth/reset-password").send(body);

    expect(res.status).toBe(200);
    expect(native.providerId).toBe("new_hash");
    expect(saveFn).toHaveBeenCalled();
    expect(deleteOtp).toHaveBeenCalledWith("reset:u@t.com");
  });
});
