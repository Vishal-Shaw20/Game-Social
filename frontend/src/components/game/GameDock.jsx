import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SendHorizontal, Headphones, HeadphoneOff, PhoneOff, Loader2, Reply, Pencil, X, Check, Users, Mic, MicOff, Radio, EyeOff, Settings } from "lucide-react";
import MentionInput from "../../MentionInput";
import ReviewFeed from "./ReviewFeed";
import ChatFeed from "./ChatFeed";
import ReviewComposer from "./ReviewComposer";
import { useSocket } from "../../hooks/useSocket";
import { useTextChat, typingText, isSpoiler, unwrapSpoiler } from "../../hooks/useTextChat";
import { useVoice, pttKeyLabel } from "../../realtime/voiceContext";
import { useVoiceRoom } from "../../realtime/useVoiceRoom";
import { VERDICT_META, findMyReview } from "./format";
import CallTimer from "./CallTimer";
import styles from "./GameDock.module.css";

/*
 * The game page's persistent bottom dock.
 *
 *   ┌──────────── modal ────────────┐   what there is to read: every review,
 *   │  reviews list / chat messages │   or the chat room's messages
 *  ┌┴───────────────────────────────┴┐
 *  │ bar: write a review, or join    │ ▲  vertical toggle: Reviews (top)
 *  │ the chat / voice and type       │ ▼  / Chat (bottom)
 *  └─────────────────────────────────┘
 *
 * The bar spans the whole window. It is up to a third of the window tall,
 * but never taller than the space below the left nav rail's last button, so
 * it never covers the nav (it measures the rail on every resize). When that
 * leaves it short, the composer switches to a compact layout. Its height is
 * published as --game-dock-h for the page's bottom padding.
 *
 * The toggle swipes both the bar and the modal vertically between the two
 * modes. Hovering the dock opens the modal; it closes shortly after the mouse
 * leaves, unless something inside the modal has focus (e.g. a comment being
 * typed), or if the knob is switched to hollow (click the circle). Esc and a
 * click elsewhere close it too. The knob can be dragged; see "the knob".
 */

const FILLED_KEY = "gs.dockPreview";
function readFilledPref() {
  try {
    return localStorage.getItem(FILLED_KEY) !== "0";
  } catch {
    return true;
  }
}
function writeFilledPref(on) {
  try {
    localStorage.setItem(FILLED_KEY, on ? "1" : "0");
  } catch {
    /* not remembered, still works for this visit */
  }
}

// Which face the knob was last on (reviews or chat), kept across visits.
const MODE_KEY = "gs.dockMode";
function readModePref() {
  try {
    return localStorage.getItem(MODE_KEY) === "chat" ? "chat" : "reviews";
  } catch {
    return "reviews";
  }
}
function writeModePref(m) {
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    /* not remembered, still works for this visit */
  }
}

const MAX_H = 360;
const MIN_H = 110;
const NAV_GAP = 16;       // space kept between the nav's last button and the bar
const COMPACT_BELOW = 200;

function preferredHeight() {
  const pref = Math.min(MAX_H, Math.max(240, window.innerHeight * 0.33));
  const rail = document.querySelector("[data-nav-rail]");
  const r = rail?.getBoundingClientRect();
  if (!r || !r.height) return Math.round(pref); // no rail (e.g. hidden on mobile)
  const room = window.innerHeight - r.bottom - NAV_GAP;
  return Math.round(Math.max(MIN_H, Math.min(pref, room)));
}

const OPEN_DELAY = 140;
const CLOSE_DELAY = 280;
const MODES = ["reviews", "chat"];
const MAX_MESSAGE = 500;
// "Looking for group" choices (the server accepts the same list).
const LFG_PLATFORMS = ["Any", "PC", "PlayStation", "Xbox", "Switch", "Mobile"];
const LFG_MAX_SLOTS = 10;

