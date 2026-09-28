import express from "express";
import { VOICE_ENABLED } from "../config/env.js";

/*
 * Settings the client needs to know at runtime, not at build time: flipping
 * VOICE_ENABLED in the backend's env and restarting is enough to turn voice
 * chat on or off everywhere, with no frontend rebuild or redeploy.
 *
 * Public (no sign-in) and cheap: the frontend asks once on load.
 */
const router = express.Router();

router.get("/", (req, res) => {
  res.json({
    voice: {
      enabled: VOICE_ENABLED,
      // Public STUN only: peers connect directly, so no media server and no
      // per-minute cost. Some strict networks will fail to connect; that
      // needs a TURN relay, which can be added here later.
      iceServers: VOICE_ENABLED
        ? [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }]
        : []
    }
  });
});

export default router;
