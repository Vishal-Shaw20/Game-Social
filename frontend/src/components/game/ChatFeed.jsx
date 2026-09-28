import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Loader2, Reply, SmilePlus, Pencil, Trash2, ArrowDown, Users, Gamepad2, Search, X, Headphones, MicOff,
} from "lucide-react";
import CallTimer from "./CallTimer";
import ScrollRail from "./ScrollRail";
import rail from "./ScrollRail.module.css";
import { API, full } from "./format";
import { typingText, isSpoiler, unwrapSpoiler, spoilerSafe } from "../../hooks/useTextChat";
import EmojiPicker from "./EmojiPicker";
import { quickEmojis, recordEmoji } from "./emojiUsage";
import feed from "./ReviewFeed.module.css";
import styles from "./ChatFeed.module.css";

/*
 * Chat side of the game dock's modal, laid out like the reviews side
 * (ReviewFeed): two columns, each scrolling on its own with the dock's
 * scrollbar.
 *
 *   left    the room's messages, laid out like Discord: flat rows (no
 *           bubbles), avatar + name + time on the first of a run from one
 *           person within a few minutes, the time in the gutter on hover for
 *           the rest; your own messages are the same, mirrored to the right.
 *           A reply starts a new run, with a line from the quoted message
 *           into its avatar (click the quote to jump to it). Rows that
 *           mention you, or reply to you, are tinted. Hovering a row shows
 *           quick reactions, reply, and edit / delete on your own.
 *           Spoilers are hidden whole, @names link to profiles, "looking for
 *           group" posts are cards you can join. A "New" line marks what
 *           arrived since your last visit, and a pill jumps down to messages
 *           that came in while you were scrolled up.
 *   right   who's in the room now (live), friends playing the game right
 *           now, and the room's stats. While you're in the voice room it
 *           shows the voice room instead, live: how many are in it, how
 *           long it's been open and you've been in, who's talking or muted
 *           (nothing about voice is stored, so no history).
 *
 * Writing happens in the dock's bar below (GameDock), which also holds the
 * reply / edit state this list starts.
 */

const GROUP_GAP_MS = 5 * 60 * 1000;
const LOAD_OLDER_AT = 80; // px from the top
const STICK_TO_BOTTOM = 120; // px from the bottom counts as "at the bottom"
const JUMP_MAX_PAGES = 20; // how far back a quote's "jump to" will load
const seenKey = (roomId) => `gs.chatSeen.${roomId}`;

const dayKey = (ts) => new Date(ts).toDateString();
function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 864e5);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}
const clock = (ts) => new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
// A run's header: the time today, the date and time before that.
function stamp(ts) {
  const d = new Date(ts);
  if (d.toDateString() === new Date().toDateString()) return `Today at ${clock(ts)}`;
  return `${d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" })} ${clock(ts)}`;
}

