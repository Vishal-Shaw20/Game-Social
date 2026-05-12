import express from "express";
import passport from "passport";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import { sendOtpEmail } from "../config/emailService.js";
import otpStore from "../config/otpStore.js";
import { generateUniqueUsername } from "../utils/generateUsername.js";
import { USERNAME_REGEX } from "../utils/validation.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { strictAuthLimiter, emailLimiter, publicLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();

/* =====================================================
   🔹 USERNAME AVAILABILITY CHECK
===================================================== */
router.get("/check-username/:username", publicLimiter, async (req, res) => {
  try {
    const exists = await User.exists({ username: req.params.username });
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
  passport.authenticate("google", { failureRedirect: "/" }),
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
  passport.authenticate("steam", { failureRedirect: "/" }),
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
   🔹 SEND OTP (SIGNUP)
===================================================== */
router.post("/send-otp", emailLimiter, async (req, res) => {
  try {
    const { name, email, password, username } = req.body;

    if (!name || !email || !password || !username)
      return res.status(400).json({ message: "All fields required" });

    if (!USERNAME_REGEX.test(username))
      return res.status(400).json({ message: "Username must be 3-20 characters, letters, numbers, underscores, and hyphens only" });

    if (await User.exists({ username }))
      return res.status(400).json({ message: "Username already taken" });

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = Date.now() + 5 * 60 * 1000;

    otpStore.set(email, {
      otp,
      expiresAt,
      userData: { name, email, password, username },
    });

    await sendOtpEmail(email, otp);
    res.json({ message: "OTP sent successfully" });
  } catch (err) {
    res.status(500).json({ message: "Failed to send OTP" });
  }
});

/* =====================================================
   🔹 VERIFY OTP
===================================================== */
router.post("/verify-otp", strictAuthLimiter, async (req, res) => {
  try {
    const { email, otp } = req.body;
    const record = otpStore.get(email);

    if (!record) return res.status(400).json({ message: "OTP expired" });
    if (Date.now() > record.expiresAt) return res.status(400).json({ message: "OTP expired" });
    if (record.otp !== String(otp)) return res.status(400).json({ message: "Invalid OTP" });

    const { name, password, username } = record.userData;
    const hashedPassword = await bcrypt.hash(password, 10);

    let user = await User.findOne({ email });

    if (!user) {
      user = new User({
        username,
        displayName: name,
        email,
        linkedAccounts: [{
          provider: "native",
          providerId: hashedPassword,
          displayName: name,
          email,
          avatar: "",
        }],
      });
      await user.save();
    }

    otpStore.delete(email);

    req.login(user, err => {
      if (err) return res.status(500).json({ message: "Login failed" });
      res.json({ message: "Signup successful", user });
    });
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

/* =====================================================
   🔹 NATIVE LOGIN (EMAIL OR USERNAME)
===================================================== */
router.post("/login", strictAuthLimiter, async (req, res) => {
  try {
    const { identifier, password } = req.body;

    const user = await User.findOne({
      $or: [{ email: identifier }, { username: identifier }],
    });

    if (!user) return res.status(400).json({ message: "User not found" });

    const native = user.linkedAccounts.find(a => a.provider === "native");
    if (!native) return res.status(400).json({ message: "No native account" });

    const ok = await bcrypt.compare(password, native.providerId);
    if (!ok) return res.status(400).json({ message: "Invalid password" });

    req.login(user, err => {
      if (err) return res.status(500).json({ message: "Login failed" });
      res.json({ message: "Login successful", user });
    });
  } catch {
    res.status(500).json({ message: "Server error" });
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
   🔹 FORGOT / RESET PASSWORD
===================================================== */
router.post("/forgot-password", emailLimiter, async (req, res) => {
  const { email } = req.body;
  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  otpStore.set(email, { otp, expiresAt: Date.now() + 5 * 60 * 1000 });
  await sendOtpEmail(email, otp);

  res.json({ message: "OTP sent" });
});

router.post("/reset-password", strictAuthLimiter, async (req, res) => {
  const { email, otp, newPassword } = req.body;
  const entry = otpStore.get(email);

  if (!entry || entry.otp !== String(otp)) return res.status(400).json({ message: "Invalid OTP" });

  const user = await User.findOne({ email });
  const hash = await bcrypt.hash(newPassword, 10);

  const native = user.linkedAccounts.find(a => a.provider === "native");
  native.providerId = hash;

  await user.save();
  otpStore.delete(email);

  res.json({ message: "Password reset successful" });
});

export default router;
