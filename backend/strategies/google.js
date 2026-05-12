import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import dotenv from "dotenv";
import User from "../models/User.js";
import logger from "../config/logger.js";

dotenv.config();

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${process.env.API_BASE_URL}/auth/google/callback`,
      passReqToCallback: true,
    },
    async (req, accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value || null;

        const providerData = {
          provider: "google",
          providerId: profile.id,
          displayName: profile.displayName,
          email,
          avatar: profile.photos?.[0]?.value || "",
        };

        /* =====================================================
           1️⃣ USER ALREADY LOGGED IN → LINK GOOGLE
        ===================================================== */
        if (req.user) {
          const alreadyLinked = req.user.linkedAccounts.some(
            acc => acc.provider === "google"
          );

          if (!alreadyLinked) {
            req.user.linkedAccounts.push(providerData);
            await req.user.save();
          }

          return done(null, req.user);
        }

        /* =====================================================
           2️⃣ GOOGLE ACCOUNT ALREADY EXISTS
        ===================================================== */
        let user = await User.findOne({
          "linkedAccounts.provider": "google",
          "linkedAccounts.providerId": profile.id,
        });

        if (user) {
          return done(null, user);
        }

        /* =====================================================
           3️⃣ EMAIL EXISTS → LINK GOOGLE TO THAT USER
        ===================================================== */
        if (email) {
          user = await User.findOne({ email });

          if (user) {
            user.linkedAccounts.push(providerData);
            await user.save();
            return done(null, user);
          }
        }

        /* =====================================================
           4️⃣ BRAND NEW USER
        ===================================================== */
        user = await User.create({
          displayName: profile.displayName,
          email,
          avatar: providerData.avatar,
          linkedAccounts: [providerData],
        });

        return done(null, user);
      } catch (err) {
        logger.error({ err }, "Google strategy error");
        return done(err, null);
      }
    }
  )
);
