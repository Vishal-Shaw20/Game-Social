import express from "express";
import passport from "passport";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import { sendOtpEmail } from "../config/emailService.js";
import { setOtp, getOtp, deleteOtp } from "../config/otpStore.js";
import { generateUniqueUsername } from "../utils/generateUsername.js";
import { USERNAME_REGEX } from "../utils/validation.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { strictAuthLimiter, emailLimiter, publicLimiter } from "../middleware/rateLimiter.js";
import logger from "../config/logger.js";

const router = express.Router();

/* ── shared by the flows below ──
   Emails are trimmed and lowercased on the way in; lookups match any case,
   so accounts made before this (with capitals) still sign in. Sign-up and
   password-reset codes are kept apart ("signup:" / "reset:"), so one never
   overwrites or stands in for the other. */
const MIN_PASSWORD = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normEmail = (e) => String(e ?? "").trim().toLowerCase();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const byEmail = (email) => ({ email: new RegExp(`^${escapeRe(email)}$`, "i") });
const signupKey = (email) => `signup:${email}`;
const resetKey = (email) => `reset:${email}`;
const hasPassword = (user) => user.linkedAccounts.some((a) => a.provider === "native");

const EMAIL_EXISTS = {
  code: "EMAIL_EXISTS",
  message: "An account with this email already exists. Sign in instead.",
};
const USERNAME_TAKEN = { code: "USERNAME_TAKEN", message: "That username is taken. Try another." };
const NO_PASSWORD = {
  code: "NO_PASSWORD",
  message: "This account signs in with Google or Steam, so it has no password to reset. Use the Google or Steam button to sign in.",
};
const CODE_EXPIRED = { code: "CODE_EXPIRED", message: "That code has expired. Send a new one." };
const CODE_WRONG = { code: "CODE_WRONG", message: "That code isn't right. Check the email and try again." };
const CODE_LOCKED = { code: "CODE_LOCKED", message: "Too many wrong tries, so that code no longer works. Send a new one." };
const MAX_CODE_TRIES = 5;

// A wrong code counts against it; after MAX_CODE_TRIES it's thrown away, so
// it can't be guessed. Returns the answer to send.
async function wrongCode(key, record) {
  const tries = (record.tries ?? 0) + 1;
  if (tries >= MAX_CODE_TRIES) {
    await deleteOtp(key);
    return CODE_LOCKED;
  }
  await setOtp(key, { ...record, tries });
  return { ...CODE_WRONG, triesLeft: MAX_CODE_TRIES - tries };
}
const WEAK_PASSWORD = { code: "WEAK_PASSWORD", message: `Use at least ${MIN_PASSWORD} characters for your password.` };
const EMAIL_FAILED = { code: "EMAIL_FAILED", message: "We couldn't send the email just now. Check the address and try again in a moment." };

/* =====================================================
   🔹 USERNAME AVAILABILITY CHECK
===================================================== */
router.get("/check-username/:username", publicLimiter, async (req, res) => {
  try {
    // Case-insensitive, so two accounts can't differ only by capitals.
    const exists = await User.exists({ usernameLower: req.params.username.toLowerCase() });
    res.json({ available: !exists });
  } catch {
    res.status(500).json({ available: false });
  }
});

/* =====================================================
   🔹 GOOGLE AUTH
===================================================== */
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

router.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: `${process.env.FRONTEND_URL}/login?error=google` }),
  async (req, res) => {
    if (!req.user.username) {
      req.user.username = await generateUniqueUsername(
        req.user.displayName?.toLowerCase().replace(/\s+/g, "") || "player"
      );
      req.user.usernameAssigned = true;
      await req.user.save();
    }

    res.redirect(
      `${process.env.FRONTEND_URL}/dashboard?usernameAssigned=${!!req.user.usernameAssigned}`
    );
  }
);

/* =====================================================
   🔹 STEAM AUTH
===================================================== */
router.get("/steam", passport.authenticate("steam"));

