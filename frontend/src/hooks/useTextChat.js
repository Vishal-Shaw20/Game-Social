// src/hooks/useTextChat.js
import { useState, useEffect, useRef, useCallback } from "react";

export function useTextChat(socket, connected, roomId, currentUser, requireLogin) {
  const [joined, setJoined] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sendError, setSendError] = useState(null);

  const socketRef = useRef(socket);
  const roomRef = useRef(roomId);

  useEffect(() => { socketRef.current = socket; }, [socket]);
  useEffect(() => { roomRef.current = roomId; }, [roomId]);

  const triggerLoginIfNeeded = useCallback(() => {
    if (!currentUser) {
      if (typeof requireLogin === "function") requireLogin();
      return true;
    }
    return false;
  }, [currentUser, requireLogin]);

  const normalizeMessage = (msg) => ({
    id: msg.id,
    from: msg.from?.name || msg.username || "Anon",
    text: msg.text,
    ts: msg.ts || msg.created_at || Date.now()
  });

  useEffect(() => {
    const s = socket;
    if (!s) return;

    const onHistory = (list) => {
      setMessages(list.map(normalizeMessage));
    };

    const onMessage = (msg) => {
      setMessages((prev) => [...prev, normalizeMessage(msg)]);
    };

    s.on("chat-history", onHistory);
    s.on("message", onMessage);

    return () => {
      s.off("chat-history", onHistory);
      s.off("message", onMessage);
    };
  }, [socket]);

  const join = useCallback(() => {
    if (!socketRef.current || !connected) return;
    if (triggerLoginIfNeeded()) return;

    socketRef.current.emit(
      "join-room",
      { roomId: roomRef.current },
      (ack) => {
        if (ack?.ok) setJoined(true);
      }
    );
  }, [connected, triggerLoginIfNeeded]);

  const leave = useCallback(() => {
    if (!socketRef.current) return;

    socketRef.current.emit(
      "leave-room",
      { roomId: roomRef.current },
      () => setJoined(false)
    );
  }, []);

  const send = useCallback((e) => {
    if (e?.preventDefault) e.preventDefault();

    const text = input.trim();
    if (!text) return;
    if (!socketRef.current) return;
    if (!connected) return;
    if (triggerLoginIfNeeded()) return;

    const payload = {
      roomId: roomRef.current,
      text,
      clientId: crypto.randomUUID(),
    };

    socketRef.current.emit("send-msg", payload, (ack) => {
      if (ack?.error === "rate_limited") {
        setSendError("You're sending messages too fast. Please wait a moment.");
        setTimeout(() => setSendError(null), ack.retryMs || 5000);
      }
    });

    setInput("");
  }, [input, connected, triggerLoginIfNeeded]);

  return {
    joined,
    messages,
    input,
    setInput,
    join,
    leave,
    send,
    sendError
  };
}
