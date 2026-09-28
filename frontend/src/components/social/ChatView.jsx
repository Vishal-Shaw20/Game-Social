import { useCallback, useEffect, useRef, useState } from "react";
import { ensureConnected, useSocketEvent } from "../../realtime/socket";
import styles from "./Squad.module.css";

const API_URL = import.meta.env.VITE_API_URL;
const PAGE = 50;
const TYPING_IDLE_MS = 2500;

const nameOf = (u) => u?.displayName || u?.username || "Someone";
const initial = (n) => (n || "?").trim().charAt(0).toUpperCase();

const dayLabel = (d) => {
  const date = new Date(d);
  const today = new Date();
  const yest = new Date(today);
  yest.setDate(today.getDate() - 1);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(date, today)) return "Today";
  if (same(date, yest)) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

const timeOf = (d) =>
  new Date(d).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/**
 * One conversation: its history, live messages, and the composer.
 *
 * History is fetched over HTTP a page at a time (scrolling up loads more);
 * new messages arrive on the socket. Opening it, and every message while
 * it's open, marks it read, and the server is told this conversation is on
 * screen so it doesn't also send a notification for it.
 */
export default function ChatView({ conversation, me, onRead, onSent }) {
  const conversationId = conversation._id;
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [typists, setTypists] = useState([]);

  const listRef = useRef(null);
  const bottomRef = useRef(null);
  const typingSentAt = useRef(0);

  const markRead = useCallback(() => {
    fetch(`${API_URL}/api/conversations/${conversationId}/read`, {
      method: "POST",
      credentials: "include"
    }).catch(() => {});
    onRead?.(conversationId);
  }, [conversationId, onRead]);

  /* Load the newest page whenever the conversation changes. */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessages([]);
    setTypists([]);

    fetch(`${API_URL}/api/conversations/${conversationId}/messages?limit=${PAGE}`, {
      credentials: "include"
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("history");
        setHasMore(r.headers.get("X-Has-More") === "true");
        return r.json();
      })
      .then((rows) => {
        if (cancelled) return;
        setMessages(rows);
        requestAnimationFrame(() => bottomRef.current?.scrollIntoView());
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));

    const socket = ensureConnected();
    socket.emit("conv-viewing", { conversationId });
    markRead();

    return () => {
      cancelled = true;
      socket.emit("conv-viewing", { conversationId: null });
    };
  }, [conversationId, markRead]);

  /* Live messages for this conversation. */
  const onMessage = useCallback(
    (msg) => {
      if (String(msg.conversationId) !== String(conversationId)) return;
      setMessages((prev) => {
        // Replace my own optimistic copy rather than showing it twice.
        const mine = msg.clientId && prev.findIndex((m) => m.clientId === msg.clientId);
        if (mine != null && mine >= 0) {
          const next = [...prev];
          next[mine] = msg;
          return next;
        }
        return prev.some((m) => m.id === msg.id) ? prev : [...prev, msg];
      });
      setTypists((prev) => prev.filter((t) => t.userId !== msg.from.id));
      if (msg.from.id !== String(me._id)) markRead();
    },
    [conversationId, markRead, me._id]
  );
  useSocketEvent("conv-message", onMessage);

  const onTyping = useCallback(
    ({ conversationId: id, userId, name, typing }) => {
      if (String(id) !== String(conversationId) || userId === String(me._id)) return;
      setTypists((prev) => {
        const without = prev.filter((t) => t.userId !== userId);
        return typing ? [...without, { userId, name, at: Date.now() }] : without;
      });
    },
    [conversationId, me._id]
  );
  useSocketEvent("conv-typing", onTyping);

  // Someone who stops typing without sending shouldn't linger.
  useEffect(() => {
    if (typists.length === 0) return;
    const id = setInterval(() => {
      setTypists((prev) => prev.filter((t) => Date.now() - t.at < TYPING_IDLE_MS * 2));
    }, 1000);
    return () => clearInterval(id);
  }, [typists.length]);

  /* Keep the view pinned to the newest message. */
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    if (nearBottom) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function loadOlder() {
    if (!hasMore || loading || messages.length === 0) return;
    setLoading(true);
    const el = listRef.current;
    const before = messages[0].ts;
    try {
      const res = await fetch(
        `${API_URL}/api/conversations/${conversationId}/messages?limit=${PAGE}&before=${encodeURIComponent(before)}`,
        { credentials: "include" }
      );
      if (!res.ok) return;
      setHasMore(res.headers.get("X-Has-More") === "true");
      const older = await res.json();
      const heightBefore = el?.scrollHeight ?? 0;
      setMessages((prev) => [...older, ...prev]);
      // Stay on the same message rather than jumping to the top.
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - heightBefore;
      });
    } finally {
      setLoading(false);
    }
  }

  function send(e) {
    e?.preventDefault();
    const body = text.trim();
    if (!body) return;

    const clientId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic = {
      id: clientId,
      clientId,
      conversationId,
      from: { id: String(me._id), name: nameOf(me), avatar: me.avatar ?? null },
      text: body,
      ts: new Date().toISOString(),
      pending: true
    };
    setMessages((prev) => [...prev, optimistic]);
    setText("");

    ensureConnected().emit("conv-send", { conversationId, text: body, clientId }, (ack) => {
      if (ack?.error) {
        setMessages((prev) =>
          prev.map((m) => (m.clientId === clientId ? { ...m, failed: true, pending: false } : m))
        );
      }
    });
    onSent?.(conversationId, body);
  }

  function onInput(e) {
    setText(e.target.value);
    const now = Date.now();
    if (now - typingSentAt.current > TYPING_IDLE_MS) {
      typingSentAt.current = now;
      ensureConnected().emit("conv-typing", { conversationId, typing: true });
    }
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) send(e);
  }

  const title =
    conversation.type === "group"
      ? conversation.name || conversation.members.map(nameOf).join(", ")
      : nameOf(conversation.other);

  return (
    <div className={styles.chat}>
      <div
        ref={listRef}
        className={styles.messages}
        onScroll={(e) => {
          if (e.currentTarget.scrollTop < 80) loadOlder();
        }}
      >
        {hasMore && (
          <button type="button" className={styles.loadOlder} onClick={loadOlder} disabled={loading}>
            {loading ? "Loading…" : "Load older messages"}
          </button>
        )}

        {!hasMore && !loading && (
          <div className={styles.chatStart}>
            <div className={styles.chatStartTitle}>{title}</div>
            <p>This is the beginning of your conversation.</p>
          </div>
        )}

        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || dayLabel(prev.ts) !== dayLabel(m.ts);
          // Consecutive messages from the same person within 5 minutes are
          // shown as one block, without repeating the name.
          const grouped =
            !newDay &&
            prev &&
            prev.from.id === m.from.id &&
            new Date(m.ts) - new Date(prev.ts) < 5 * 60 * 1000;

          return (
            <div key={m.id}>
              {newDay && <div className={styles.dayDivider}><span>{dayLabel(m.ts)}</span></div>}
              <div className={`${styles.message} ${grouped ? styles.messageGrouped : ""} ${m.failed ? styles.messageFailed : ""}`}>
                {!grouped && (
                  <div className={styles.messageAvatar} aria-hidden="true">
                    {m.from.avatar ? <img src={m.from.avatar} alt="" /> : initial(m.from.name)}
                  </div>
                )}
                <div className={styles.messageBody}>
                  {!grouped && (
                    <div className={styles.messageMeta}>
                      <span className={styles.messageAuthor}>{m.from.name}</span>
                      <span className={styles.messageTime}>{timeOf(m.ts)}</span>
                    </div>
                  )}
                  <div className={`${styles.messageText} ${m.pending ? styles.messagePending : ""}`}>
                    {m.text}
                    {m.failed && <span className={styles.failedTag}> · not sent</span>}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className={styles.typing}>
        {typists.length > 0 &&
          `${typists.map((t) => t.name).join(", ")} ${typists.length === 1 ? "is" : "are"} typing…`}
      </div>

      <form className={styles.composer} onSubmit={send}>
        <textarea
          className={styles.composerInput}
          value={text}
          onChange={onInput}
          onKeyDown={onKeyDown}
          rows={1}
          maxLength={2000}
          placeholder={`Message ${title}`}
        />
        <button type="submit" className={styles.sendBtn} disabled={!text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
