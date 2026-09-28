// src/hooks/useTextChat.js
//
// A game's public chat room ("game:<rawgId>") over the shared socket.
//
//   join()       enter the room: the ack brings the newest page of history
//                and who's here. After a reconnect the room is rejoined by
//                itself (the server forgets socket rooms on disconnect).
//   leave()      for leaving the page; there is no "leave room" in the UI.
//   loadOlder()  the page of messages before the oldest one loaded.
//   people       who's in the room right now, kept live ("room-presence").
//   typing       others typing right now: [{ id, name }].
//
//   send({ replyTo, lfg, spoiler })  the input as a message; optionally
//                            quoting a message (its id), as a "looking for
//                            group" card (lfg: { platform, slots }), or
//                            hidden as a spoiler.
//   edit(id, text, { spoiler }) / remove(id) / react(id, emoji) / joinGroup(id)
//   search(q)                messages in the whole room matching q
//   setTyping(bool)          tell the room you're typing (throttled here).
//
// Messages: { id, userId, from, username, avatar, kind, text, ts (ms),
//   editedAt, deleted, replyTo: { id, from, excerpt } | null,
//   reactions: [{ emoji, userIds }], lfg: { platform, slots, joined } | null }
import { useState, useEffect, useRef, useCallback } from "react";

/* A spoiler is a whole message, stored wrapped as ||text||. */
const SPOILER_RE = /^\|\|([\s\S]+)\|\|$/;
export const isSpoiler = (text) => SPOILER_RE.test(text || "");
export const unwrapSpoiler = (text) => (text || "").match(SPOILER_RE)?.[1] ?? text;
export const wrapSpoiler = (text) => `||${text}||`;
/** For one-line previews (reply quotes, search): hides a spoiler. A reply
 *  quote is cut short, so there only the opening || is left to go on; a
 *  quoted group post's comes after the server's "Looking for group: ". */
const LFG_QUOTE = "Looking for group: ";
export const spoilerSafe = (text, { excerpt = false } = {}) => {
  const t = text || "";
  if (isSpoiler(t)) return "▒▒▒▒ spoiler";
  if (!excerpt) return text;
  if (t.startsWith("||")) return "▒▒▒▒ spoiler";
  if (t.startsWith(LFG_QUOTE + "||")) return `${LFG_QUOTE}▒▒▒▒ spoiler`;
  return text;
};

/** "Ana is typing…", for the `typing` list below. */
export function typingText(typing) {
  if (!typing.length) return "";
  if (typing.length === 1) return `${typing[0].name} is typing…`;
  if (typing.length === 2) return `${typing[0].name} and ${typing[1].name} are typing…`;
  return `${typing.length} people are typing…`;
}

const TYPING_EVERY_MS = 3000;  // re-announce while still typing
const TYPING_IDLE_MS = 4000;   // no keystrokes this long: stopped
const TYPING_STALE_MS = 6000;  // drop someone who never said they stopped

const normalizeMessage = (msg) => ({
  id: msg.id,
  userId: msg.from?.id ?? msg.user_id ?? null,
  from: msg.from?.name || msg.username || "Someone",
  username: msg.from?.username ?? null,
  avatar: msg.from?.avatar ?? null,
  kind: msg.kind || "text",
  text: String(msg.text ?? ""),
  ts: new Date(msg.ts || msg.created_at || Date.now()).getTime(),
  editedAt: msg.editedAt ? new Date(msg.editedAt).getTime() : null,
  deleted: Boolean(msg.deleted),
  replyTo: msg.replyTo
    ? {
        id: msg.replyTo.id,
        userId: msg.replyTo.from?.id ?? null,
        from: msg.replyTo.from?.name || "Someone",
        avatar: msg.replyTo.from?.avatar ?? null,
        excerpt: msg.replyTo.excerpt || "",
      }
    : null,
  reactions: msg.reactions ?? [],
  lfg: msg.lfg ?? null,
});

const ERRORS = {
  rate_limited: "You're doing that too fast. Wait a moment.",
  reply_not_found: "That message is gone, so it can't be replied to.",
  full: "That group is full.",
  too_many_reactions: "That message has as many different reactions as it can take.",
};