router.get(
  "/steam/return",
  passport.authenticate("steam", { failureRedirect: `${process.env.FRONTEND_URL}/login?error=steam` }),
  async (req, res) => {
    if (!req.user.username) {
      req.user.username = await generateUniqueUsername("player");
      req.user.usernameAssigned = true;
      await req.user.save();
    }

    res.redirect(
      `${process.env.FRONTEND_URL}/dashboard?usernameAssigned=${!!req.user.usernameAssigned}`
    );
  }
);

/* =====================================================
   🔹 SIGN-UP, STEP 1: CHECK THE DETAILS, EMAIL A CODE
===================================================== */
router.post("/send-otp", emailLimiter, async (req, res) => {
  const name = String(req.body.name ?? "").trim();
  const username = String(req.body.username ?? "").trim();
  const email = normEmail(req.body.email);
  const password = String(req.body.password ?? "");
  try {
    if (!name || !email || !password || !username)
      return res.status(400).json({ message: "Fill in every field." });
    if (!EMAIL_RE.test(email))
      return res.status(400).json({ message: "That doesn't look like an email address." });
    if (!USERNAME_REGEX.test(username))
      return res.status(400).json({ message: "Usernames are 3–20 characters: letters, numbers, _ and - only." });
    if (password.length < MIN_PASSWORD) return res.status(400).json(WEAK_PASSWORD);

    // An existing account is never signed up over (or signed into) from here.
    if (await User.exists(byEmail(email))) return res.status(409).json(EMAIL_EXISTS);
    if (await User.exists({ usernameLower: username.toLowerCase() })) return res.status(409).json(USERNAME_TAKEN);

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    await setOtp(signupKey(email), {
      otp,
      expiresAt: Date.now() + 5 * 60 * 1000,
      userData: { name, email, password, username },
    });
    try {
      await sendOtpEmail(email, otp);
    } catch {
      await deleteOtp(signupKey(email)).catch(() => {});
      return res.status(502).json(EMAIL_FAILED);
    }
    res.json({ message: `We sent a code to ${email}.` });
  } catch (err) {
    logger.error({ err }, "send-otp failed");
    res.status(500).json({ message: "Something went wrong on our side. Try again in a moment." });
  }
});

