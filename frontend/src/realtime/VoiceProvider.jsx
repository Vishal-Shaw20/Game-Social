// src/realtime/VoiceProvider.jsx
//
// The app's single voice session, as a mesh: your browser connects straight
// to each other participant, and the server only passes the connection
// details along (backend/social/voiceHandlers.js). Audio never touches the
// server.
//
// One session at a time, app-wide (as in Discord): joining a second room
// leaves the first, even from another tab or device, and the call
// survives moving between pages because the
// provider sits above the router's pages. Every control — the Squad
// sidebar's mic and headphone buttons, a chat header's call button, the
// panel on a game page — reads and writes this one state.
//
// Nothing happens until join() is called: no microphone, no peer
// connections. leave() (or closing the tab) tears everything down, and the
// room disappears once the last person leaves.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VoiceContext } from "./voiceContext";
import { ensureConnected } from "./socket";
import { useAppConfig } from "../hooks/useAppConfig";

const MIC_CONSTRAINTS = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1
  }
};

const HEARTBEAT_MS = 30_000;

/* Push-to-talk settings live on the account (User.settings.voice, via
   /api/me/settings). Before that they were kept in the browser under
   PTT_STORE; those move to the account once, the first time. */
const API = import.meta.env.VITE_API_URL;
const PTT_STORE = "gs.pttSettings";
const PTT_DEFAULTS = { key: "KeyV", delay: 0, sounds: false };
const PTT_SAVE_MS = 400;
const fromServer = (v) => ({ key: v.pttKey, delay: v.pttDelay, sounds: v.pttSounds });
const toServer = (p) => ({ pttKey: p.key, pttDelay: p.delay, pttSounds: p.sounds });
function readOldPtt() {
  try {
    const raw = localStorage.getItem(PTT_STORE);
    return raw ? { ...PTT_DEFAULTS, ...JSON.parse(raw) } : null;
  } catch {
    return null;
  }
}
function saveSettings(voice) {
  return fetch(`${API}/api/me/settings`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ voice }),
  }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
}
const SPEAKING_THRESHOLD = 0.02;

/** Rough loudness (0..1) of a stream, for the speaking ring. */
function meter(stream, onLevel) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return () => {};
  const ctx = new Ctx();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  src.connect(analyser);

  const data = new Uint8Array(analyser.frequencyBinCount);
  let raf = 0;
  const tick = () => {
    analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
    onLevel(peak);
    raf = requestAnimationFrame(tick);
  };
  tick();

  return () => {
    cancelAnimationFrame(raf);
    src.disconnect();
    ctx.close().catch(() => {});
  };
}

