import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Newspaper } from "lucide-react";
import { API, date, timeAgo } from "./format";
import ScrollRail from "./ScrollRail";
import rail from "./ScrollRail.module.css";
import styles from "./GamePanels.module.css";

/*
 * The game's Steam news, in the panels' language (GamePanels.module.css):
 * tabs for the developer's updates, its patch notes and the press (the
 * backend splits and filters them, see steamNewsTab), read here on the page:
 * the posts in order, one open at a time (the newest to start); clicking
 * another grows it open where it is (its image widens, its whole text slides
 * out beside it, scrolling within the image's height) while the open one
 * folds back into a row. Pages of older posts below.
 * Posts newer than your last visit get a dot (remembered in this browser).
 */
const TABS = [["updates", "Updates"], ["patches", "Patch notes"], ["press", "Press"]];

const seenKey = (gameId) => `gs.newsSeen.${gameId}`;
function readSeen(gameId) {
  try {
    return Number(localStorage.getItem(seenKey(gameId))) || 0;
  } catch {
    return 0;
  }
}

// Which page numbers to show: the first, the last, and the ones either side
// of the current page, with null for a gap ("…"): 1 … 12 13 14.
function pageWindow(count, current) {
  const shown = [...new Set([0, current - 1, current, current + 1, count - 1])]
    .filter((i) => i >= 0 && i < count)
    .sort((a, b) => a - b);
  const out = [];
  shown.forEach((i, k) => {
    if (k > 0 && i - shown[k - 1] > 1) out.push(null);
    out.push(i);
  });
  return out;
}

// "3 days ago" for the last month, the date after that.
const when = (d) => (d && Date.now() - d < 30 * 864e5 ? timeAgo(d) : date(d));

