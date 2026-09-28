import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Crown, Sparkles, Meh, ThumbsDown, Heart, MessageCircle, Trash2, Clock, CheckCircle,
} from "lucide-react";
import ReviewComments from "../ReviewComments";
import ScrollRail from "./ScrollRail";
import rail from "./ScrollRail.module.css";
import { tagId, tagLabel } from "../../shared/reviewTags";
import { API, VERDICT_META, timeAgo } from "./format";
import styles from "./ReviewFeed.module.css";

/*
 * The reviews side of the game dock's modal: a single-column feed in the
 * dock's visual language (dark glass, verdict colours, green/red tags).
 *
 *   left     the reviews
 *   right    an overview that also drives the list: a gauge of the verdict
 *            split (share of positive reviews in the middle), playtime and
 *            completion, verdict filters, sort, and the most used tags
 *            (click one to show only reviews that picked it)
 *   card     author, when, verdict; playtime / finished; the review (long
 *            ones clamp with "Read more"); tags; like + a collapsed comment
 *            thread; delete on your own (editing is in the dock)
 */

const ICONS = { perfection: Crown, almost_good: Sparkles, subpar: Meh, awful_fun: ThumbsDown };
const ORDER = ["perfection", "almost_good", "subpar", "awful_fun"];
const SORTS = [
  ["new", "Newest"],
  ["liked", "Most liked"],
  ["played", "Most played"],
];
const CLAMP_AT = 320; // characters before "Read more"

const authorOf = (r) => (r.userId && typeof r.userId === "object" ? r.userId : {});
function avatarOf(u) {
  return u.profilePicture || u.linkedAccounts?.find((a) => a.avatar)?.avatar || null;
}

