// src/hooks/useSocket.js
import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

export function useSocket(authChecked, isAuthenticated, currentUser) {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // ❌ Never disconnect on re-render
    if (!authChecked || !isAuthenticated) {
      if (socketRef.current) {
        console.log("[useSocket] auth lost → disconnect");
        socketRef.current.disconnect();
        socketRef.current = null;
        setConnected(false);
      }
      return;
    }

    // ✅ Already connected → do nothing
    if (socketRef.current) {
      return;
    }

    const url =
      import.meta.env.VITE_SOCKET_URL?.trim() || window.location.origin;

    console.log("[useSocket] creating socket");

    const socket = io(url, {
      transports: ["websocket"],
      withCredentials: true,
      auth: {
        user: {
          id: currentUser?.id || currentUser?._id || null,
          name:
            currentUser?.name ||
            currentUser?.displayName ||
            currentUser?.username ||
            null
        }
      }
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("[useSocket] ✅ socket connected:", socket.id);
      setConnected(true);
    });

    socket.on("disconnect", (reason) => {
      console.log("[useSocket] ❌ socket disconnected:", reason);
      setConnected(false);
    });

    socket.on("connect_error", (err) => {
      console.error("[useSocket] connect_error:", err.message);
      if (err.message === "Authentication required") {
        socket.disconnect();
        socketRef.current = null;
        setConnected(false);
      }
    });

    // ❌ IMPORTANT: NO cleanup disconnect here
    return () => {
      console.log("[useSocket] component unmount (no disconnect)");
    };
  }, [authChecked, isAuthenticated]); // 🔑 ONLY THESE

  return {
    socket: socketRef.current,
    connected
  };
}
