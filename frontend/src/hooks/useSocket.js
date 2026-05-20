// src/hooks/useSocket.js
import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

export function useSocket(authChecked, isAuthenticated, currentUser) {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!authChecked || !isAuthenticated) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setConnected(false);
      }
      return;
    }

    if (socketRef.current) {
      return;
    }

    const url =
      import.meta.env.VITE_SOCKET_URL?.trim() || window.location.origin;

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
      setConnected(true);
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    socket.on("connect_error", (err) => {
      if (err.message === "Authentication required") {
        socket.disconnect();
        socketRef.current = null;
        setConnected(false);
      }
    });

    return () => {};
  }, [authChecked, isAuthenticated]);

  return {
    socket: socketRef.current,
    connected
  };
}