export default function ReviewFeed({ reviews, setReviews, currentUserId, currentUser }) {
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("new");
  const [tagFilter, setTagFilter] = useState(null); // { id, side }
  const mainRef = useRef(null);
  const sideRef = useRef(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const [threads, setThreads] = useState(() => new Set());
  const [error, setError] = useState(null);

  const counts = useMemo(() => {
    const c = Object.fromEntries(ORDER.map((k) => [k, 0]));
    for (const r of reviews) if (c[r.verdict] !== undefined) c[r.verdict] += 1;
    return c;
  }, [reviews]);

  // Tag use across all reviews (old text tags counted under their ids).
  const tagStats = useMemo(() => {
    const tally = (side) => {
      const m = new Map();
      for (const r of reviews) {
        for (const v of r[side] ?? []) {
          const id = tagId(v, side);
          if (id) m.set(id, (m.get(id) ?? 0) + 1);
        }
      }
      return [...m].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, n]) => ({ id, n }));
    };
    return { pros: tally("pros"), cons: tally("cons") };
  }, [reviews]);

  const hasTag = (r, { id, side }) => (r[side] ?? []).some((v) => tagId(v, side) === id);

  const shown = useMemo(() => {
    let list = filter === "all" ? [...reviews] : reviews.filter((r) => r.verdict === filter);
    if (tagFilter) list = list.filter((r) => hasTag(r, tagFilter));
    const by = {
      new: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
      liked: (a, b) => (b.likes?.length ?? 0) - (a.likes?.length ?? 0),
      played: (a, b) => (b.playtimeHours ?? 0) - (a.playtimeHours ?? 0),
    }[sort];
    return list.sort(by);
  }, [reviews, filter, sort, tagFilter]);

  const toggleIn = (setter, id) =>
    setter((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const isMine = (r) => String(authorOf(r)._id ?? r.userId) === String(currentUserId);
  const likedByMe = (r) => currentUserId && (r.likes ?? []).some((id) => String(id) === String(currentUserId));

  async function toggleLike(r) {
    if (!currentUserId) return setError("Log in to like reviews.");
    const liked = likedByMe(r);
    const res = await fetch(`${API}/api/reviews/${r._id}/${liked ? "unlike" : "like"}`, {
      method: "POST",
      credentials: "include",
    }).catch(() => null);
    if (!res?.ok) return setError("Couldn't update the like. Try again.");
    setError(null);
    setReviews((prev) =>
      prev.map((x) =>
        x._id === r._id
          ? { ...x, likes: liked ? x.likes.filter((id) => String(id) !== String(currentUserId)) : [...(x.likes ?? []), currentUserId] }
          : x
      )
    );
  }

  async function remove(r) {
    if (!window.confirm("Delete your review? Its comments go with it.")) return;
    const res = await fetch(`${API}/api/reviews/${r._id}`, { method: "DELETE", credentials: "include" }).catch(() => null);
    if (!res?.ok) return setError("Couldn't delete the review. Try again.");
    setError(null);
    setReviews((prev) => prev.filter((x) => x._id !== r._id));
  }

  const total = reviews.length;
  // The scrollbars and accent bits follow the verdict filter picked here (the warm accent for All).
  const feedAccent = VERDICT_META[filter]?.color ?? "#d4956e";
  const railStyle = { "--accent": feedAccent };
  // Your own new review comes back from the server without its author filled in.
  const author = (r) => {
    const u = authorOf(r);
    return !u._id && String(r.userId) === String(currentUserId) && currentUser ? currentUser : u;
  };

  return (
    <div className={styles.layout} style={{ "--feed-accent": feedAccent }}>
      {/* Each column scrolls on its own, with the dock's scrollbar. */}
      <aside className={styles.side}>
       <div ref={sideRef} className={`${styles.scroller} ${rail.scroller}`}>
        <section className={styles.panel}>
          <Gauge counts={counts} total={total} selected={filter === "all" ? null : filter} />
        </section>

        <section className={styles.panel}>
          <div className={styles.filters} role="radiogroup" aria-label="Filter by verdict">
            <button
              type="button"
              role="radio"
              aria-checked={filter === "all"}
              className={`${styles.chip} ${filter === "all" ? styles.chipOn : ""}`}
              style={{ "--c": "#d4956e" }}
              onClick={() => setFilter("all")}
            >
              All <span className={styles.chipCount}>{total}</span>
            </button>
            {ORDER.map((k) => {
              const Icon = ICONS[k];
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={filter === k}
                  disabled={!counts[k]}
                  className={`${styles.chip} ${filter === k ? styles.chipOn : ""}`}
                  style={{ "--c": VERDICT_META[k].color, "--share": total ? `${(counts[k] / total) * 100}%` : "0%" }}
                  onClick={() => setFilter(filter === k ? "all" : k)}
                >
                  <Icon size={14} /> {VERDICT_META[k].label}
                  <span className={styles.chipCount}>{counts[k]}</span>
                </button>
              );
            })}
          </div>

          <div
            className={styles.sort}
            role="radiogroup"
            aria-label="Sort reviews"
            style={{ "--s": SORTS.findIndex(([k]) => k === sort), "--n": SORTS.length }}
          >
            <span className={styles.sortBar} aria-hidden="true" />
            {SORTS.map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={sort === k}
                className={`${styles.sortBtn} ${sort === k ? styles.sortOn : ""}`}
                onClick={() => setSort(k)}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        {(tagStats.pros.length > 0 || tagStats.cons.length > 0) && (
          <section className={styles.panel}>
            {[["pros", "What worked", styles.pro], ["cons", "What didn't", styles.con]].map(([side, label, cls]) =>
              tagStats[side].length ? (
                <div key={side} className={styles.tagGroup}>
                  <div className={styles.tagGroupLabel}>{label}</div>
                  <div className={styles.tags}>
                    {tagStats[side].map(({ id, n }) => {
                      const on = tagFilter?.id === id && tagFilter?.side === side;
                      return (
                        <button
                          key={id}
                          type="button"
                          className={`${styles.tag} ${styles.tagBtn} ${cls} ${on ? styles.tagOn : ""}`}
                          aria-pressed={on}
                          onClick={() => setTagFilter(on ? null : { id, side })}
                          title={on ? "Show all reviews" : "Show only reviews with this tag"}
                        >
                          {tagLabel(id, side)} <span className={styles.tagN}>{n}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null
            )}
          </section>
        )}
       </div>
       <ScrollRail style={railStyle} targetRef={sideRef} watch={`${tagStats.pros.length}:${tagStats.cons.length}`} />
      </aside>

      <div className={styles.main}>
       <div ref={mainRef} className={`${styles.scroller} ${rail.scroller}`}>
      <header className={styles.head}>
        <h2 className={styles.title}>
          Community reviews <span className={styles.count}>{shown.length === total ? total : `${shown.length} of ${total}`}</span>
        </h2>
        {(filter !== "all" || tagFilter) && (
          <button type="button" className={styles.clearFilters} onClick={() => { setFilter("all"); setTagFilter(null); }}>
            Clear filters
          </button>
        )}
        {error && <p className={styles.error}>{error}</p>}
      </header>

      {shown.length === 0 && (
        <p className={styles.empty}>
          {total ? "No reviews match these filters." : "No reviews yet. Be the first — the form is right below."}
        </p>
      )}

      <ol className={styles.list}>
        {shown.map((r) => {
          const u = author(r);
          const name = u.displayName || u.username || "Player";
          const avatar = avatarOf(u);
          const V = VERDICT_META[r.verdict] ?? { label: r.verdict, color: "#8b949e" };
          const Icon = ICONS[r.verdict] ?? Meh;
          const long = (r.body ?? "").length > CLAMP_AT;
          const open = expanded.has(r._id);
          const mine = isMine(r);
          const liked = likedByMe(r);
          const threadOpen = threads.has(r._id);

          return (
            <li key={r._id} className={styles.card} style={{ "--c": V.color }}>
              <div className={styles.cardHead}>
                {u.username ? (
                  <Link to={`/u/${u.username}`} className={styles.author}>
                    <Avatar src={avatar} name={name} />
                    <span className={styles.name}>{name}</span>
                  </Link>
                ) : (
                  <span className={styles.author}>
                    <Avatar src={avatar} name={name} />
                    <span className={styles.name}>{name}</span>
                  </span>
                )}
                <span className={styles.when} title={new Date(r.createdAt).toLocaleString()}>
                  {timeAgo(r.createdAt)}
                  {r.edited && " · edited"}
                </span>

                <span className={styles.verdict}>
                  <Icon size={15} /> {V.label}
                </span>
                {mine && (
                  <span className={styles.ownActions}>
                    <button type="button" className={`${styles.iconBtn} ${styles.danger}`} onClick={() => remove(r)} title="Delete your review" aria-label="Delete your review">
                      <Trash2 size={15} />
                    </button>
                  </span>
                )}
              </div>

              {(r.playtimeHours != null || r.completed) && (
                <div className={styles.meta}>
                  {r.playtimeHours != null && (
                    <span><Clock size={13} /> {r.playtimeHours} h played</span>
                  )}
                  {r.completed && (
                    <span><CheckCircle size={13} /> Finished</span>
                  )}
                </div>
              )}

              {r.title && <h3 className={styles.reviewTitle}>{r.title}</h3>}
              {r.body && (
                <>
                  <p className={`${styles.body} ${long && !open ? styles.clamped : ""}`}>{r.body}</p>
                  {long && (
                    <button type="button" className={styles.more} onClick={() => toggleIn(setExpanded, r._id)}>
                      {open ? "Show less" : "Read more"}
                    </button>
                  )}
                </>
              )}

              {(r.pros?.length > 0 || r.cons?.length > 0) && (
                <div className={styles.tags}>
                  {(r.pros ?? []).map((t) => (
                    <span key={`p${t}`} className={`${styles.tag} ${styles.pro}`}>{tagLabel(t, "pros")}</span>
                  ))}
                  {(r.cons ?? []).map((t) => (
                    <span key={`c${t}`} className={`${styles.tag} ${styles.con}`}>{tagLabel(t, "cons")}</span>
                  ))}
                </div>
              )}

              <div className={styles.actions}>
                <button
                  type="button"
                  className={`${styles.pill} ${liked ? styles.liked : ""}`}
                  onClick={() => toggleLike(r)}
                  aria-pressed={Boolean(liked)}
                  title={liked ? "Unlike" : "Like"}
                >
                  <Heart size={15} fill={liked ? "currentColor" : "none"} /> {r.likes?.length ?? 0}
                </button>
                <button
                  type="button"
                  className={`${styles.pill} ${threadOpen ? styles.pillOn : ""}`}
                  onClick={() => toggleIn(setThreads, r._id)}
                  aria-expanded={threadOpen}
                >
                  <MessageCircle size={15} /> {r.commentCount ?? 0}
                  <span className={styles.pillText}>{threadOpen ? "Hide comments" : r.commentCount ? "Comments" : "Comment"}</span>
                </button>
              </div>

              {threadOpen && (
                <div className={styles.thread}>
                  <ReviewComments
                    reviewId={r._id}
                    currentUserId={currentUserId}
                    onCountChange={(n) =>
                      setReviews((prev) => prev.map((x) => (x._id === r._id ? { ...x, commentCount: n } : x)))
                    }
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>
       </div>
       <ScrollRail style={railStyle} targetRef={mainRef} watch={`${shown.length}:${expanded.size}:${threads.size}`} />
      </div>
    </div>
  );
}

/* Half-circle gauge of the verdict split, worst on the left to best on the
   right, with the share of positive reviews (Instant classic + Almost
   there) in the middle, in the colour of the most common verdict. */
/*
 * The verdict split as a half ring, worst (left) to best (right). Each
 * verdict is a block with softly rounded corners, a small gap between
 * neighbours. Hovering (or tabbing to) a block lifts it and dims the rest,
 * and the middle shows that verdict's share; otherwise it shows the share of
 * positive reviews.
 */
// R is the middle of the band, W its thickness: the outer edge sits at
// R + W/2 = 86 and the band grows inward from there. GAP/MIN in degrees.
const G = { CX: 100, CY: 96, R: 74, W: 24, GAP: 2.2, CORNER: 5, MIN: 4 };

// A point on a circle of radius r around the gauge centre, at `deg` along
// the half ring (0 = far left, 180 = far right).
function gaugePt(r, deg) {
  const a = (Math.PI * (180 - deg)) / 180;
  return [G.CX + r * Math.cos(a), G.CY - r * Math.sin(a)];
}

/** A ring sector from a0 to a1 (degrees) with rounded corners. */
function sectorPath(a0, a1) {
  const ro = G.R + G.W / 2;
  const ri = G.R - G.W / 2;
  const span = a1 - a0;
  // corner radius, never more than half the block's thickness or length
  const c = Math.min(G.CORNER, G.W / 2, ((span / 2) * Math.PI * ri) / 180);
  const dOut = (c / ro) * (180 / Math.PI);
  const dIn = (c / ri) * (180 / Math.PI);
  const f = (pt) => pt.map((v) => v.toFixed(2)).join(" ");
  return [
    `M ${f(gaugePt(ro - c, a0))}`,
    `Q ${f(gaugePt(ro, a0))} ${f(gaugePt(ro, a0 + dOut))}`,
    `A ${ro} ${ro} 0 0 1 ${f(gaugePt(ro, a1 - dOut))}`,
    `Q ${f(gaugePt(ro, a1))} ${f(gaugePt(ro - c, a1))}`,
    `L ${f(gaugePt(ri + c, a1))}`,
    `Q ${f(gaugePt(ri, a1))} ${f(gaugePt(ri, a1 - dIn))}`,
    `A ${ri} ${ri} 0 0 0 ${f(gaugePt(ri, a0 + dIn))}`,
    `Q ${f(gaugePt(ri, a0))} ${f(gaugePt(ri + c, a0))}`,
    "Z",
  ].join(" ");
}

function Gauge({ counts, total, selected = null }) {
  const [hover, setHover] = useState(null); // verdict key under the pointer
  const order = ["awful_fun", "subpar", "almost_good", "perfection"];
  const present = order.filter((k) => counts[k]);

  // Share of the ring (degrees), gaps taken out first. A tiny share still
  // gets a block big enough to see and hover; the biggest one pays for it.
  const usable = 180 - G.GAP * Math.max(0, present.length - 1);
  const spans = Object.fromEntries(present.map((k) => [k, (counts[k] / total) * usable]));
  if (present.length > 1) {
    const big = present.reduce((a, k) => (spans[k] > spans[a] ? k : a), present[0]);
    for (const k of present) {
      if (k !== big && spans[k] < G.MIN) {
        spans[big] -= G.MIN - spans[k];
        spans[k] = G.MIN;
      }
    }
  }
  const segs = [];
  let at = 0;
  for (const k of present) {
    segs.push({ k, d: sectorPath(at, at + spans[k]) });
    at += spans[k] + G.GAP;
  }

  // The middle shows one verdict: the hovered one, else the verdict picked
  // as the list's filter, else the most common (a tie goes to the better
  // verdict). Hovering or a picked filter lifts that block and dims the
  // others; with neither, they're all alike.
  const top = present.reduce((a, k) => (counts[k] >= counts[a] ? k : a), present[0]) ?? null;
  const focus = [hover, selected].find((k) => k && counts[k]) ?? null;
  const hovering = Boolean(focus);
  const shown = focus ?? top;
  const pct = total && shown ? Math.round((counts[shown] / total) * 100) : 0;
  const color = shown ? VERDICT_META[shown].color : "#6e7681";
  const positive = (counts.perfection ?? 0) + (counts.almost_good ?? 0);

  return (
    <figure className={`${styles.gauge} ${hovering ? styles.gaugeHovering : ""}`} onMouseLeave={() => setHover(null)}>
      <svg
        viewBox="0 0 200 110"
        role="img"
        aria-label={total ? `${Math.round((positive / total) * 100)}% of ${total} reviews are positive` : "No reviews yet"}
      >
        {!present.length && <path d={sectorPath(0, 180)} className={styles.gaugeTrack} />}
        {segs.map(({ k, d }) => (
          <path
            key={k}
            d={d}
            fill={VERDICT_META[k].color}
            className={`${styles.gaugeSeg} ${shown === k ? styles.gaugeSegOn : ""}`}
            style={{ "--c": VERDICT_META[k].color }}
            tabIndex={0}
            role="img"
            aria-label={`${VERDICT_META[k].label}: ${counts[k]} of ${total}`}
            onMouseEnter={() => setHover(k)}
            onFocus={() => setHover(k)}
            onBlur={() => setHover(null)}
          />
        ))}
      </svg>
      <figcaption className={styles.gaugeText}>
        <span className={styles.gaugePct} style={{ color }}>{shown ? pct : "—"}<small>%</small></span>
        <span className={styles.gaugeSub} style={shown ? { color } : undefined}>
          {shown ? `${counts[shown]}/${total} ${VERDICT_META[shown].label}` : "No reviews yet"}
        </span>
      </figcaption>
    </figure>
  );
}

function Avatar({ src, name }) {
  return src ? (
    <img className={styles.avatar} src={src} alt="" loading="lazy" />
  ) : (
    <span className={styles.avatar} aria-hidden="true">{(name[0] ?? "?").toUpperCase()}</span>
  );
}
