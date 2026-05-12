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
  if (!s) {
    console.log("[textchat] socket not ready, skipping listener attach");
    return;
  }

  console.log("[textchat] attaching socket listeners");

  const onHistory = (list) => {
    console.log("[textchat] ✅ chat-history received:", list);
    setMessages(list.map(normalizeMessage));
  };

  const onMessage = (msg) => {
    console.log("[textchat] ✅ message event received:", msg);
    setMessages((prev) => [...prev, normalizeMessage(msg)]);
  };

  s.on("chat-history", onHistory);
  s.on("message", onMessage);

  return () => {
    console.log("[textchat] detaching socket listeners");
    s.off("chat-history", onHistory);
    s.off("message", onMessage);
  };
}, [socket]); // 🔑 THIS IS THE KEY

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
  console.log("[textchat] send() called");

  if (e?.preventDefault) {
    e.preventDefault();
    console.log("[textchat] event.preventDefault()");
  }

  const text = input.trim();
  console.log("[textchat] input value:", input);

  if (!text) {
    console.log("[textchat] ❌ empty message, aborting");
    return;
  }

  if (!socketRef.current) {
    console.log("[textchat] ❌ no socket");
    return;
  }

  if (!connected) {
    console.log("[textchat] ❌ socket not connected");
    return;
  }

  if (triggerLoginIfNeeded()) {
    console.log("[textchat] ❌ blocked by login check");
    return;
  }

  const payload = {
    roomId: roomRef.current,
    text,
    clientId: crypto.randomUUID(),
  };

  console.log("[textchat] emitting send-msg with payload:", payload);

  socketRef.current.emit("send-msg", payload, (ack) => {
    console.log("[textchat] send-msg ACK:", ack);
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