function GameDock({ gameId, gameName, auth, reviews, setReviews, myReview, setMyReview, community, tagContext }) {
  // Only mounted for a signed-in user (GameDetails), so no login states here.
  const { currentUser, isAuthenticated, authChecked } = auth;
  const currentUserId = currentUser?._id ? String(currentUser._id) : null;

  const [mode, setMode] = useState(readModePref);
  // `wantOpen` is what hover/clicks ask for; the modal only shows while the
  // knob is filled, so nothing (not even a late hover timer) opens it while
  // it's hollow.
  const [wantOpen, setOpen] = useState(false);
  const [filled, setFilled] = useState(readFilledPref);
  const open = wantOpen && filled;
  const [barH, setBarH] = useState(240);

  // Size to the space under the nav rail; re-measured on any resize (the
  // observer also fires once on attach).
  useEffect(() => {
    const measure = () => setBarH(preferredHeight());
    const ro = new ResizeObserver(measure);
    ro.observe(document.documentElement);
    const rail = document.querySelector("[data-nav-rail]");
    if (rail) ro.observe(rail);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--game-dock-h", `${barH}px`);
  }, [barH]);
  useEffect(() => () => document.documentElement.style.removeProperty("--game-dock-h"), []);
  const compact = barH < COMPACT_BELOW;
  // True while the toggle's swipe runs: the bar clips its content only then,
  // so at rest the @mention dropdown can open upward past the bar's edge.
  const [swiping, setSwiping] = useState(false);
  const swipeTimer = useRef(null);
  const switchMode = (m) => {
    setMode(m);
    writeModePref(m);
    setSwiping(true);
    clearTimeout(swipeTimer.current);
    swipeTimer.current = setTimeout(() => setSwiping(false), 520);
  };

  /* ── the knob ──
     Filled (default): hovering the dock opens the modal. Hollow: the modal
     stays shut, however you hover. Clicking the circle switches between the
     two; the choice is remembered per browser. (On touch screens, which
     can't hover, filled simply means the modal is open.) */
  const toggleFilled = () => {
    const next = !filled;
    setFilled(next);
    writeFilledPref(next);
    // Hollow shuts the modal. Filled lets hover open it again (on touch
    // screens, where nothing hovers, it opens it straight away).
    if (!next) setOpen(false);
    else if (!canHover.current) setOpen(true);
    return next;
  };

  /* ── dragging the knob ──
     The knob follows the pointer, and so do the bar and modal (their --i is
     the drag position while it lasts). On release the swipe completes by
     itself: past a quarter of the way (or a quick flick) it carries on to
     the other side, otherwise it slides back. A press without movement is a
     click: on the circle it toggles filled/hollow, elsewhere on the track it
     switches to that half. */
  const trackRef = useRef(null);
  const knobRef = useRef(null);
  const drag = useRef(null);
  const [dragP, setDragP] = useState(null);

  const onKnobDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    const el = trackRef.current;
    el.setPointerCapture?.(e.pointerId);
    const r = el.getBoundingClientRect();
    const k = knobRef.current.getBoundingClientRect();
    const start = MODES.indexOf(mode);
    drag.current = {
      y0: e.clientY,
      p0: start,
      p: start,
      travel: Math.max(1, r.height - k.height - (r.width - k.width)),
      rectTop: r.top,
      rectH: r.height,
      onKnob:
        e.clientX >= k.left && e.clientX <= k.right && e.clientY >= k.top && e.clientY <= k.bottom,
      moved: false,
      last: { p: start, t: e.timeStamp },
      velocity: 0, // knob positions per ms, + is towards chat
    };
  };
  const onKnobMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.y0;
    if (!d.moved && Math.abs(dy) < 4) return;
    if (!d.moved) {
      d.moved = true;
      setSwiping(true);
      clearTimeout(swipeTimer.current);
    }
    d.p = Math.min(1, Math.max(0, d.p0 + dy / d.travel));
    const dt = e.timeStamp - d.last.t;
    if (dt > 0) d.velocity = (d.p - d.last.p) / dt;
    d.last = { p: d.p, t: e.timeStamp };
    setDragP(d.p);
  };
  // Every way a drag can end lands here (release, cancel, lost capture), so
  // the swipe can never be left half-way.
  const onKnobUp = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    setDragP(null);
    if (d.moved) {
      const toward = d.p0 === 0 ? 1 : -1;          // direction of the other side
      const progress = (d.p - d.p0) * toward;       // 0..1 of the way over
      const flick = d.velocity * toward > 0.004 && e.type !== "lostpointercapture";
      const target = progress >= 0.25 || flick ? 1 - d.p0 : d.p0;
      return switchMode(MODES[target]);
    }
    if (e.type !== "pointerup") return;
    // Clicked with the pointer on the dock, so filling it opens the modal now.
    if (d.onKnob) return toggleFilled() && setOpen(true);
    const tapped = e.clientY - d.rectTop < d.rectH / 2 ? 0 : 1;
    if (tapped !== d.p0) switchMode(MODES[tapped]);
  };
  const rootRef = useRef(null);
  const modalRef = useRef(null);
  const barRef = useRef(null);
  const hovered = useRef(false);
  const timers = useRef({});
  const canHover = useRef(
    typeof window !== "undefined" && window.matchMedia?.("(hover: hover)").matches
  );

  /* ── chat ── */
  const roomId = `game:${gameId}`;
  const { socket, connected } = useSocket(authChecked, isAuthenticated, currentUser);
  const chat = useTextChat(socket, connected, roomId, currentUser);
  const { joined, join, leave } = chat;

  // Voice (only when switched on in the backend): the app's one call, as on
  // the Social page. Joining here starts it; its controls are in the right
  // sidebar, and joining any other room hangs this one up.
  const voice = useVoice();
  const voiceRoom = useVoiceRoom(roomId, currentUserId);
  // Named as a voice room wherever the session shows (the sidebar's voice panel).
  const joinVoice = () => voice.join(roomId, `${gameName} voice room`);

  const ensureJoined = useCallback(() => {
    if (!joined && connected) join();
  }, [joined, connected, join]);

  /* What the chat box is doing besides a plain message: replying to one
     (quoted above the box), editing one of yours (its text in the box), or
     posting a "looking for group" card (platform and slots above the box).
     Reply and edit are started from a message in the modal. */
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [lfgOn, setLfgOn] = useState(false);
  const [spoilerOn, setSpoilerOn] = useState(false); // the whole message is a spoiler
  const [lfgPlatform, setLfgPlatform] = useState("Any");
  const [lfgSlots, setLfgSlots] = useState(3);
  const chatInputRef = useRef(null);
  const focusChat = () => setTimeout(() => chatInputRef.current?.focus({ preventScroll: true }), 30);

  const startReply = (m) => {
    if (editing) chat.setInput("");
    setEditing(null);
    setReplyTo(m);
    focusChat();
  };
  const startEdit = (m) => {
    setReplyTo(null);
    setLfgOn(false);
    setEditing(m);
    setSpoilerOn(isSpoiler(m.text));
    chat.setInput(unwrapSpoiler(m.text));
    focusChat();
  };
  const cancelCompose = () => {
    if (editing) chat.setInput("");
    setEditing(null);
    setReplyTo(null);
    setLfgOn(false);
    setSpoilerOn(false);
  };

  const submitChat = () => {
    if (!joined) return ensureJoined();
    if (editing) {
      if (chat.edit(editing.id, chat.input, { spoiler: spoilerOn })) {
        setEditing(null);
        setSpoilerOn(false);
        chat.setInput("");
      }
      return;
    }
    const sent = chat.send({
      replyTo: replyTo?.id ?? null,
      lfg: lfgOn ? { platform: lfgPlatform, slots: lfgSlots } : null,
      spoiler: spoilerOn,
    });
    if (sent) {
      setReplyTo(null);
      setLfgOn(false);
      setSpoilerOn(false);
    }
  };

  // Leave the room when the page goes away (the page remounts per game).
  const leaveRef = useRef(leave);
  const joinedRef = useRef(joined);
  useEffect(() => {
    leaveRef.current = leave;
    joinedRef.current = joined;
  }, [leave, joined]);
  useEffect(() => () => joinedRef.current && leaveRef.current(), []);

  // Showing the chat (bar or modal) joins the room: its history loads and
  // you appear in "here now". You stay in it until you leave the page.
  useEffect(() => {
    if (mode === "chat") ensureJoined();
  }, [mode, ensureJoined]);

  /* ── open / close ── */
  const clearTimers = () => {
    clearTimeout(timers.current.open);
    clearTimeout(timers.current.close);
  };
  useEffect(() => () => clearTimers(), []);
  useEffect(() => () => clearTimeout(swipeTimer.current), []);

  const focusInModal = () => modalRef.current?.contains(document.activeElement);

  const scheduleClose = useCallback(() => {
    clearTimeout(timers.current.close);
    timers.current.close = setTimeout(() => {
      if (!hovered.current && !focusInModal()) setOpen(false);
    }, CLOSE_DELAY);
  }, []);

  const onEnter = () => {
    hovered.current = true;
    clearTimers();
    if (canHover.current && filled) timers.current.open = setTimeout(() => setOpen(true), OPEN_DELAY);
  };
  const onLeave = () => {
    hovered.current = false;
    clearTimeout(timers.current.open);
    scheduleClose();
  };
  const onBlur = (e) => {
    if (!rootRef.current?.contains(e.relatedTarget)) scheduleClose();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      if (focusInModal()) document.activeElement.blur();
    };
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  // The verdict tinting the dock: what's being written, else what's published.
  const accentVerdict = (myReview ?? findMyReview(reviews, currentUserId))?.verdict;

  const modeIndex = MODES.indexOf(mode);

  return (
    <div
      ref={rootRef}
      className={`${styles.root} ${open ? styles.isOpen : ""} ${swiping ? styles.swiping : ""} ${compact ? styles.compact : ""} ${dragP !== null ? styles.dragging : ""}`}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onBlur={onBlur}
      style={{
        "--i": dragP ?? modeIndex,
        "--bar-h": `${barH}px`,
        // The picked verdict tints the dock (see --accent in the CSS).
        ...(VERDICT_META[accentVerdict] ? { "--verdict": VERDICT_META[accentVerdict].color } : {}),
      }}
    >
      {/* ── modal: the reading side ── */}
      <div
        ref={modalRef}
        className={styles.modal}
        aria-hidden={!open}
        inert={!open}
        role="dialog"
        aria-label={mode === "chat" ? `${gameName} chat room` : `${gameName} reviews`}
      >
        <div className={styles.track}>
          <section className={styles.pane} inert={mode !== "reviews"}>
            {/* ReviewFeed fills the pane and scrolls its two columns itself. */}
            <ReviewFeed
              reviews={reviews}
              setReviews={setReviews}
              currentUserId={currentUserId}
              currentUser={currentUser}
            />
          </section>

          <section className={styles.pane} inert={mode !== "chat"}>
            <ChatFeed
              chat={chat}
              gameId={gameId}
              currentUserId={currentUserId}
              currentUsername={currentUser?.username ?? null}
              connected={connected}
              community={community}
              visible={open && mode === "chat"}
              replyingToId={replyTo?.id ?? null}
              editingId={editing?.id ?? null}
              onReply={startReply}
              onEdit={startEdit}
              voiceRoom={voiceRoom.enabled ? voiceRoom : null}
            />
          </section>
        </div>
      </div>

      {/* ── bar: the writing side ── */}
      <div className={styles.bar} ref={barRef} data-game-dock-bar /* the game page scrolls its name bar above this */>
        <div className={styles.barTrackWrap}>
          <div className={styles.barTrack}>
            <div className={styles.barPane} inert={mode !== "reviews"}>
              <ReviewComposer
                gameId={gameId}
                reviews={reviews}
                setReviews={setReviews}
                draft={myReview}
                setDraft={setMyReview}
                currentUserId={currentUserId}
                compact={compact}
                tagContext={tagContext}
              />
            </div>

            <div className={styles.barPane} inert={mode !== "chat"}>
              {/* Who's in the room lives in the modal; the bar is for
                  writing, plus the voice call when voice is on. */}
              <div className={`${styles.chatBar} ${voiceRoom.enabled ? "" : styles.chatBarSolo}`}>
                  {voiceRoom.enabled && (
                    <VoiceColumn room={voiceRoom} onJoin={joinVoice} onLeave={voice.leave} />
                  )}

                  {/* the writing box, like the review's */}
                  <form
                    className={`${styles.col} ${styles.textCol}`}
                    onSubmit={(e) => {
                      e.preventDefault();
                      submitChat();
                    }}
                  >
                    <div className={styles.colLabel}>
                      {editing ? "Editing your message" : lfgOn ? "Looking for group" : "Message"}
                    </div>
                    <div className={styles.writeBox}>
                      {(replyTo || editing) && (
                        <div className={styles.composeNote}>
                          {replyTo ? <Reply size={14} /> : <Pencil size={13} />}
                          {replyTo ? (
                            <span className={styles.composeText}>
                              Replying to <b>{replyTo.from}</b>
                              <span className={styles.composeExcerpt}>
                                {replyTo.kind === "lfg" ? `Looking for group: ${replyTo.text}` : replyTo.text}
                              </span>
                            </span>
                          ) : (
                            <span className={styles.composeText}>Editing your message</span>
                          )}
                          <button type="button" className={styles.composeX} onClick={cancelCompose} aria-label="Cancel" title="Cancel (Esc)">
                            <X size={14} />
                          </button>
                        </div>
                      )}
                      {/* Always shown; usable only in group mode (the Group
                          switch below). */}
                      <div
                        className={`${styles.lfgOptions} ${lfgOn ? "" : styles.lfgOptionsOff}`}
                        inert={!lfgOn}
                        aria-disabled={!lfgOn}
                      >
                          <div className={styles.lfgPlatforms} role="radiogroup" aria-label="Platform">
                            {LFG_PLATFORMS.map((p) => (
                              <button
                                key={p}
                                type="button"
                                role="radio"
                                aria-checked={lfgPlatform === p}
                                className={`${styles.lfgChip} ${lfgPlatform === p ? styles.lfgChipOn : ""}`}
                                onClick={() => setLfgPlatform(p)}
                              >
                                {p}
                              </button>
                            ))}
                          </div>
                          <div className={styles.lfgSlots}>
                            <button type="button" onClick={() => setLfgSlots((n) => Math.max(1, n - 1))} aria-label="Fewer players" disabled={lfgSlots <= 1}>−</button>
                            <span><b>{lfgSlots}</b> {lfgSlots === 1 ? "player" : "players"} wanted</span>
                            <button type="button" onClick={() => setLfgSlots((n) => Math.min(LFG_MAX_SLOTS, n + 1))} aria-label="More players" disabled={lfgSlots >= LFG_MAX_SLOTS}>+</button>
                          </div>
                      </div>
                      <MentionInput
                        inputRef={(el) => { chatInputRef.current = el; }}
                        value={chat.input}
                        onChange={(v) => {
                          chat.setInput(v);
                          if (!editing) chat.setTyping(v.trim().length > 0);
                        }}
                        onFocus={ensureJoined}
                        onBlur={() => chat.setTyping(false)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            e.currentTarget.form.requestSubmit();
                          } else if (e.key === "Escape" && (replyTo || editing || lfgOn || spoilerOn)) {
                            e.preventDefault();
                            cancelCompose();
                          }
                        }}
                        placeholder={lfgOn
                          ? "What are you after? e.g. co-op run tonight, chill, mic on"
                          : spoilerOn
                            ? "Hidden until someone clicks it…"
                            : `Message the ${gameName} room… @mention someone`}
                        maxLength={spoilerOn ? MAX_MESSAGE - 4 : MAX_MESSAGE}
                        aria-label="Chat message"
                        rows={3}
                      />
                      <div className={styles.writeFoot}>
                        <button
                          type="button"
                          className={`${styles.lfgToggle} ${lfgOn ? styles.lfgToggleOn : ""}`}
                          onClick={() => setLfgOn((v) => !v)}
                          disabled={Boolean(editing)}
                          aria-pressed={lfgOn}
                          title="Post a 'looking for group' card people can join"
                        >
                          <Users size={14} /> Group
                        </button>
                        <button
                          type="button"
                          className={`${styles.lfgToggle} ${spoilerOn ? styles.spoilerToggleOn : ""}`}
                          onClick={() => setSpoilerOn((v) => !v)}
                          aria-pressed={spoilerOn}
                          title="Hide the whole message until someone clicks it"
                        >
                          <EyeOff size={14} /> Spoiler
                        </button>
                        {chat.sendError ? (
                          <span className={styles.error}>{chat.sendError}</span>
                        ) : chat.typing.length ? (
                          <span className={styles.hint}>{typingText(chat.typing)}</span>
                        ) : (
                          <span className={styles.hint}>Enter to send · Shift+Enter for a new line</span>
                        )}
                        <span className={styles.footSpacer} />
                        {chat.input.length > MAX_MESSAGE * 0.8 && (
                          <span className={styles.hint}>{chat.input.length}/{MAX_MESSAGE}</span>
                        )}
                        {(replyTo || editing || lfgOn || spoilerOn) && (
                          <button type="button" className={styles.cancelLink} onClick={cancelCompose}>Cancel</button>
                        )}
                        <button type="submit" className={styles.submitBtn} disabled={!chat.input.trim() || !joined}>
                          Send <SendHorizontal size={15} strokeWidth={2.25} className={styles.sendIcon} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </form>
                </div>
            </div>
          </div>
        </div>

        {/* ── the vertical toggle: an accent-coloured knob in a full-height track; drag it
            or tap a half. The buttons are for keyboard use. ── */}
        <div
          ref={trackRef}
          className={styles.toggle}
          role="tablist"
          aria-orientation="vertical"
          aria-label="Reviews or chat"
          onPointerDown={onKnobDown}
          onPointerMove={onKnobMove}
          onPointerUp={onKnobUp}
          onPointerCancel={onKnobUp}
          onLostPointerCapture={onKnobUp}
          // Pointer presses are handled above, so they mustn't move focus
          // onto the (keyboard-only) half buttons: a focused half button
          // shows its focus ring around the knob as soon as any key is
          // pressed (F11, say), which looked like a stray outline.
          onMouseDown={(e) => e.preventDefault()}
        >
          {/* The circle. Pointer presses are handled by the track (see
              onKnobUp); as a button it serves keyboard users. */}
          <button
            ref={knobRef}
            type="button"
            className={`${styles.thumb} ${filled ? "" : styles.thumbHollow}`}
            aria-pressed={filled}
            aria-label={filled ? "Preview on hover: on" : "Preview on hover: off"}
            title={filled ? "Click to keep the panel above closed" : "Click to open the panel above on hover"}
            onClick={(e) => e.detail === 0 && toggleFilled()}
          />
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              aria-label={m === "reviews" ? "Reviews" : "Chat"}
              title={m === "reviews" ? "Reviews" : "Chat"}
              className={styles.toggleBtn}
              // Pointer presses are handled on the track; this is Enter/Space.
              onClick={(e) => e.detail === 0 && m !== mode && switchMode(m)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/*
 * The room's voice call, as the bar's left column: laid out like the
 * reviews side's verdict column (same buttons), with the call's status in
 * the column label. Top to bottom: the call itself (start / join / move
 * here / leave), then mute, deafen and push-to-talk, which only work once
 * you're in. Who's in the call is shown in the modal's "In the room" list.
 */
function VoiceColumn({ room, onJoin, onLeave }) {
  const { here, elsewhere, connecting, people, count } = room;
  const live = people.length > 0;

  let status;
  if (connecting) status = <>Connecting…</>;
  else if (here) status = <>Connected · <CallTimer since={room.joinedAt} /></>;
  else if (live) status = <>{count} in the room · <CallTimer since={room.startedAt} /></>;
  else status = <>Quiet</>;

  const call = here
    ? { c: "#f85149", icon: <PhoneOff size={17} />, text: "Leave voice room", on: true, action: onLeave }
    : {
        c: "#3fb950",
        icon: connecting ? <Loader2 size={17} className={styles.spin} /> : <Headphones size={17} />,
        text: connecting ? "Connecting…" : elsewhere ? "Switch voice room" : "Join voice room",
        on: false,
        action: onJoin,
      };

  return (
    <div className={styles.col}>
      <div className={styles.colLabel}>
        <span className={styles.voiceLabel}>
          <span className={`${styles.voiceDot} ${live ? styles.voiceDotLive : ""}`} />
          Voice · {status}
        </span>
      </div>
      <div className={styles.verdicts}>
        <button
          type="button"
          className={`${styles.verdictBtn} ${call.on ? styles.verdictOn : ""}`}
          style={{ "--c": call.c }}
          onClick={call.action}
          disabled={connecting}
          title={elsewhere && !here ? `Leaves ${room.elsewhereLabel || "your other voice room"}` : undefined}
        >
          {call.icon} {call.text}
        </button>
        <button
          type="button"
          className={`${styles.verdictBtn} ${here && room.selfMuted ? styles.verdictOn : ""}`}
          style={{ "--c": "#f85149" }}
          onClick={() => room.setMuted(!room.selfMuted)}
          disabled={!here}
          aria-pressed={here && room.selfMuted}
        >
          {here && room.selfMuted ? <MicOff size={17} /> : <Mic size={17} />} {here && room.selfMuted ? "Muted" : "Mute"}
        </button>
        <button
          type="button"
          className={`${styles.verdictBtn} ${here && room.deafened ? styles.verdictOn : ""}`}
          style={{ "--c": "#d29922" }}
          onClick={() => room.setDeafened(!room.deafened)}
          disabled={!here}
          aria-pressed={here && room.deafened}
          title="Hear no one"
        >
          {here && room.deafened ? <HeadphoneOff size={17} /> : <Headphones size={17} />} {here && room.deafened ? "Deafened" : "Deafen"}
        </button>
        {/* the push-to-talk switch, with its settings gear inside at the right */}
        <div className={styles.pttWrap}>
          <button
            type="button"
            className={`${styles.verdictBtn} ${here && room.pushToTalk ? styles.verdictOn : ""}`}
            style={{ "--c": "#d4956e" }}
            onClick={() => room.setPushToTalk(!room.pushToTalk)}
            disabled={!here}
            aria-pressed={here && room.pushToTalk}
            title={`Your mic is only open while you hold ${pttKeyLabel(room.pttKey)}`}
          >
            <Radio size={17} /> Push to talk
          </button>
          <PttSettings room={room} />
        </div>
      </div>
      {room.error && <p className={styles.voiceError}>{room.error}</p>}
    </div>
  );
}

/*
 * Push-to-talk settings: the gear inside the push-to-talk button, and a
 * small panel above it with the shortcut (click, then press a key), a
 * release delay and sound cues. They're this browser's, and apply to every
 * call. Esc or a click outside closes it.
 */
const PTT_PANEL_W = 300;
const PTT_DELAYS = [0, 150, 300, 600];

function PttSettings({ room }) {
  const [pos, setPos] = useState(null); // where the open panel sits, or null
  const [binding, setBinding] = useState(false); // waiting for a key
  const gearRef = useRef(null);
  const panelRef = useRef(null);
  const { setPtt } = room;

  const close = () => {
    setPos(null);
    setBinding(false);
  };
  const toggle = () => {
    if (pos) return close();
    const r = gearRef.current.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(r.left - 14, window.innerWidth - PTT_PANEL_W - 8)),
      bottom: window.innerHeight - r.top + 10,
    });
  };

  useEffect(() => {
    if (!pos) return;
    const shut = () => {
      setPos(null);
      setBinding(false);
    };
    const onDown = (e) => {
      if (!panelRef.current?.contains(e.target) && !gearRef.current?.contains(e.target)) shut();
    };
    // Captured first, so a key being bound (or Esc) goes nowhere else: not
    // to push-to-talk itself, and not to the modal's own Esc.
    const onKey = (e) => {
      if (binding) {
        e.preventDefault();
        e.stopPropagation();
        if (e.code !== "Escape") setPtt({ key: e.code });
        setBinding(false);
      } else if (e.key === "Escape") {
        e.stopPropagation();
        shut();
      }
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", shut);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", shut);
    };
  }, [pos, binding, setPtt]);

  return (
    <>
      <button
        ref={gearRef}
        type="button"
        className={`${styles.pttGear} ${pos ? styles.pttGearOn : ""}`}
        onClick={toggle}
        aria-label="Push to talk settings"
        aria-expanded={Boolean(pos)}
        title="Push to talk settings"
      >
        <Settings size={15} />
      </button>
      {pos && createPortal(
        <div
          ref={panelRef}
          className={styles.pttPanel}
          style={{ left: pos.left, bottom: pos.bottom, width: PTT_PANEL_W }}
          role="dialog"
          aria-label="Push to talk settings"
        >
          <div className={styles.pttHead}>
            <Radio size={14} />
            <span className={styles.pttTitle}>Push to talk</span>
            <button type="button" className={styles.pttClose} onClick={close} aria-label="Close">
              <X size={14} />
            </button>
          </div>

          <div className={styles.pttRow}>
            <div className={styles.pttText}>
              <div className={styles.pttLabel}>Shortcut</div>
              <div className={styles.pttHint}>Hold it to talk. Ignored while you're typing.</div>
            </div>
            <button
              type="button"
              className={`${styles.pttKey} ${binding ? styles.pttKeyBinding : ""}`}
              onClick={() => setBinding((b) => !b)}
              title={binding ? "Press a key (Esc to cancel)" : "Click, then press a key"}
            >
              {binding ? "Press a key…" : pttKeyLabel(room.pttKey)}
            </button>
          </div>

          <div className={styles.pttRow}>
            <div className={styles.pttText}>
              <div className={styles.pttLabel}>Release delay</div>
              <div className={styles.pttHint}>Keeps your mic open a moment after you let go, so your last word isn't cut off.</div>
              <div className={styles.pttSeg} role="radiogroup" aria-label="Release delay">
                {PTT_DELAYS.map((ms) => (
                  <button
                    key={ms}
                    type="button"
                    role="radio"
                    aria-checked={room.pttDelay === ms}
                    className={room.pttDelay === ms ? styles.pttSegOn : ""}
                    onClick={() => setPtt({ delay: ms })}
                  >
                    {ms ? `${ms} ms` : "Off"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className={styles.pttRow}>
            <div className={styles.pttText}>
              <div className={styles.pttLabel}>Sound cues</div>
              <div className={styles.pttHint}>A soft click when your mic opens and closes.</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={room.pttSounds}
              aria-label="Sound cues"
              className={`${styles.pttSwitch} ${room.pttSounds ? styles.pttSwitchOn : ""}`}
              onClick={() => setPtt({ sounds: !room.pttSounds })}
            />
          </div>

          {!room.pushToTalk && (
            <p className={styles.pttNote}>Push to talk is off: turn it on with the button, once you're in the voice room.</p>
          )}
        </div>,
        document.body
      )}
    </>
  );
}

export default GameDock;
