import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import SquadPanel from "./social/SquadPanel";
import { useSocketEvent } from "../realtime/socket";
import styles from "./Social.module.css";

const API_URL = import.meta.env.VITE_API_URL;

const nameOf = (u) => u?.displayName || u?.username || "Someone";

/* "3m ago", "2h ago", "Sep 14". */
function timeAgo(date) {
  const s = (Date.now() - new Date(date).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/*
 * Friends need consent: "Add" sends a request, which the other person
 * accepts or declines. Everything here updates live over the shared socket:
 * - "friends-changed": a request arrived, was accepted/declined/cancelled,
 *   or someone unfriended -> reload friends, requests and search relations;
 * - "activity": a friend did something -> prepend it to the feed.
 */
/* ───────── Feed tab ─────────
   What friends have been doing: reviews, likes, new friends, games added or
   played, and game rooms they're chatting in. New entries arrive live as
   "activity" socket events. */
function FeedPanel() {
  const navigate = useNavigate();
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_URL}/api/friends/activity`, { credentials: "include" })
      .then(r => (r.ok ? r.json() : []))
      .then(setActivity)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const onActivity = useCallback((a) => {
    setActivity(prev => (prev.some(p => p._id === a._id) ? prev : [a, ...prev].slice(0, 30)));
  }, []);
  useSocketEvent("activity", onActivity);

  return (
    <div className={styles.feed}>
      <div className={styles.socialSectionTitle}>Friend activity</div>

      {loading && <div className={styles.socialInfo}>Loading activity…</div>}

      {!loading && activity.length === 0 && (
        <div className={styles.socialInfo}>
          No recent activity. When your friends review, play or add games, it shows up here.
        </div>
      )}

      {activity.map(a => (
        <div
          key={a._id}
          className={styles.socialActivityItem}
          onClick={() => a.url && navigate(a.url)}
        >
          <strong>{nameOf(a.userId)}</strong> <span>{a.text}</span>
          <div className={styles.socialTime}>{timeAgo(a.createdAt)}</div>
        </div>
      ))}
    </div>
  );
}

/* ───────── Page: Squad | Feed ─────────
   A full-width two-way switch; the whole page below slides between the
   tabs. Switch by click, arrow keys, or a horizontal swipe on touch screens.
   The open tab is in the URL (?tab=feed) so reloads and links keep it. */
const TABS = [
  { key: "squad", label: "Squad" },
  { key: "feed", label: "Feed" },
];
const SWIPE_PX = 60;

function Social() {
  const [params, setParams] = useSearchParams();
  const index = Math.max(0, TABS.findIndex(t => t.key === params.get("tab")));
  const tabRefs = useRef([]);
  const swipe = useRef(null);

  function select(i, { focus = false } = {}) {
    const next = Math.min(TABS.length - 1, Math.max(0, i));
    if (next !== index) {
      setParams(p => {
        const q = new URLSearchParams(p);
        if (next === 0) q.delete("tab");
        else q.set("tab", TABS[next].key);
        return q;
      }, { replace: true });
    }
    if (focus) tabRefs.current[next]?.focus();
  }

  function onTabKeyDown(e) {
    if (e.key === "ArrowRight") { e.preventDefault(); select(index + 1, { focus: true }); }
    if (e.key === "ArrowLeft") { e.preventDefault(); select(index - 1, { focus: true }); }
  }

  // Touch/pen swipe across the page body. Mostly-vertical drags are scrolls
  // and are ignored.
  function onPointerDown(e) {
    if (e.pointerType === "mouse") return;
    swipe.current = { x: e.clientX, y: e.clientY };
  }
  function onPointerUp(e) {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
      select(dx < 0 ? index + 1 : index - 1);
    }
  }

  return (
    <div className={styles.socialPage}>
      <div
        className={styles.tabSwitch}
        role="tablist"
        aria-label="Social"
        style={{ "--tab-index": index, "--tab-count": TABS.length }}
      >
        <span className={styles.tabThumb} aria-hidden="true" />
        {TABS.map((t, i) => (
          <button
            key={t.key}
            ref={el => (tabRefs.current[i] = el)}
            type="button"
            role="tab"
            id={`social-tab-${t.key}`}
            aria-selected={i === index}
            aria-controls={`social-panel-${t.key}`}
            tabIndex={i === index ? 0 : -1}
            className={`${styles.tabBtn} ${i === index ? styles.tabBtnActive : ""}`}
            onClick={() => select(i)}
            onKeyDown={onTabKeyDown}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        className={styles.tabViewport}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (swipe.current = null)}
      >
        <div className={styles.tabTrack} style={{ "--tab-index": index }}>
          {TABS.map((t, i) => (
            <section
              key={t.key}
              id={`social-panel-${t.key}`}
              role="tabpanel"
              aria-labelledby={`social-tab-${t.key}`}
              className={`${styles.tabPane} ${i === index ? styles.tabPaneActive : ""}`}
              inert={i !== index || undefined}
            >
              {t.key === "squad" ? <SquadPanel /> : <FeedPanel />}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

export default Social;
