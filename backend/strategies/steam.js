import passport from "passport";
import { Strategy as SteamStrategy } from "passport-steam";
import dotenv from "dotenv";
import User from "../models/User.js";
import { createSteamLibraryIfMissing } from "../services/steamLibrary.js";
import logger from "../config/logger.js";

dotenv.config();

passport.use(
  new SteamStrategy(
    {
      returnURL: `${process.env.API_BASE_URL}/auth/steam/return`,
      realm: `${process.env.API_BASE_URL}`,
      apiKey: process.env.STEAM_API_KEY,
      passReqToCallback: true
    },
    async (req, identifier, profile, done) => {
      try {
        const providerData = {
          provider: "steam",
          providerId: profile.id,
          displayName: profile.displayName,
          avatar: profile.photos?.[2]?.value || ""
        };

        // 🔗 Linking Steam to existing user
        if (req.user) {
          const linked = req.user.linkedAccounts.some(
            acc => acc.provider === "steam"
          );

          if (!linked) {
            req.user.linkedAccounts.push(providerData);
            await req.user.save();

            createSteamLibraryIfMissing(req.user._id, profile.id)
              .catch(err => logger.error({ err }, "Steam library init failed"));
          }

          return done(null, req.user);
        }

        // 🔐 Login with Steam
        let user = await User.findOne({
          "linkedAccounts.provider": "steam",
          "linkedAccounts.providerId": profile.id
        });

        if (!user) {
          user = await User.create({
            displayName: profile.displayName,
            avatar: providerData.avatar,
            linkedAccounts: [providerData]
          });

          createSteamLibraryIfMissing(user._id, profile.id)
            .catch(err => logger.error({ err }, "Steam library init failed"));
        }

        return done(null, user);
      } catch (err) {
        logger.error({ err }, "Steam strategy error");
        return done(err, null);
      }
    }
  )
);