// Names in a stable colour per person (like Discord's role colours).
const NAME_COLORS = ["#f0b232", "#e06c75", "#c792ea", "#7ee787", "#79c0ff", "#ff9e64", "#f778ba", "#56d4dd"];
function nameColor(id) {
  let h = 0;
  for (const ch of String(id ?? "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return NAME_COLORS[h % NAME_COLORS.length];
}

function readSeen(roomId) {
  try {
    return Number(localStorage.getItem(seenKey(roomId))) || 0;
  } catch {
    return 0;
  }
}
function writeSeen(roomId, ts) {
  try {
    if (ts > readSeen(roomId)) localStorage.setItem(seenKey(roomId), String(ts));
  } catch {
    /* not remembered: the "New" line just won't show next time */
  }
}

/** Days, each a list of runs of messages from one author. */
function groupMessages(messages) {
  const days = [];
  for (const m of messages) {
    let day = days[days.length - 1];
    if (!day || day.key !== dayKey(m.ts)) {
      day = { key: dayKey(m.ts), ts: m.ts, groups: [] };
      days.push(day);
    }
    const g = day.groups[day.groups.length - 1];
    const last = g?.messages[g.messages.length - 1];
    // A reply or a group card always starts its own run, so it gets a
    // header (and the reply its quote line).
    const joins = g && g.userId && g.userId === m.userId && m.ts - last.ts < GROUP_GAP_MS &&
      !m.replyTo && m.kind !== "lfg" && last.kind !== "lfg";
    if (joins) g.messages.push(m);
    else day.groups.push({ key: m.id ?? `${m.ts}`, userId: m.userId, from: m.from, username: m.username, avatar: m.avatar, messages: [m] });
  }
  return days;
}

export default function ChatFeed({
  chat, gameId, currentUserId, currentUsername, connected, community, visible,
  replyingToId, editingId, onReply, onEdit, voiceRoom,
}) {
  const mainRef = useRef(null);
  const sideRef = useRef(null);
  const { joined, messages, hasMore, loadingOlder, loadOlder, people, typing } = chat;
  const roomId = `game:${gameId}`;
  const me = String(currentUserId ?? "");

  /* ── scrolling ──
     New messages keep you at the bottom if you were there (or sent them);
     older pages load above without moving what you're reading. */
  const atBottom = useRef(true);
  const anchor = useRef(null); // scrollHeight before an older page came in
  const firstId = messages[0]?.id;
  const lastMsg = messages[messages.length - 1];

  // "New since your last visit" is fixed when the page opens; what you've
  // read since is tracked for the jump pill and saved for next time.
  const [lastVisit] = useState(() => readSeen(roomId));
  const [readUpTo, setReadUpTo] = useState(() => Date.now());
  const [away, setAway] = useState(false); // scrolled up from the bottom

  useLayoutEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    if (anchor.current != null) {
      el.scrollTop += el.scrollHeight - anchor.current;
      anchor.current = null;
    }
  }, [firstId]);

  useLayoutEffect(() => {
    const el = mainRef.current;
    if (!el || !lastMsg) return;
    if (atBottom.current || String(lastMsg.userId) === me) {
      el.scrollTop = el.scrollHeight;
      atBottom.current = true;
    }
  }, [lastMsg, me]);

  // Opening the modal on the chat shows the latest.
  useLayoutEffect(() => {
    const el = mainRef.current;
    if (visible && el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [visible]);

  const older = useCallback(() => {
    const el = mainRef.current;
    if (!el || !hasMore || loadingOlder) return;
    anchor.current = el.scrollHeight;
    loadOlder().then((n) => { if (!n) anchor.current = null; });
  }, [hasMore, loadingOlder, loadOlder]);

  const onScroll = () => {
    const el = mainRef.current;
    if (!el) return;
    if (pickerFor != null) setPicker(null); // its row just moved away from it
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_TO_BOTTOM;
    setAway(!atBottom.current);
    if (atBottom.current && lastMsg) {
      setReadUpTo((t) => Math.max(t, lastMsg.ts));
      if (visible) writeSeen(roomId, lastMsg.ts);
    }
    if (el.scrollTop < LOAD_OLDER_AT) older();
  };

  // Seen by being shown: the newest message counts as read whenever the
  // modal is open at the bottom (also when it's too short to scroll).
  useEffect(() => {
    if (visible && lastMsg && atBottom.current) writeSeen(roomId, lastMsg.ts);
  }, [visible, lastMsg, roomId]);

  const toBottom = () => {
    const el = mainRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  // A short first page that doesn't fill the column can't be scrolled up to
  // ask for more, so ask straight away.
  useEffect(() => {
    const el = mainRef.current;
    if (el && joined && hasMore && el.scrollHeight <= el.clientHeight) older();
  }, [joined, hasMore, firstId, older]);

  /* ── jumping to a quoted message ──
     If it isn't loaded yet, older pages load until it is (up to a limit);
     the effect below picks the jump up again after each page. */
  const pendingJump = useRef(null);
  const tryJump = useCallback((id) => {
    const el = mainRef.current;
    const target = el?.querySelector(`[data-mid="${CSS.escape(id)}"]`);
    if (!target) return false;
    const r = target.getBoundingClientRect();
    const s = el.getBoundingClientRect();
    el.scrollTo({ top: el.scrollTop + r.top - s.top - s.height / 3, behavior: "smooth" });
    target.classList.remove(styles.flash);
    void target.offsetWidth; // restart the animation
    target.classList.add(styles.flash);
    return true;
  }, []);

  const jumpTo = (id) => {
    if (tryJump(id)) return;
    pendingJump.current = { id, pages: 0 };
    older();
  };

  useEffect(() => {
    const p = pendingJump.current;
    if (!p || loadingOlder) return;
    if (tryJump(p.id)) {
      pendingJump.current = null;
    } else if (hasMore && p.pages < JUMP_MAX_PAGES) {
      p.pages += 1;
      older();
    } else {
      pendingJump.current = null;
    }
  }, [firstId, loadingOlder, hasMore, older, tryJump]);

  /* ── per-message actions ── */
  // The reaction picker: which message it's for and where it sits. It's
  // drawn in the messages column (not inside the scrolling list), so it's
  // never clipped; above the button that opened it, or below if there's no
  // room.
  const [picker, setPicker] = useState(null); // { id, left, top }
  const pickerFor = picker?.id ?? null;
  // Shown only while its message is still there (not deleted meanwhile) and
  // the modal is open; a picker left open when the modal closed doesn't come
  // back with it (see the reset below).
  const pickerLive = Boolean(picker) && visible &&
    messages.some((m) => m.id === picker.id && !m.deleted);
  const [wasVisible, setWasVisible] = useState(visible);
  if (wasVisible !== visible) {
    setWasVisible(visible);
    if (!visible) setPicker(null);
  }
  const columnRef = useRef(null);
  const pickerRef = useRef(null);
  const [quick, setQuick] = useState(quickEmojis);

  const PICKER_W = 400;
  const PICKER_H = 380;
  const openPicker = (id, button, mine) => {
    if (pickerFor === id) return setPicker(null);
    const col = columnRef.current?.getBoundingClientRect();
    const b = button.getBoundingClientRect();
    if (!col) return;
    let top = b.top - col.top - PICKER_H - 8;
    if (top < 8) top = Math.min(b.bottom - col.top + 8, col.height - PICKER_H - 8);
    let left = mine ? b.left - col.left : b.right - col.left - PICKER_W;
    left = Math.max(8, Math.min(left, col.width - PICKER_W - 8));
    setPicker({ id, left, top: Math.max(8, top) });
  };

  // Every reaction click is a toggle, settled by the server. Only an actual
  // add counts towards your frequently used emojis (taking one off isn't
  // "using" it). The quick buttons are re-ranked only once the pointer has
  // left the messages, never while you're clicking them: re-sorting under
  // the cursor made the next click land on a different emoji.
  const react = (id, emoji, opts) => {
    setPicker(null);
    chat.react(id, emoji, opts).then((ack) => {
      if (ack?.reacted) recordEmoji(emoji);
    });
  };

  // Closes on a click outside it (and outside its row's bar), or Esc.
  useEffect(() => {
    if (pickerFor == null) return;
    const bar = () => mainRef.current?.querySelector(`[data-mid="${CSS.escape(pickerFor)}"] .${styles.tools}`);
    const onDown = (e) => {
      if (!pickerRef.current?.contains(e.target) && !bar()?.contains(e.target)) setPicker(null);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setPicker(null);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [pickerFor]);

  const others = people.filter((p) => String(p.id) !== me);
  const days = groupMessages(messages);
  const firstNewId = lastVisit
    ? messages.find((m) => m.ts > lastVisit && String(m.userId) !== me)?.id
    : null;
  const unseen = messages.filter((m) => m.ts > readUpTo && String(m.userId) !== me).length;

  /* ── searching the room ──
     Asks the server (the whole history, not just what's loaded) a moment
     after typing stops; picking a result jumps to it. */
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef(null);
  const query = q.trim();
  const searchOpen = query.length >= 2;
  const { search } = chat;

  useEffect(() => {
    if (query.length < 2) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setSearching(true);
      search(query).then((found) => {
        if (cancelled) return;
        setResults(found);
        setSearching(false);
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, search]);

  // A click outside the search box closes its results.
  useEffect(() => {
    if (!searchOpen) return;
    const onDown = (e) => {
      if (!searchRef.current?.contains(e.target)) setQ("");
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [searchOpen]);

  const pickResult = (id) => {
    setQ("");
    jumpTo(id);
  };

  /* ── right column ── */
  const stats = useChatStats(gameId, visible);
  // Messages newer than the stats' snapshot (or the page's own, until the
  // stats load), counted in on top of it.
  const snapAt = stats ? stats.lastMessageAt : community?.chat?.lastMessageAt;
  const snapLast = snapAt ? new Date(snapAt).getTime() : 0;
  const since = messages.filter((m) => m.ts > snapLast && !m.deleted);
  const playingNow = (community?.friends ?? []).filter((f) => f.playingNow);
  const voicePeople = voiceRoom?.people ?? [];
  const voiceIds = new Set(voicePeople.map((p) => String(p.userId)));
  const inVoiceRoom = Boolean(voiceRoom?.here);
  // Messages per hour over the last day; new ones since the stats were
  // fetched count in the current hour.
  const hourly = stats?.hourly
    ? stats.hourly.map((n, i) => (i === 23 ? n + since.length : n))
    : null;

  return (
    <div className={feed.layout}>
      {/* ── right: the room, in the reviews side's language: an activity
          chart where that side has its gauge, people as chips like its
          verdict filters, the week's chatters with share bars. ── */}
      <aside className={feed.side}>
        <div ref={sideRef} className={`${feed.scroller} ${rail.scroller}`}>
         {inVoiceRoom ? (
          <VoiceRoomStats room={voiceRoom} />
         ) : (
          <>
          <section className={feed.panel}>
            <ActivityChart hourly={hourly} />
          </section>

          <section className={feed.panel}>
            <div className={styles.sideTitle}>
              <span className={`${styles.liveDot} ${others.length ? "" : styles.liveDotIdle}`} />
              <span className={styles.label}>In the room</span>
              <span className={styles.pillCount}>{joined ? people.length : (community?.chat?.here ?? 0)}</span>
            </div>
            {joined ? (
              <div className={styles.chipList}>
                {people.map((p) => {
                  const inVoice = voiceIds.has(String(p.id));
                  return (
                    <div key={p.id} className={styles.personChip}>
                      <Avatar src={p.avatar} name={p.name} small />
                      <span className={styles.personName}>{p.name}</span>
                      {inVoice && <Headphones size={14} className={styles.inVoice} aria-label="in the voice room" />}
                      {String(p.id) === me && <span className={styles.you}>you</span>}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className={styles.note}>{connected ? "Joining…" : "Connecting…"}</p>
            )}
          </section>

          {playingNow.length > 0 && (
            <section className={feed.panel}>
              <div className={styles.sideTitle}>
                <Gamepad2 size={14} className={styles.titleIcon} />
                <span className={styles.label}>Friends playing now</span>
                <span className={styles.pillCount}>{playingNow.length}</span>
              </div>
              <div className={styles.chipList}>
                {playingNow.map((f) => (
                  <div key={f.id} className={`${styles.personChip} ${styles.personChipPlaying}`}>
                    <Avatar src={f.avatar} name={f.name} small />
                    {f.username ? (
                      <Link to={`/u/${f.username}`} className={styles.personName}>{f.name}</Link>
                    ) : (
                      <span className={styles.personName}>{f.name}</span>
                    )}
                    <span className={styles.playingDot} title="In game now" />
                  </div>
                ))}
              </div>
            </section>
          )}

          {stats?.topChatters?.length > 0 && (
            <section className={feed.panel}>
              <div className={styles.sideTitle}>
                <span className={styles.label}>This week</span>
              </div>
              <div className={styles.chipList}>
                {stats.topChatters.map((u) => (
                  <div
                    key={u.id}
                    className={`${styles.personChip} ${styles.shareChip}`}
                    style={{ "--share": `${(u.messages / stats.topChatters[0].messages) * 100}%` }}
                  >
                    <Avatar src={u.avatar} name={u.name} small />
                    {u.username ? (
                      <Link to={`/u/${u.username}`} className={styles.personName}>{u.name}</Link>
                    ) : (
                      <span className={styles.personName}>{u.name}</span>
                    )}
                    <span className={styles.pillCount}>{full(u.messages)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
          </>
         )}
        </div>
        <ScrollRail targetRef={sideRef} watch={`${people.length}:${playingNow.length}:${stats ? 1 : 0}:${inVoiceRoom ? voicePeople.length : "t"}`} />
      </aside>

      {/* ── left: the messages ── */}
      <div ref={columnRef} className={feed.main} onMouseLeave={() => setQuick(quickEmojis())}>
        {/* One panel, like the right column's: the header on top (the room's
            name, and a search over its whole history), the messages
            scrolling under it. */}
        <div className={styles.chatPanel}>
          <header className={`${feed.head} ${styles.chatHead}`}>
            <h2 className={feed.title}>
              Room chat
            </h2>
            <div className={styles.search} ref={searchRef}>
              <Search size={14} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setQ("");
                  } else if (e.key === "Enter" && results[0] && searchOpen) {
                    pickResult(results[0].id);
                  }
                }}
                placeholder="Search this room"
                aria-label="Search messages in this room"
              />
              {q && (
                <button type="button" className={styles.searchClear} onClick={() => setQ("")} aria-label="Clear search">
                  <X size={13} />
                </button>
              )}
              {searchOpen && (
                <div className={styles.results} role="listbox" aria-label="Matching messages">
                  {searching && !results.length ? (
                    <p className={styles.resultsNote}>Searching…</p>
                  ) : !results.length ? (
                    <p className={styles.resultsNote}>No messages match “{q.trim()}”.</p>
                  ) : (
                    results.map((r) => (
                      <button key={r.id} type="button" role="option" aria-selected="false" className={styles.result} onClick={() => pickResult(r.id)}>
                        <Avatar src={r.avatar} name={r.from} small />
                        <span className={styles.resultBody}>
                          <span className={styles.resultHead}>
                            <b>{r.from}</b> <time>{stamp(r.ts)}</time>
                          </span>
                          <span className={styles.resultText}>{highlight(spoilerSafe(r.text), q.trim())}</span>
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </header>

        <div ref={mainRef} className={`${rail.scroller} ${styles.messages}`} onScroll={onScroll}>
          {!joined && <p className={feed.empty}>{connected ? "Joining the room…" : "Connecting…"}</p>}
          {joined && messages.length === 0 && <p className={feed.empty}>No messages yet. Say hi from the bar below.</p>}

          {joined && messages.length > 0 && (
            <div className={styles.historyEdge}>
              {hasMore ? (
                <button type="button" className={styles.olderBtn} onClick={older} disabled={loadingOlder}>
                  {loadingOlder ? <><Loader2 size={13} className={styles.spin} /> Loading…</> : "Load older messages"}
                </button>
              ) : (
                <span className={styles.startNote}>Start of the conversation</span>
              )}
            </div>
          )}

          {days.map((day) => (
            <section key={day.key} className={styles.day}>
              <div className={styles.dayLabel}><span className={styles.dayPill}>{dayLabel(day.ts)}</span></div>
              {day.groups.map((g) => {
                const mine = g.userId && String(g.userId) === me;
                return (
                  <div key={g.key} className={`${styles.group} ${mine ? styles.mine : ""}`}>
                    {g.messages.map((m, i) => (
                      <Message
                        key={m.id ?? m.ts}
                        m={m}
                        group={g}
                        first={i === 0}
                        isNew={m.id === firstNewId}
                        mine={mine}
                        me={me}
                        myUsername={currentUsername}
                        active={m.id === replyingToId || m.id === editingId}
                        quick={quick}
                        pickerOpen={pickerFor === m.id}
                        onTogglePicker={(button) => openPicker(m.id, button, mine)}
                        onQuickReact={(emoji) => react(m.id, emoji)}
                        onUnreact={(emoji) => react(m.id, emoji, { remove: true })}
                        onReply={() => onReply(m)}
                        onEdit={() => onEdit(m)}
                        onDelete={() => {
                          if (window.confirm("Delete this message? Everyone will see that it was deleted.")) chat.remove(m.id);
                        }}
                        onJoinGroup={() => chat.joinGroup(m.id)}
                        onJump={jumpTo}
                      />
                    ))}
                  </div>
                );
              })}
            </section>
          ))}

          {typing.length > 0 && (
            <div className={styles.typing} aria-live="polite">
              <span className={styles.typingDots} aria-hidden="true"><i /><i /><i /></span>
              {typingText(typing)}
            </div>
          )}
        </div>
        </div>

        {picker && pickerLive && (
          <EmojiPicker
            pickerRef={pickerRef}
            style={{ left: picker.left, top: picker.top }}
            onPick={(emoji) => react(picker.id, emoji)}
          />
        )}

        {away && unseen > 0 && (
          <button type="button" className={styles.jumpPill} onClick={toBottom}>
            <ArrowDown size={14} /> {unseen} new message{unseen === 1 ? "" : "s"}
          </button>
        )}
        <ScrollRail targetRef={mainRef} watch={`${messages.length}:${visible}:${typing.length}`} />
      </div>
    </div>
  );
}

/** The room's numbers, fetched when the modal opens (and each minute while
    it's open); the server caches them for a minute too. */
function useChatStats(gameId, visible) {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const load = () =>
      fetch(`${API}/api/gamepage/${gameId}/chat-stats?tz=${encodeURIComponent(tz)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((s) => { if (!cancelled && s) setStats(s); })
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [gameId, visible]);
  return stats;
}

/*
 * The room's last 24 hours as bars, one per hour (oldest left, now on the
 * right), with the total above: the chat side's counterpart to the reviews
 * gauge. Hovering (or tabbing to) a bar puts that hour in the headline and
 * dims the rest.
 */
function ActivityChart({ hourly }) {
  const [focus, setFocus] = useState(null); // index into hourly
  const data = hourly ?? Array(24).fill(0);
  const max = Math.max(1, ...data);
  const total = data.reduce((a, b) => a + b, 0);
  const W = 240, H = 84, gap = 3;
  const bw = (W - gap * 23) / 24;
  const hourStart = (i) => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() - (23 - i));
    return d;
  };
  const shown = focus != null ? data[focus] : total;

  return (
    <div className={`${styles.activity} ${focus != null ? styles.activityFocus : ""}`} onMouseLeave={() => setFocus(null)}>
      <div className={styles.actHead}>
        <span className={styles.actNum}>{hourly ? full(shown) : "—"}</span>
        <span className={styles.label}>
          {focus != null
            ? `${shown === 1 ? "message" : "messages"} · ${hourStart(focus).toLocaleTimeString(undefined, { hour: "numeric" })}`
            : `${total === 1 ? "message" : "messages"} · last 24 hours`}
        </span>
      </div>
      <svg className={styles.actBars} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${total} messages in the last 24 hours`}>
        {data.map((n, i) => {
          const h = n ? Math.max(4, (n / max) * H) : 2;
          return (
            <rect
              key={i}
              x={i * (bw + gap)}
              y={H - h}
              width={bw}
              height={h}
              rx={Math.min(2.5, bw / 2)}
              className={`${styles.actBar} ${n ? "" : styles.actBarEmpty} ${focus === i ? styles.actBarOn : ""}`}
              tabIndex={n ? 0 : -1}
              onMouseEnter={() => setFocus(i)}
              onFocus={() => setFocus(i)}
              onBlur={() => setFocus(null)}
            />
          );
        })}
      </svg>
      <div className={styles.actAxis}><span>24h ago</span><span>now</span></div>
    </div>
  );
}

/*
 * The stats column while you're in the voice room, all live (nothing about
 * voice is stored): how many are in it with how long the room has been open
 * and how long you've been in, then everyone in it with their own time,
 * who's talking (a green edge) and who's muted.
 */
function VoiceRoomStats({ room }) {
  const people = room.people ?? [];
  const talking = people.filter((p) => p.speaking).length;
  const muted = people.filter((p) => p.muted).length;
  return (
    <>
      <section className={`${feed.panel} ${styles.voicePanel}`}>
        <div className={styles.actHead}>
          <span className={styles.actNum}>{people.length}</span>
          <span className={styles.label}>{people.length === 1 ? "person" : "people"} in the voice room</span>
        </div>
        <dl className={styles.voiceStats}>
          <div><dt>Room open</dt><dd><CallTimer since={room.startedAt} /></dd></div>
          <div><dt>You've been in</dt><dd><CallTimer since={room.joinedAt} /></dd></div>
          <div><dt>Talking now</dt><dd>{talking}</dd></div>
          <div><dt>Muted</dt><dd>{muted}</dd></div>
        </dl>
      </section>

      <section className={feed.panel}>
        <div className={styles.sideTitle}>
          <span className={styles.liveDot} />
          <span className={styles.label}>In the voice room</span>
          <span className={styles.pillCount}>{people.length}</span>
        </div>
        <div className={styles.chipList}>
          {people.map((p) => (
            <div key={p.userId} className={`${styles.personChip} ${p.speaking ? styles.personChipTalking : ""}`}>
              <Avatar src={p.avatar} name={p.name} small />
              <span className={styles.personName}>{p.name}</span>
              {p.muted && <MicOff size={14} className={styles.voiceMuted} aria-label="muted" />}
              {p.since && <span className={styles.voiceSince}><CallTimer since={p.since} /></span>}
              {p.self && <span className={styles.you}>you</span>}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function NewLine() {
  return <div className={styles.newLine}><span>New</span></div>;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function Message({
  m, group, first, isNew, mine, me, myUsername, active, pickerOpen,
  quick, onTogglePicker, onQuickReact, onUnreact, onReply, onEdit, onDelete, onJoinGroup, onJump,
}) {
  // Tinted like a ping: it @mentions you, or replies to something of yours.
  const forMe = !mine && !m.deleted && Boolean(
    (myUsername && new RegExp(`(^|[^\\w])@${escapeRe(myUsername)}(?![\\w])`, "i").test(m.text)) ||
    (m.replyTo?.userId && String(m.replyTo.userId) === me)
  );
  const nameStyle = mine ? undefined : { color: nameColor(group.userId) };
  const rowStyle = { "--nc": mine ? "var(--a)" : nameColor(group.userId) };
  const quoted = first && Boolean(m.replyTo);

  return (
    <>
      {isNew && <NewLine />}
      <div
        data-mid={m.id}
        style={rowStyle}
        className={`${styles.row} ${first ? styles.rowFirst : ""} ${quoted ? styles.rowReply : ""} ${active ? styles.rowActive : ""} ${forMe ? styles.rowForMe : ""}`}
      >
        {/* The quoted message is part of the row, so hovering it counts as
            hovering the reply (its bar shows, its row lights up). */}
        {quoted && (
          <button type="button" className={styles.replyRef} onClick={() => onJump(m.replyTo.id)} title="Show the original message">
            <Avatar src={m.replyTo.avatar} name={m.replyTo.from} tiny />
            <span className={styles.replyName} style={{ color: nameColor(m.replyTo.userId) }}>{m.replyTo.from}</span>
            <span className={styles.replyText}>{m.replyTo.excerpt ? spoilerSafe(m.replyTo.excerpt, { excerpt: true }) : "Message deleted"}</span>
          </button>
        )}
        <div className={styles.gutter}>
          {first ? (
            <Avatar src={group.avatar} name={group.from} />
          ) : (
            <time className={styles.gutterTime} dateTime={new Date(m.ts).toISOString()} title={new Date(m.ts).toLocaleString()}>
              {clock(m.ts)}
            </time>
          )}
        </div>

        <div className={styles.content}>
         {/* The message itself: the hover bar sits just outside it (to its
             right, or left for your own), not at the far edge of the row. */}
         <div className={`${styles.box} ${m.kind === "lfg" && m.lfg && !m.deleted ? styles.boxWide : ""}`}>
          {first && (
            <div className={styles.head}>
              {group.username
                ? <Link to={`/u/${group.username}`} className={styles.name} style={nameStyle}>{group.from}</Link>
                : <span className={styles.name} style={nameStyle}>{group.from}</span>}
              <time className={styles.time} dateTime={new Date(m.ts).toISOString()} title={new Date(m.ts).toLocaleString()}>
                {stamp(m.ts)}
              </time>
            </div>
          )}

          {m.deleted ? (
            <div className={`${styles.text} ${styles.deleted}`}>Message deleted</div>
          ) : m.kind === "lfg" && m.lfg ? (
            <GroupCard m={m} mine={mine} me={me} onJoin={onJoinGroup} />
          ) : (
            <div className={styles.text}>
              <RichText text={m.text} />
              {m.editedAt && <span className={styles.edited} title={new Date(m.editedAt).toLocaleString()}> (edited)</span>}
            </div>
          )}

          {m.reactions?.length > 0 && (
            <div className={styles.reactions}>
              {/* Your own reactions are buttons that take yours off; the
                  others are just counts (react from the hover bar). */}
              {m.reactions.map((r) => {
                const mineR = r.userIds.includes(me);
                const n = r.userIds.length;
                return mineR ? (
                  <button
                    key={r.emoji}
                    type="button"
                    className={`${styles.reaction} ${styles.reactionMine}`}
                    onClick={() => onUnreact(r.emoji)}
                    title="Remove your reaction"
                    aria-label={`${r.emoji} ${n}, yours: remove`}
                  >
                    {r.emoji} <span>{n}</span>
                  </button>
                ) : (
                  <span key={r.emoji} className={styles.reaction} title={`${n} ${n === 1 ? "reaction" : "reactions"}`}>
                    {r.emoji} <span>{n}</span>
                  </span>
                );
              })}
            </div>
          )}

        {!m.deleted && (
          // Mouse presses don't focus the bar's buttons (a focused button used
          // to keep the bar up after the mouse left); keyboard focus still works.
          <div className={`${styles.tools} ${pickerOpen ? styles.toolsOpen : ""}`} onMouseDown={(e) => e.preventDefault()}>
            {quick.map((e) => (
              <button key={e} type="button" className={styles.toolEmoji} onClick={() => onQuickReact(e)} title={`React ${e}`}>{e}</button>
            ))}
            <span className={styles.toolSep} />
            <button type="button" onClick={(e) => onTogglePicker(e.currentTarget)} title="Add reaction" aria-label="Add reaction" aria-expanded={pickerOpen}>
              <SmilePlus size={16} />
            </button>
            {mine && (
              <button type="button" onClick={onEdit} title="Edit" aria-label="Edit">
                <Pencil size={15} />
              </button>
            )}
            <button type="button" onClick={onReply} title="Reply" aria-label="Reply">
              <Reply size={16} />
            </button>
            {mine && (
              <button type="button" className={styles.toolDanger} onClick={onDelete} title="Delete" aria-label="Delete">
                <Trash2 size={15} />
              </button>
            )}
          </div>
        )}
         </div>
        </div>
      </div>
    </>
  );
}

/** A "looking for group" post: the note, the platform, who's in, and
    I'm in / Leave for everyone but the poster. */
function GroupCard({ m, mine, me, onJoin }) {
  const { platform, slots, joined } = m.lfg;
  const isIn = joined.some((u) => u.id === me);
  const isFull = joined.length >= slots;
  return (
    <div className={styles.lfg}>
      <div className={styles.lfgHead}>
        <Users size={15} />
        <span className={styles.lfgTitle}>Looking for group</span>
        <span className={styles.lfgPlatform}>{platform}</span>
        <span className={styles.lfgSlots}>{joined.length}/{slots}</span>
      </div>
      <p className={styles.lfgNote}>
        <RichText text={m.text} />
        {m.editedAt && <span className={styles.edited}> (edited)</span>}
      </p>
      <div className={styles.lfgFoot}>
        <div className={styles.lfgFaces}>
          {joined.map((u) => (
            <Avatar key={u.id} src={u.avatar} name={u.name} small title={u.name} />
          ))}
          {!joined.length && <span className={styles.note}>No one yet</span>}
        </div>
        {mine ? (
          <span className={styles.lfgMine}>{isFull ? "Your group is full" : "Your group"}</span>
        ) : (
          <button
            type="button"
            className={`${styles.lfgBtn} ${isIn ? styles.lfgLeave : ""}`}
            onClick={onJoin}
            disabled={!isIn && isFull}
          >
            {isIn ? "Leave" : isFull ? "Full" : "I'm in"}
          </button>
        )}
      </div>
    </div>
  );
}

/* ── message text: spoilers and @mentions ── */

/** The text with each (case-insensitive) occurrence of `term` marked. */
function highlight(text, term) {
  if (!term) return text;
  const parts = text.split(new RegExp(`(${escapeRe(term)})`, "ig"));
  return parts.map((p, i) => (i % 2 ? <mark key={i} className={styles.hit}>{p}</mark> : p));
}

/** A message's text; a spoiler message is hidden whole until clicked. */
function RichText({ text }) {
  if (isSpoiler(text)) return <Spoiler><Mentions text={unwrapSpoiler(text)} /></Spoiler>;
  return <Mentions text={text} />;
}

function Mentions({ text }) {
  const out = [];
  const re = /(^|[^\w])@([a-zA-Z0-9_]+)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    const at = m.index + m[1].length;
    if (at > last) out.push(text.slice(last, at));
    out.push(<Link key={at} to={`/u/${m[2]}`} className={styles.mention}>@{m[2]}</Link>);
    last = at + 1 + m[2].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Spoiler({ children }) {
  const [shown, setShown] = useState(false);
  return (
    <span
      role="button"
      tabIndex={shown ? -1 : 0}
      className={`${styles.spoiler} ${shown ? styles.spoilerShown : ""}`}
      onClick={() => setShown(true)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setShown(true)}
      title={shown ? undefined : "Spoiler: click to show"}
      aria-label={shown ? undefined : "Spoiler, activate to show"}
    >
      {children}
    </span>
  );
}

function Avatar({ src, name, small = false, tiny = false, title }) {
  const cls = `${styles.avatar} ${small ? styles.avatarSmall : ""} ${tiny ? styles.avatarTiny : ""}`;
  // A picture that fails to load (a dead link) falls back to the initial.
  const [failed, setFailed] = useState(null);
  if (src && failed !== src) {
    return <img className={cls} src={src} alt="" loading="lazy" title={title} onError={() => setFailed(src)} />;
  }
  return <span className={cls} aria-hidden="true" title={title}>{((name || "?").trim()[0] ?? "?").toUpperCase()}</span>;
}
