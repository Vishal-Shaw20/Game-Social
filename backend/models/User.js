import mongoose from "mongoose";

const linkedAccountSchema = new mongoose.Schema({
  provider: { type: String, required: true },
  providerId: { type: String, required: true },
  displayName: String,
  email: String,
  avatar: String,
  accessToken: String,
  refreshToken: String,
});

const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, sparse: true, index: true },
  // Lowercased copy of username, kept in step by the hook below. Username
  // lookups (the Social search, profile URLs) ignore case, and MongoDB can't
  // use an index for a case-insensitive regex or apply a collation to one,
  // so searching this field is what keeps those lookups on an index.
  usernameLower: { type: String, index: true, sparse: true },
  displayName: String,
  email: { type: String, unique: true, sparse: true },
  profilePicture: String,
  // The profile page (routes/accountRoutes.js): a short bio, a favourite
  // game, and which picture to show (google | steam | upload | none; unset
  // = whatever there was). An upload is a small data URL served from
  // /api/avatar/:id; it's never sent with the user (select: false), and
  // avatarVersion changes its URL so a new one isn't cached as the old.
  bio: String,
  favoriteGame: { rawgId: String, name: String, cover: String },
  avatarSource: String,
  avatarUpload: { type: String, select: false },
  avatarVersion: Number,
  // A short line friends see by your name ("LFG for Elden Ring, 9pm"),
  // until expiresAt if set.
  customStatus: { text: String, expiresAt: Date },
  // A game whose art is your profile's banner (else your most played games).
  banner: { rawgId: String, name: String, cover: String },
  // When the email was confirmed with a code (sign-up, or a change).
  emailVerifiedAt: Date,
  // A deleted account: kept as "Deleted user" so its posts stay up, with
  // every personal field removed.
  deleted: Boolean,
  deletedAt: Date,
  createdAt: { type: Date, default: Date.now },
  linkedAccounts: [linkedAccountSchema],
  friends: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  ],
  // The user's settings (what the profile's settings section will edit),
  // read and written through /api/me/settings. Unset until first saved.
  settings: {
    // push-to-talk: the key (a KeyboardEvent.code), how long the mic stays
    // open after letting go (ms), and click sounds as it opens and closes
    voice: {
      pttKey: String,
      pttDelay: Number,
      pttSounds: Boolean,
    },
    // which notifications you get (unset = on): utils/profileExtras.js
    notifications: {
      friends: Boolean,
      mentions: Boolean,
      likes: Boolean,
      messages: Boolean,
    },
  },
});

/* Whatever sets username — signup, an edit, an OAuth link — usernameLower
   follows automatically. */
userSchema.pre("save", function setUsernameLower(next) {
  if (this.isModified("username")) {
    this.usernameLower = this.username ? this.username.toLowerCase() : undefined;
  }
  next();
});

userSchema.pre(["updateOne", "findOneAndUpdate", "updateMany"], function syncUsernameLower(next) {
  const update = this.getUpdate() || {};
  const username = update.username ?? update.$set?.username;
  if (username !== undefined) {
    this.setUpdate({
      ...update,
      $set: { ...(update.$set || {}), usernameLower: username ? String(username).toLowerCase() : undefined }
    });
  }
  next();
});

/* Never sent to the browser: a password login's hash (its providerId) and
   any provider tokens. Applies wherever a user document becomes JSON (API
   responses, socket payloads); the server itself still reads them. */
userSchema.set("toJSON", {
  transform(_doc, ret) {
    if (Array.isArray(ret.linkedAccounts)) {
      ret.linkedAccounts = ret.linkedAccounts.map(({ accessToken, refreshToken, ...account }) => {
        if (account.provider !== "native") return account;
        const { providerId, ...safe } = account;
        return safe;
      });
    }
    return ret;
  },
});

export default mongoose.model("User", userSchema);