export function VoiceProvider({ children }) {
  const { voice } = useAppConfig();
  const enabled = voice.enabled;

  // The room we're in, and a label for it ("Portal 2", "Ayushi") so any
  // control can say what the call is.
  const [roomId, setRoomId] = useState(null);
  const [label, setLabel] = useState("");
  const [joined, setJoined] = useState(false);
  const [connecting, setConnecting] = useState(false);
  // When the current call was joined (ms), for "Connected · 12:34".
  const [joinedAt, setJoinedAt] = useState(null);
  const [error, setError] = useState(null);
  const [peers, setPeers] = useState([]); // { socketId, userId, name, avatar, muted, speaking }
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [pushToTalk, setPushToTalk] = useState(false);
  const [talking, setTalking] = useState(false); // PTT key held
  const [ptt, setPttState] = useState(PTT_DEFAULTS); // { key, delay (ms), sounds }
  const signedIn = useRef(false); // settings changes are saved to the account
  const saveTimer = useRef(null);
  const [speaking, setSpeaking] = useState(false); // my own voice

  const localStream = useRef(null);
  const connections = useRef(new Map()); // socketId -> RTCPeerConnection
  const audioEls = useRef(new Map()); // socketId -> HTMLAudioElement
  const stopMeter = useRef(null);
  const joinedRef = useRef(false);
  // The live room, readable from callbacks without re-creating them.
  const roomIdRef = useRef(null);

  /* ── Mic on/off, covering mute and push-to-talk ── */
  const applyMicState = useCallback(() => {
    const track = localStream.current?.getAudioTracks?.()[0];
    if (!track) return;
    const open = !muted && !deafened && (!pushToTalk || talking);
    track.enabled = open;
  }, [muted, deafened, pushToTalk, talking]);

  useEffect(() => {
    applyMicState();
    if (joinedRef.current && roomIdRef.current) {
      const off = muted || deafened || (pushToTalk && !talking);
      ensureConnected().emit("voice-state", { roomId: roomIdRef.current, muted: off });
    }
  }, [applyMicState, muted, deafened, pushToTalk, talking]);

  // Load them when signed in (again after signing in or out elsewhere).
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch(`${API}/api/me/settings`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then(async (s) => {
          if (cancelled) return;
          signedIn.current = Boolean(s);
          if (!s) return setPttState(PTT_DEFAULTS);
          const old = readOldPtt();
          if (!s.saved && old) {
            // the browser's old settings, moved to the account once
            const saved = await saveSettings(toServer(old));
            if (cancelled) return;
            if (saved) {
              try { localStorage.removeItem(PTT_STORE); } catch { /* stays; harmless */ }
            }
            setPttState(old);
          } else {
            setPttState(fromServer(s.voice));
          }
        })
        .catch(() => {});
    load();
    const onStorage = (e) => e.key === "auth:changed" && load();
    window.addEventListener("storage", onStorage);
    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // A change applies at once and is saved a moment later (a burst of
  // clicks is one save).
  const pending = useRef({});
  const setPtt = useCallback((patch) => {
    setPttState((cur) => ({ ...cur, ...patch }));
    if (!signedIn.current) return;
    pending.current = { ...pending.current, ...toServer({ ...patch }) };
    for (const k of Object.keys(pending.current)) if (pending.current[k] === undefined) delete pending.current[k];
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const voice = pending.current;
      pending.current = {};
      saveSettings(voice);
    }, PTT_SAVE_MS);
  }, []);

  /* A soft click as the mic opens (higher) and closes (lower). */
  const cueCtx = useRef(null);
  const playCue = useCallback((open) => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = (cueCtx.current ??= new Ctx());
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const t = ctx.currentTime;
      o.frequency.value = open ? 880 : 620;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.06, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.1);
    } catch {
      /* no audio: no cue */
    }
  }, []);

  /* Talking on / off for push-to-talk (the key, or a hold button). Letting
     go waits out the release delay, so a last word isn't cut off. */
  const talkingRef = useRef(false);
  const releaseTimer = useRef(null);
  const setTalkingPtt = useCallback((on) => {
    clearTimeout(releaseTimer.current);
    const apply = (v) => {
      if (talkingRef.current === v) return;
      talkingRef.current = v;
      setTalking(v);
      if (ptt.sounds) playCue(v);
    };
    if (on || !ptt.delay) apply(on);
    else releaseTimer.current = setTimeout(() => apply(false), ptt.delay);
  }, [ptt.delay, ptt.sounds, playCue]);

  /* Hold the push-to-talk key (V unless changed) to talk; the hold buttons
     work too. Not while typing in a text box. */
  useEffect(() => {
    if (!joined || !pushToTalk) return;
    const isTyping = (el) =>
      el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    const down = (e) => {
      if (e.code === ptt.key && !e.repeat && !isTyping(document.activeElement)) setTalkingPtt(true);
    };
    const up = (e) => e.code === ptt.key && setTalkingPtt(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [joined, pushToTalk, ptt.key, setTalkingPtt]);

  /* Remote audio follows deafen. */
  useEffect(() => {
    for (const el of audioEls.current.values()) el.muted = deafened;
  }, [deafened]);

  const closePeer = useCallback((socketId) => {
    connections.current.get(socketId)?.close();
    connections.current.delete(socketId);
    const el = audioEls.current.get(socketId);
    if (el) {
      el.srcObject = null;
      el.remove();
      audioEls.current.delete(socketId);
    }
    setPeers((prev) => prev.filter((p) => p.socketId !== socketId));
  }, []);

  const teardown = useCallback(() => {
    joinedRef.current = false;
    for (const id of [...connections.current.keys()]) closePeer(id);
    stopMeter.current?.();
    stopMeter.current = null;
    localStream.current?.getTracks().forEach((t) => t.stop());
    localStream.current = null;
    setPeers([]);
    setJoined(false);
    setJoinedAt(null);
    setSpeaking(false);
    setTalking(false);
  }, [closePeer]);

  /** One peer connection, with my microphone attached. */
  const createPeer = useCallback(
    (socketId, peerInfo) => {
      const socket = ensureConnected();
      const pc = new RTCPeerConnection({ iceServers: voice.iceServers });
      connections.current.set(socketId, pc);

      localStream.current?.getTracks().forEach((t) => pc.addTrack(t, localStream.current));

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          socket.emit("voice-signal", {
            to: socketId,
            roomId: roomIdRef.current,
            data: { candidate: e.candidate }
          });
        }
      };

      pc.ontrack = (e) => {
        let el = audioEls.current.get(socketId);
        if (!el) {
          el = document.createElement("audio");
          el.autoplay = true;
          el.muted = deafened;
          audioEls.current.set(socketId, el);
          document.body.appendChild(el);
        }
        el.srcObject = e.streams[0];
        el.play?.().catch(() => {});
        // Show them as speaking from their own audio level.
        meter(e.streams[0], (level) => {
          setPeers((prev) =>
            prev.map((p) =>
              p.socketId === socketId ? { ...p, speaking: level > SPEAKING_THRESHOLD } : p
            )
          );
        });
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") {
          setError("Couldn't connect to someone on this network.");
          closePeer(socketId);
        }
      };

      if (peerInfo) {
        setPeers((prev) =>
          prev.some((p) => p.socketId === socketId) ? prev : [...prev, { ...peerInfo, socketId }]
        );
      }
      return pc;
    },
    [voice.iceServers, deafened, closePeer]
  );

  /* ── Signalling ── */
  useEffect(() => {
    if (!enabled) return;
    const socket = ensureConnected();
    const inRoom = (r) => joinedRef.current && r === roomIdRef.current;

    const onPeerJoined = async ({ roomId: r, peer }) => {
      if (!inRoom(r)) return;
      // They offer to us; just show them for now.
      createPeer(peer.socketId, peer);
    };

    const onPeerLeft = ({ roomId: r, socketId }) => {
      if (r !== roomIdRef.current) return;
      closePeer(socketId);
    };

    const onSignal = async ({ from, roomId: r, data }) => {
      if (!inRoom(r)) return;
      let pc = connections.current.get(from);
      if (!pc) pc = createPeer(from, null);

      try {
        if (data.sdp) {
          await pc.setRemoteDescription(data.sdp);
          if (data.sdp.type === "offer") {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit("voice-signal", {
              to: from,
              roomId: roomIdRef.current,
              data: { sdp: pc.localDescription }
            });
          }
        } else if (data.candidate) {
          await pc.addIceCandidate(data.candidate).catch(() => {});
        }
      } catch (err) {
        console.error("voice signal failed", err);
      }
    };

    const onState = ({ roomId: r, socketId, muted: m }) => {
      if (r !== roomIdRef.current) return;
      setPeers((prev) => prev.map((p) => (p.socketId === socketId ? { ...p, muted: m } : p)));
    };

    socket.on("voice-peer-joined", onPeerJoined);
    socket.on("voice-peer-left", onPeerLeft);
    socket.on("voice-signal", onSignal);
    socket.on("voice-state", onState);
    return () => {
      socket.off("voice-peer-joined", onPeerJoined);
      socket.off("voice-peer-left", onPeerLeft);
      socket.off("voice-signal", onSignal);
      socket.off("voice-state", onState);
    };
  }, [enabled, createPeer, closePeer]);

  /* Keep our slot in the room alive. */
  useEffect(() => {
    if (!joined) return;
    const id = setInterval(
      () => ensureConnected().emit("voice-heartbeat", { roomId: roomIdRef.current }),
      HEARTBEAT_MS
    );
    return () => clearInterval(id);
  }, [joined]);

  /**
   * Join a voice room. Joining a different room leaves the current one
   * first, so there is only ever one live call.
   */
  const join = useCallback(async (nextRoomId, nextLabel = "") => {
    if (!enabled || connecting || !nextRoomId) return;
    if (joinedRef.current) {
      if (roomIdRef.current === nextRoomId) return; // already in this room
      ensureConnected().emit("voice-leave", { roomId: roomIdRef.current });
      teardown();
    }

    const roomId = nextRoomId;
    roomIdRef.current = roomId;
    setRoomId(roomId);
    setLabel(nextLabel);
    setConnecting(true);
    setError(null);
    try {
      localStream.current = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      stopMeter.current = meter(localStream.current, (level) =>
        setSpeaking(level > SPEAKING_THRESHOLD)
      );

      const socket = ensureConnected();
      const ack = await new Promise((resolve) =>
        socket.emit("voice-join", { roomId }, resolve)
      );

      if (!ack?.ok) {
        localStream.current?.getTracks().forEach((t) => t.stop());
        localStream.current = null;
        setError(
          ack?.error === "not_allowed"
            ? "You can't join this voice room."
            : ack?.error === "rate_limited"
              ? "Too many attempts, wait a moment."
              : "Couldn't join the voice room."
        );
        return;
      }

      joinedRef.current = true;
      setJoined(true);
      setJoinedAt(Date.now());
      applyMicState();

      // We're the newcomer: we offer to everyone already here, so each
      // connection has exactly one initiator.
      for (const peer of ack.peers ?? []) {
        const pc = createPeer(peer.socketId, peer);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit("voice-signal", {
          to: peer.socketId,
          roomId,
          data: { sdp: pc.localDescription }
        });
      }
    } catch (err) {
      const name = err?.name;
      setError(
        name === "NotAllowedError"
          ? "Microphone permission was denied."
          : name === "NotFoundError"
            ? "No microphone found."
            : "Couldn't start your microphone."
      );
      teardown();
    } finally {
      setConnecting(false);
    }
  }, [enabled, connecting, createPeer, applyMicState, teardown]);

  const leave = useCallback(() => {
    if (!joinedRef.current) return;
    ensureConnected().emit("voice-leave", { roomId: roomIdRef.current });
    teardown();
    roomIdRef.current = null;
    setRoomId(null);
    setLabel("");
  }, [teardown]);

  // Joining a call in another tab or window moves you there: this tab hangs
  // up (the server tells every other socket of yours, voiceHandlers.js).
  useEffect(() => {
    if (!enabled) return;
    const socket = ensureConnected();
    const onMoved = () => leave();
    socket.on("voice-moved", onMoved);
    return () => socket.off("voice-moved", onMoved);
  }, [enabled, leave]);

  // Closing the tab hangs up; navigating between pages does not, since the
  // provider lives above them.
  useEffect(() => {
    const hangUp = () => {
      if (joinedRef.current) ensureConnected().emit("voice-leave", { roomId: roomIdRef.current });
    };
    window.addEventListener("pagehide", hangUp);
    return () => window.removeEventListener("pagehide", hangUp);
  }, []);

  const value = useMemo(
    () => ({
      enabled,
      roomId,
      label,
      joined,
      joinedAt,
      connecting,
      error,
      peers,
      muted,
      deafened,
      pushToTalk,
      pttKey: ptt.key,
      pttDelay: ptt.delay,
      pttSounds: ptt.sounds,
      talking,
      speaking,
      join,
      leave,
      setMuted,
      setDeafened,
      setPushToTalk,
      setPtt,
      setTalking: setTalkingPtt,
      /** Is this the room we're currently in? */
      isIn: (id) => joined && roomId === id
    }),
    [
      enabled, roomId, label, joined, joinedAt, connecting, error, peers, muted, deafened,
      pushToTalk, ptt, talking, speaking, join, leave, setPtt, setTalkingPtt
    ]
  );

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}
