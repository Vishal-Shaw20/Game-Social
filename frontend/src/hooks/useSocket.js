// src/hooks/useSocket.js
import { useEffect, useState } from "react";
import { getSocket, ensureConnected } from "../realtime/socket";

/**
 * The shared socket (realtime/socket.js) for signed-in users, plus whether
 * it's connected. Never disconnects on unmount: other parts of the app
 * (notifications, Social) use the same connection.
 */
export function useSocket(authChecked, isAuthenticated) {
  const socket = getSocket();
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    if (!authChecked || !isAuthenticated) return;
    const s = ensureConnected();
    const on = () => setConnected(true);
    const off = () => setConnected(false);
    s.on("connect", on);
    s.on("disconnect", off);
    return () => {
      s.off("connect", on);
      s.off("disconnect", off);
    };
  }, [authChecked, isAuthenticated]);

  return {
    socket: authChecked && isAuthenticated ? socket : null,
    connected: authChecked && isAuthenticated && connected
  };
}
