// src/realtime/useVoiceRoom.js
import { useEffect, useState } from "react";
import { ensureConnected } from "./socket";
import { useVoice } from "./voiceContext";

/**
 * A voice room seen from a page, without joining it: how many are in it and
 * who ({ userId, name, avatar, muted, speaking, self }), kept live, and when
 * the call began. selfUserId marks you in the list. Joining and leaving go through
 * the app's one voice session (useVoice), whose controls live in the right
 * sidebar.
 *
 * Nothing is watched while voice is switched off in the backend.
 */
export function useVoiceRoom(roomId, selfUserId = null) {
  const voice = useVoice();
  const [state, setState] = useState({ count: 0, people: [] });

  useEffect(() => {
    if (!voice.enabled || !roomId) return;
    const socket = ensureConnected();
    const apply = (p) => setState({ count: p.count ?? 0, people: p.people ?? [] });
    const watch = () =>
      socket.emit("voice-watch", { roomId, watch: true }, (ack) => ack?.ok && apply(ack));
    watch();
    const onCount = (p) => p.roomId === roomId && apply(p);
    socket.on("voice-count", onCount);
    socket.on("connect", watch); // watching is per socket; redo after a reconnect
    return () => {
      socket.off("voice-count", onCount);
      socket.off("connect", watch);
      socket.emit("voice-watch", { roomId, watch: false });
    };
  }, [voice.enabled, roomId]);

  const here = voice.isIn(roomId);
  const me = selfUserId;

  // Everyone in the call. Mute state comes from the server for all of them;
  // who is speaking is only known once you're in the call yourself (it's
  // measured from the audio you receive).
  const people = state.people.map((p) => {
    const peer = here ? voice.peers.find((x) => String(x.userId) === String(p.userId)) : null;
    const self = here && me && String(p.userId) === String(me);
    return {
      ...p,
      self: Boolean(self),
      muted: self ? voice.muted || voice.deafened : Boolean(peer ? peer.muted : p.muted),
      speaking: self ? voice.speaking && !voice.muted && !voice.deafened : Boolean(peer?.speaking),
    };
  });
  // The call has been going since its earliest member joined.
  const starts = state.people.map((p) => p.since).filter(Boolean);

  return {
    enabled: voice.enabled,
    count: state.count,
    people,
    /** When the room's call began (ms), or null when nobody's in it. */
    startedAt: starts.length ? Math.min(...starts) : null,
    /** When you joined it, while you're in it. */
    joinedAt: here ? voice.joinedAt : null,
    /** In this room's call. */
    here,
    /** In a call somewhere else; joining moves you here. */
    elsewhere: voice.joined && !here,
    elsewhereLabel: voice.label,
    connecting: voice.connecting,
    error: voice.roomId === roomId ? voice.error : null,
    speaking: voice.speaking,
    peers: voice.peers,
    muted: voice.muted || voice.deafened,
    // your own controls (the same call the right sidebar controls)
    selfMuted: voice.muted,
    deafened: voice.deafened,
    pushToTalk: voice.pushToTalk,
    pttKey: voice.pttKey,
    pttDelay: voice.pttDelay,
    pttSounds: voice.pttSounds,
    setMuted: voice.setMuted,
    setDeafened: voice.setDeafened,
    setPushToTalk: voice.setPushToTalk,
    setPtt: voice.setPtt,
  };
}