export default function GameNews({ news, gameId }) {
  // Per tab: the pages loaded so far, and whether older posts exist.
  const [feeds, setFeeds] = useState(() =>
    Object.fromEntries(TABS.map(([k]) => [k, { pages: news?.[k]?.items.length ? [news[k].items] : [], more: Boolean(news?.[k]?.more) }]))
  );
  const [picked, setPicked] = useState(null); // tab
  const [pageOf, setPageOf] = useState({}); // tab -> page index
  const [openId, setOpenId] = useState(null); // the post open up top
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // When you last saw this game's news; fixed for this visit.
  const [lastSeen] = useState(() => readSeen(gameId));

  // Everything shown now counts as seen next time.
  useEffect(() => {
    const newest = Math.max(0, ...TABS.flatMap(([k]) => news?.[k]?.items.map((n) => n.date ?? 0) ?? []));
    if (!newest) return;
    try {
      localStorage.setItem(seenKey(gameId), String(Math.max(newest, readSeen(gameId))));
    } catch {
      /* not remembered: no dots next time */
    }
  }, [news, gameId]);

  const tabs = TABS.filter(([k]) => feeds[k].pages.length);
  if (!tabs.length) return null;
  const tab = tabs.some(([k]) => k === picked) ? picked : tabs[0][0];
  const { pages, more } = feeds[tab];
  const page = Math.min(pageOf[tab] ?? 0, pages.length - 1);
  const items = pages[page];
  const open = items.find((n) => n.id === openId) ?? items[0];
  const isNew = (n) => lastSeen > 0 && n.date > lastSeen;
  const onLastPage = page === pages.length - 1;

  const goTo = async (to) => {
    setError(null);
    setOpenId(null);
    if (to < pages.length) return setPageOf((p) => ({ ...p, [tab]: to }));
    // The next page isn't loaded yet: ask for the posts older than this one.
    const last = pages[pages.length - 1].at(-1);
    if (!last?.date || loading) return;
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/gamepage/${gameId}/news?tab=${tab}&before=${last.date}`);
      if (!r.ok) throw new Error();
      const next = await r.json();
      const seen = new Set(pages.flat().map((n) => n.id));
      const fresh = next.items.filter((n) => !seen.has(n.id));
      setFeeds((f) => ({
        ...f,
        [tab]: { pages: fresh.length ? [...f[tab].pages, fresh] : f[tab].pages, more: fresh.length ? next.more : false },
      }));
      if (fresh.length) setPageOf((p) => ({ ...p, [tab]: to }));
    } catch {
      setError("Couldn't load older news. Try again in a moment.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className={styles.panel}>
      <h2 className={styles.title}>News &amp; updates</h2>

      {tabs.length > 1 && (
        <div className={styles.newsTabs} role="tablist" aria-label="News">
          {tabs.map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={k === tab}
              className={`${styles.newsTab} ${k === tab ? styles.newsTabOn : ""}`}
              onClick={() => { setPicked(k); setOpenId(null); setError(null); }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className={styles.newsItems}>
        {items.map((n) => (
          <NewsItem key={n.id} n={n} isOpen={n === open} isNew={isNew(n)} onOpen={() => setOpenId(n.id)} />
        ))}
      </div>

      {(pages.length > 1 || more || error) && (
        <nav className={styles.newsPager} aria-label="News pages">
          {error && <span className={styles.newsError}>{error}</span>}
          <button
            type="button"
            className={styles.pageBtn}
            onClick={() => goTo(page - 1)}
            disabled={page === 0 || loading}
            aria-label="Newer posts"
          >
            <ChevronLeft size={16} />
          </button>
          {pageWindow(pages.length, page).map((i, k) =>
            i === null ? (
              <span key={`gap${k}`} className={styles.pageGap} aria-hidden="true">…</span>
            ) : (
              <button
                key={i}
                type="button"
                className={`${styles.pageBtn} ${i === page ? styles.pageBtnOn : ""}`}
                onClick={() => goTo(i)}
                aria-current={i === page ? "page" : undefined}
                aria-label={`Page ${i + 1}`}
              >
                {i + 1}
              </button>
            )
          )}
          {/* Paging through what's loaded: an arrow. On the last loaded page,
              with older posts still on Steam: "Load more" fetches the next. */}
          {!onLastPage ? (
            <button
              type="button"
              className={styles.pageBtn}
              onClick={() => goTo(page + 1)}
              disabled={loading}
              aria-label="Older posts"
            >
              <ChevronRight size={16} />
            </button>
          ) : more ? (
            <button type="button" className={styles.loadMore} onClick={() => goTo(page + 1)} disabled={loading}>
              {loading ? <><Loader2 size={14} className={styles.spin} /> Loading…</> : <>Load more <ChevronRight size={14} /></>}
            </button>
          ) : null}
        </nav>
      )}
    </section>
  );
}

/*
 * One post: a row, or open (the image large, the whole text beside it in a
 * box as tall as the image, scrolling with the page's scrollbar).
 */
function NewsItem({ n, isOpen, isNew, onOpen }) {
  const textRef = useRef(null);
  return (
    <article
      className={`${styles.newsItem} ${isOpen ? styles.newsItemOpen : ""}`}
      role={isOpen ? undefined : "button"}
      tabIndex={isOpen ? undefined : 0}
      aria-expanded={isOpen}
      onClick={isOpen ? undefined : onOpen}
      onKeyDown={isOpen ? undefined : (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); }
      }}
    >
      <NewsImage src={n.image} className={styles.newsArt} />
      <div className={styles.newsBody}>
        <h3 className={styles.newsItemTitle}>{n.title}</h3>
        <NewsMeta n={n} isNew={isNew} />
        {/* slides open with the post; its row grows from nothing */}
        <div className={styles.newsReveal} aria-hidden={!isOpen}>
          <div className={styles.newsTextBox}>
            <div ref={textRef} className={`${styles.newsText} ${rail.scroller}`} tabIndex={isOpen ? 0 : -1}>
              {n.body ?? n.excerpt}
            </div>
            {isOpen && <ScrollRail targetRef={textRef} className={styles.newsRail} />}
          </div>
        </div>
      </div>
    </article>
  );
}

/** Official / Patch notes / the outlet, when, and a dot if it's new. */
function NewsMeta({ n, isNew }) {
  return (
    <div className={styles.newsMeta}>
      {isNew && <span className={styles.newDot} title="New since your last visit" aria-label="New" />}
      {n.patch ? (
        <span className={styles.newsBadge}>Patch notes</span>
      ) : n.official ? (
        <span className={styles.newsBadge}>Official</span>
      ) : (
        n.source && <span className={styles.newsSource}>{n.source}</span>
      )}
      <time dateTime={n.date ? new Date(n.date).toISOString() : undefined} title={date(n.date) ?? undefined}>
        {when(n.date)}
      </time>
    </div>
  );
}

/** A post's image; a quiet placeholder when it has none or it won't load. */
function NewsImage({ src, className }) {
  const [failed, setFailed] = useState(null);
  const ok = src && failed !== src;
  return (
    <div className={`${className} ${ok ? "" : styles.newsArtEmpty}`} aria-hidden="true">
      {ok ? (
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(src)} />
      ) : (
        <Newspaper size={22} />
      )}
    </div>
  );
}
