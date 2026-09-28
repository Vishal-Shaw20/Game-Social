// src/realtime/socket.js
//
// The app's one Socket.IO connection, shared by everything that needs it:
// game chat, the notification bar and the Social page. (Each used to open
// its own, so a game page with the sidebar open held two connections.)
//
// The server only accepts signed-in users. For a signed-out visitor the
// handshake fails with "Authentication required"; the socket then stays
// disconnected until ensureConnected() is called again (after sign-in, or
// the next time a component mounts that needs it).

import { useEffect } from "react";
import { io } from "socket.io-client";

let socket = null;
let authFailed = false;

export function getSocket() {
  if (!socket) {
    const url = import.meta.env.VITE_SOCKET_URL?.trim() || window.location.origin;
    socket = io(url, {
      transports: ["websocket"],
      withCredentials: true,
      autoConnect: false
    });
    socket.on("connect", () => {
      authFailed = false;
    });
    socket.on("connect_error", (err) => {
      if (err.message === "Authentication required" || err.message === "User not found") {
        authFailed = true;
        socket.disconnect();
      }
    });
  }
  return socket;
}

/** Connect if not already connected (retries after an auth failure too). */
export function ensureConnected() {
  const s = getSocket();
  if (!s.connected && (!s.active || authFailed)) {
    authFailed = false;
    s.connect();
  }
  return s;
}

/**
 * Subscribe to a server push for the lifetime of a component.
 * handler(payload) runs for every event; it may change between renders.
 */
export function useSocketEvent(event, handler) {
  useEffect(() => {
    const s = ensureConnected();
    s.on(event, handler);
    return () => {
      s.off(event, handler);
    };
  }, [event, handler]);
}