/* =====================================================
   🔹 SIGN-UP, STEP 2: CHECK THE CODE, CREATE THE ACCOUNT
===================================================== */
router.post("/verify-otp", strictAuthLimiter, async (req, res) => {
  const email = normEmail(req.body.email);
  try {
    const record = await getOtp(signupKey(email));
    if (!record || Date.now() > record.expiresAt) return res.status(400).json(CODE_EXPIRED);
    if (record.otp !== String(req.body.otp ?? "").trim()) return res.status(400).json(await wrongCode(signupKey(email), record));

    const { name, password, username } = record.userData;
    // Checked again: either could have been taken in the minutes since.
    if (await User.exists(byEmail(email))) {
      await deleteOtp(signupKey(email));
      return res.status(409).json(EMAIL_EXISTS);
    }
    if (await User.exists({ usernameLower: username.toLowerCase() })) {
      return res.status(409).json({ ...USERNAME_TAKEN, message: "Someone just took that username. Go back and pick another." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    let user;
    try {
      user = await User.create({
        username,
        displayName: name,
        email,
        emailVerifiedAt: new Date(),
        linkedAccounts: [{
          provider: "native",
          providerId: hashedPassword,
          displayName: name,
          email,
          avatar: "",
        }],
      });
    } catch (err) {
      // (the unique indexes, if two sign-ups race)
      if (err?.code === 11000) {
        return res.status(409).json(err.keyPattern?.email ? EMAIL_EXISTS : USERNAME_TAKEN);
      }
      throw err;
    }
    await deleteOtp(signupKey(email));

    req.login(user, (err) => {
      if (err) return res.status(500).json({ message: "Your account is ready, but we couldn't sign you in. Sign in below." });
      res.json({ message: "Account created", user });
    });
  } catch (err) {
    logger.error({ err }, "verify-otp failed");
    res.status(500).json({ message: "Something went wrong on our side. Try again in a moment." });
  }
});

/* =====================================================
   🔹 SIGN IN (EMAIL OR USERNAME)
   One answer for every failure, so it doesn't tell anyone which accounts
   exist. Emails and usernames match any case.
===================================================== */
router.post("/login", strictAuthLimiter, async (req, res) => {
  const identifier = String(req.body.identifier ?? "").trim();
  const password = String(req.body.password ?? "");
  const WRONG = { code: "WRONG_LOGIN", message: "Wrong email/username or password." };
  try {
    if (!identifier || !password) return res.status(400).json(WRONG);
    const user = await User.findOne(
      identifier.includes("@") ? byEmail(normEmail(identifier)) : { usernameLower: identifier.toLowerCase() }
    );
    const native = user?.linkedAccounts.find((a) => a.provider === "native");
    const ok = native ? await bcrypt.compare(password, native.providerId) : false;
    if (!ok) return res.status(400).json(WRONG);

    req.login(user, (err) => {
      if (err) return res.status(500).json({ message: "We couldn't sign you in just now. Try again." });
      res.json({ message: "Signed in", user });
    });
  } catch (err) {
    logger.error({ err }, "login failed");
    res.status(500).json({ message: "Something went wrong on our side. Try again in a moment." });
  }
});

/* =====================================================
   🔹 CURRENT USER
===================================================== */
router.get("/user", requireAuth, (req, res) => {
  res.json(req.user);
});

/* =====================================================
   🔹 LOGOUT
===================================================== */
router.post("/logout", (req, res) => {
  req.logout(() => {
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.json({ message: "Logged out" });
    });
  });
});

/* =====================================================
   🔹 FORGOT PASSWORD: EMAIL A CODE
   An address with no account gets the same answer as one with (so this
   doesn't reveal who's signed up); an account that only signs in with
   Google or Steam is told so before any code is made.
===================================================== */
router.post("/forgot-password", emailLimiter, async (req, res) => {
  const email = normEmail(req.body.email);
  const SENT = { message: `If an account uses ${email}, we've sent it a code.` };
  try {
    if (!EMAIL_RE.test(email)) return res.status(400).json({ message: "That doesn't look like an email address." });
    const user = await User.findOne(byEmail(email));
    if (!user) return res.json(SENT);
    if (!hasPassword(user)) return res.status(400).json(NO_PASSWORD);

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    await setOtp(resetKey(email), { otp, expiresAt: Date.now() + 5 * 60 * 1000 });
    try {
      await sendOtpEmail(email, otp);
    } catch {
      await deleteOtp(resetKey(email)).catch(() => {});
      return res.status(502).json(EMAIL_FAILED);
    }
    res.json(SENT);
  } catch (err) {
    logger.error({ err }, "forgot-password failed");
    res.status(500).json({ message: "Something went wrong on our side. Try again in a moment." });
  }
});

/* =====================================================
   🔹 RESET PASSWORD: CHECK THE CODE, SET THE NEW ONE
===================================================== */
router.post("/reset-password", strictAuthLimiter, async (req, res) => {
  const email = normEmail(req.body.email);
  const newPassword = String(req.body.newPassword ?? "");
  try {
    if (newPassword.length < MIN_PASSWORD) return res.status(400).json(WEAK_PASSWORD);
    const entry = await getOtp(resetKey(email));
    if (!entry || Date.now() > entry.expiresAt) return res.status(400).json(CODE_EXPIRED);
    if (entry.otp !== String(req.body.otp ?? "").trim()) return res.status(400).json(await wrongCode(resetKey(email), entry));

    const user = await User.findOne(byEmail(email));
    if (!user) return res.status(400).json(CODE_EXPIRED);
    const native = user.linkedAccounts.find((a) => a.provider === "native");
    if (!native) return res.status(400).json(NO_PASSWORD);

    native.providerId = await bcrypt.hash(newPassword, 10);
    await user.save();
    await deleteOtp(resetKey(email));
    res.json({ message: "Password updated. Sign in with your new one." });
  } catch (err) {
    logger.error({ err }, "reset-password failed");
    res.status(500).json({ message: "Something went wrong on our side. Try again in a moment." });
  }
});

export default router;
