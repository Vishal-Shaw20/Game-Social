// src/realtime/voiceContext.js
import { createContext, useContext } from "react";

/* Kept apart from VoiceProvider.jsx so that file only exports a component
   (which is what React Fast Refresh needs). */

/* Used when no provider is mounted, so callers never need a null check. */
const EMPTY_VOICE = {
  enabled: false,
  roomId: null,
  label: "",
  joined: false,
  joinedAt: null,
  connecting: false,
  error: null,
  peers: [],
  muted: false,
  deafened: false,
  pushToTalk: false,
  pttKey: "KeyV",
  pttDelay: 0,
  pttSounds: false,
  talking: false,
  speaking: false,
  join: () => {},
  leave: () => {},
  setMuted: () => {},
  setDeafened: () => {},
  setPushToTalk: () => {},
  setPtt: () => {},
  setTalking: () => {},
  isIn: () => false
};

export const VoiceContext = createContext(null);

/** A push-to-talk key (a KeyboardEvent.code) as shown: "KeyV" -> "V". */
export function pttKeyLabel(code = "KeyV") {
  const named = {
    Space: "Space", Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]",
    Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/",
    ShiftLeft: "Left Shift", ShiftRight: "Right Shift", ControlLeft: "Left Ctrl", ControlRight: "Right Ctrl",
    AltLeft: "Left Alt", AltRight: "Right Alt", CapsLock: "Caps Lock",
  };
  if (named[code]) return named[code];
  return code.replace(/^(Key|Digit)/, "").replace(/^Numpad/, "Num ");
}

/** The app's single voice session (VoiceProvider). */
export function useVoice() {
  return useContext(VoiceContext) ?? EMPTY_VOICE;
}
