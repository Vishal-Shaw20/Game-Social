import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import { Dashes } from "../ScrollPager";
import { gameArt } from "../../utils/gameArt";
import { useAutoAdvance } from "../../hooks/useAutoAdvance";
import styles from "./GamePanels.module.css";

/* Trailers first, then screenshots, in one viewer with a thumbnail strip.
   Steam serves trailers as HLS streams. Safari plays those natively;
   elsewhere hls.js is loaded from jsDelivr the first time someone presses
   play, so it costs nothing for people who never watch one. */

const HLS_SRC = "https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js";
let hlsLoader = null;

function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  hlsLoader ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = HLS_SRC;
    s.async = true;
    s.onload = () => (window.Hls ? resolve(window.Hls) : reject(new Error("hls.js missing")));
    s.onerror = () => {
      hlsLoader = null;
      reject(new Error("hls.js failed to load"));
    };
    document.head.appendChild(s);
  });
  return hlsLoader;
}

function Trailer({ trailer, autoPlay, steamUrl }) {
  const ref = useRef(null);
  // Nothing playable at all (no stream, no mp4): show the Steam link straight away.
  const [failed, setFailed] = useState(() => !trailer.mp4 && !trailer.hls);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let hls = null;
    let cancelled = false;

    if (trailer.mp4) {
      video.src = trailer.mp4;
    } else if (trailer.hls && video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = trailer.hls;
    } else if (trailer.hls) {
      loadHls()
        .then((Hls) => {
          if (cancelled) return;
          if (!Hls.isSupported()) return setFailed(true);
          hls = new Hls({ capLevelToPlayerSize: true });
          hls.on(Hls.Events.ERROR, (_, data) => data.fatal && setFailed(true));
          hls.loadSource(trailer.hls);
          hls.attachMedia(video);
        })
        .catch(() => !cancelled && setFailed(true));
    }

    return () => {
      cancelled = true;
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [trailer]); // a new trailer remounts this (keyed), so failed starts false

  if (failed) {
    return (
      <div className={styles.videoError}>
        <div>
          This trailer can't play here.
          {steamUrl && (
            <>
              {" "}
              <a className={styles.link} href={steamUrl} target="_blank" rel="noreferrer">Watch it on Steam</a>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <video
      ref={ref}
      controls
      autoPlay={autoPlay}
      playsInline
      poster={trailer.thumb}
      aria-label={trailer.name}
    />
  );
}

export default function GameMedia({ trailers = [], screenshots = [], steamUrl, name }) {
  const items = [
    ...trailers.map((t) => ({ kind: "video", thumb: t.thumb, trailer: t, key: `v${t.id}` })),
    // Sized copies, never the 2560px originals (see utils/gameArt.js): the
    // strip shows ~136px thumbs, the viewer ~900px. (1280 is kept free for
    // the homepage's WebGL textures.)
    ...screenshots.map((s, i) => ({
      kind: "image",
      thumb: gameArt(s.thumb || s.full, 420),
      full: gameArt(s.full, 1920),
      key: `s${i}`,
    })),
  ];
  const [index, setIndex] = useState(0);
  const [autoPlay, setAutoPlay] = useState(false);
  const thumbsRef = useRef(null);
  const panelRef = useRef(null);
  const count = items.length;
  const shownIndex = Math.min(index, Math.max(0, count - 1));
  const go = (d) => {
    setAutoPlay(false);
    setIndex((i) => (i + d + count) % count);
  };
  // Like the homepage's Trending carousel (hooks/useAutoAdvance.js), through
  // the screenshots; it holds still on a trailer.
  const { bind, swipe } = useAutoAdvance({
    rootRef: panelRef,
    index: shownIndex,
    count,
    onStep: go,
    canAdvance: items[shownIndex]?.kind === "image",
  });

  // Keep the active thumb in view by scrolling the strip only. scrollIntoView
  // would also scroll the page to it, which jumped the game page down
  // right after it opened.
  useEffect(() => {
    const strip = thumbsRef.current;
    const el = strip?.children[index];
    if (!el) return;
    const s = strip.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.left < s.left) strip.scrollLeft += r.left - s.left;
    else if (r.right > s.right) strip.scrollLeft += r.right - s.right;
  }, [index]);

  if (!items.length) return null;
  const cur = items[shownIndex];

  return (
    <section ref={panelRef} className={styles.panel} {...bind}>
      <h2 className={styles.title}>
        Media
        <span className={styles.titleSub}>
          {[trailers.length && `${trailers.length} trailer${trailers.length > 1 ? "s" : ""}`,
            screenshots.length && `${screenshots.length} screenshots`].filter(Boolean).join(" · ")}
        </span>
      </h2>

      <div className={styles.viewer} {...swipe}>
        {cur.kind === "video" ? (
          <Trailer key={cur.key} trailer={cur.trailer} autoPlay={autoPlay} steamUrl={steamUrl} />
        ) : (
          <img src={cur.full} alt={`${name} screenshot`} />
        )}
        {items.length > 1 && (
          <>
            <button className={`${styles.viewerNav} ${styles.viewerPrev}`} onClick={() => go(-1)} aria-label="Previous">
              <ChevronLeft size={22} />
            </button>
            <button className={`${styles.viewerNav} ${styles.viewerNext}`} onClick={() => go(1)} aria-label="Next">
              <ChevronRight size={22} />
            </button>
          </>
        )}
      </div>

      {items.length > 1 && (
        <div className={styles.thumbs} ref={thumbsRef}>
          {items.map((it, i) => (
            <button
              key={it.key}
              className={`${styles.thumb} ${i === index ? styles.thumbActive : ""}`}
              onClick={() => {
                setAutoPlay(it.kind === "video");
                setIndex(i);
              }}
              title={it.trailer?.name}
            >
              <img src={it.thumb} alt="" loading="lazy" />
              {it.kind === "video" && (
                <span className={styles.playGlyph}><Play size={22} fill="currentColor" /></span>
              )}
            </button>
          ))}
        </div>
      )}

      <Dashes
        count={items.length}
        active={index}
        onSelect={(i) => {
          setAutoPlay(false);
          setIndex(i);
        }}
        label={(i) => (items[i].kind === "video" ? `Trailer: ${items[i].trailer.name}` : `Screenshot ${i + 1 - trailers.length}`)}
        style={{ marginTop: 12 }}
      />
    </section>
  );
}