export function useTextChat(socket, connected, roomId, currentUser, requireLogin) {
  const [joined, setJoined] = useState(false);
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [people, setPeople] = useState([]);
  const [typingMap, setTypingMap] = useState({}); // userId -> { name, at }
  const [input, setInput] = useState("");
  const [sendError, setSendError] = useState(null);

  const socketRef = useRef(socket);
  const roomRef = useRef(roomId);
  // Whether we mean to be in the room: a reconnect rejoins only then.
  const wantRef = useRef(false);
  const joiningRef = useRef(false);
  const errorTimer = useRef(null);
  const typingSent = useRef({ on: false, at: 0 });
  const typingIdle = useRef(null);

  useEffect(() => { socketRef.current = socket; }, [socket]);
  useEffect(() => { roomRef.current = roomId; }, [roomId]);
  useEffect(() => () => {
    clearTimeout(errorTimer.current);
    clearTimeout(typingIdle.current);
  }, []);

  const flashError = useCallback((text, ms = 5000) => {
    setSendError(text);
    clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setSendError(null), ms);
  }, []);

  const triggerLoginIfNeeded = useCallback(() => {
    if (!currentUser) {
      if (typeof requireLogin === "function") requireLogin();
      return true;
    }
    return false;
  }, [currentUser, requireLogin]);

  const doJoin = useCallback(() => {
    const s = socketRef.current;
    if (!s || !s.connected || joiningRef.current) return;
    joiningRef.current = true;
    s.emit("join-room", { roomId: roomRef.current }, (ack) => {
      joiningRef.current = false;
      if (!ack?.ok) return;
      setMessages((ack.messages ?? []).map(normalizeMessage));
      setHasMore(Boolean(ack.hasMore));
      setPeople(ack.users ?? []);
      setJoined(true);
    });
  }, []);

  /* Live events, and rejoining after a reconnect. */
  useEffect(() => {
    const s = socket;
    if (!s) return;

    const onMessage = (msg) => {
      if (msg.roomId && msg.roomId !== roomRef.current) return;
      const m = normalizeMessage(msg);
      setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m]));
      // Their message is in: they've stopped typing.
      setTypingMap((t) => {
        if (!t[m.userId]) return t;
        const next = { ...t };
        delete next[m.userId];
        return next;
      });
    };
    const onUpdated = (msg) => {
      if (msg.roomId && msg.roomId !== roomRef.current) return;
      const m = normalizeMessage(msg);
      setMessages((prev) => prev.map((p) => (p.id === m.id ? m : p)));
    };
    const onPresence = ({ roomId: r, users }) => {
      if (r === roomRef.current) setPeople(users ?? []);
    };
    const onTyping = ({ roomId: r, user, typing }) => {
      if (r !== roomRef.current || !user?.id) return;
      setTypingMap((t) => {
        const next = { ...t };
        if (typing) next[user.id] = { name: user.name, at: Date.now() };
        else delete next[user.id];
        return next;
      });
    };
    const onConnect = () => {
      if (wantRef.current) doJoin();
    };
    const onDisconnect = () => {
      joiningRef.current = false;
      setJoined(false);
      setTypingMap({});
    };

    s.on("message", onMessage);
    s.on("message-updated", onUpdated);
    s.on("room-presence", onPresence);
    s.on("room-typing", onTyping);
    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    return () => {
      s.off("message", onMessage);
      s.off("message-updated", onUpdated);
      s.off("room-presence", onPresence);
      s.off("room-typing", onTyping);
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
    };
  }, [socket, doJoin]);

  // Someone whose "stopped typing" never came (a closed laptop) drops off.
  const typingCount = Object.keys(typingMap).length;
  useEffect(() => {
    if (!typingCount) return;
    const t = setInterval(() => {
      setTypingMap((m) => {
        const now = Date.now();
        const fresh = Object.fromEntries(Object.entries(m).filter(([, v]) => now - v.at < TYPING_STALE_MS));
        return Object.keys(fresh).length === Object.keys(m).length ? m : fresh;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [typingCount]);

  const me = currentUser?._id ? String(currentUser._id) : null;
  const typing = Object.entries(typingMap)
    .filter(([id]) => id !== me)
    .map(([id, v]) => ({ id, name: v.name }));

  const join = useCallback(() => {
    if (!socketRef.current || !connected) return;
    if (triggerLoginIfNeeded()) return;
    wantRef.current = true;
    doJoin();
  }, [connected, triggerLoginIfNeeded, doJoin]);

  const leave = useCallback(() => {
    wantRef.current = false;
    if (!socketRef.current) return;
    socketRef.current.emit("leave-room", { roomId: roomRef.current }, () => setJoined(false));
  }, []);

  /* The page before the oldest loaded message. Resolves to how many came. */
  const loadOlder = useCallback(() => {
    const s = socketRef.current;
    const oldest = messages[0];
    if (!s || !joined || !hasMore || loadingOlder || !oldest) return Promise.resolve(0);
    setLoadingOlder(true);
    return new Promise((resolve) => {
      s.emit(
        "get-history",
        { roomId: roomRef.current, before: { ts: new Date(oldest.ts).toISOString(), id: oldest.id } },
        (ack) => {
          setLoadingOlder(false);
          if (!ack?.ok) return resolve(0);
          const older = (ack.messages ?? []).map(normalizeMessage);
          setMessages((prev) => {
            const have = new Set(prev.map((m) => m.id));
            return [...older.filter((m) => !have.has(m.id)), ...prev];
          });
          setHasMore(Boolean(ack.hasMore));
          resolve(older.length);
        }
      );
    });
  }, [messages, joined, hasMore, loadingOlder]);

  /* Typing: announce on the first keystroke and every few seconds while it
     goes on; "stopped" after a pause, or at once when sending. */
  const stopTyping = useCallback(() => {
    clearTimeout(typingIdle.current);
    if (!typingSent.current.on) return;
    typingSent.current = { on: false, at: 0 };
    socketRef.current?.emit("typing", { roomId: roomRef.current, typing: false });
  }, []);

  const setTyping = useCallback((on) => {
    if (!on) return stopTyping();
    const s = socketRef.current;
    if (!s?.connected) return;
    const now = Date.now();
    if (!typingSent.current.on || now - typingSent.current.at > TYPING_EVERY_MS) {
      typingSent.current = { on: true, at: now };
      s.emit("typing", { roomId: roomRef.current, typing: true });
    }
    clearTimeout(typingIdle.current);
    typingIdle.current = setTimeout(stopTyping, TYPING_IDLE_MS);
  }, [stopTyping]);

  const send = useCallback((opts = {}) => {
    const { replyTo = null, lfg = null, spoiler = false } = opts;

    const typed = input.trim();
    if (!typed) return false;
    const text = spoiler ? wrapSpoiler(typed) : typed;
    if (!socketRef.current) return false;
    if (!connected) return false;
    if (triggerLoginIfNeeded()) return false;

    const payload = {
      roomId: roomRef.current,
      text,
      clientId: crypto.randomUUID(),
      ...(replyTo ? { replyTo } : {}),
      ...(lfg ? { lfg } : {}),
    };

    stopTyping();
    socketRef.current.emit("send-msg", payload, (ack) => {
      if (ack?.error === "not_in_room") {
        // The server lost us (a restart, say): rejoin and put the text back.
        setInput((cur) => cur || typed);
        flashError("Reconnected to the room. Send it again.");
        wantRef.current = true;
        doJoin();
      } else if (ack?.error) {
        setInput((cur) => cur || typed);
        flashError(ERRORS[ack.error] || "Couldn't send that message.", ack.retryMs || 5000);
      }
    });

    setInput("");
    return true;
  }, [input, connected, triggerLoginIfNeeded, flashError, doJoin, stopTyping]);

  // One ack handler for the per-message actions; resolves to the ack (null
  // when offline), e.g. react's { ok, reacted }.
  const act = useCallback((event, payload, failText) => {
    const s = socketRef.current;
    if (!s?.connected) return Promise.resolve(null);
    return new Promise((resolve) => {
      s.emit(event, { roomId: roomRef.current, ...payload }, (ack) => {
        if (ack?.error) flashError(ERRORS[ack.error] || failText);
        resolve(ack ?? null);
      });
    });
  }, [flashError]);

  const edit = useCallback((id, text, { spoiler = false } = {}) => {
    const typed = text.trim();
    if (!typed) return false;
    stopTyping();
    act("edit-msg", { id, text: spoiler ? wrapSpoiler(typed) : typed }, "Couldn't edit that message.");
    return true;
  }, [act, stopTyping]);
  const remove = useCallback((id) => act("delete-msg", { id }, "Couldn't delete that message."), [act]);
  // remove: only take yours off (your own reaction chip), never add.
  const react = useCallback(
    (id, emoji, { remove = false } = {}) =>
      act("react-msg", { id, emoji, ...(remove ? { remove: true } : {}) }, "Couldn't react to that message."),
    [act]
  );
  const joinGroup = useCallback((id) => act("lfg-join", { id }, "Couldn't update the group."), [act]);
  // The room's whole history, not just what's loaded: resolves to up to 25
  // matches, newest first ({ id, from, text, ts }).
  const search = useCallback(
    (q) => act("search-msgs", { q }, "Couldn't search the chat.").then((ack) =>
      (ack?.results ?? []).map((r) => ({
        id: r.id, from: r.from?.name || "Someone", avatar: r.from?.avatar ?? null,
        text: r.text, ts: new Date(r.ts).getTime(),
      }))
    ),
    [act]
  );

  return {
    joined,
    messages,
    hasMore,
    loadingOlder,
    loadOlder,
    people,
    typing,
    input,
    setInput,
    join,
    leave,
    send,
    edit,
    remove,
    react,
    joinGroup,
    search,
    setTyping,
    sendError,
  };
}
