import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ArrowRight, X } from "lucide-react";
import { useArtTint } from "../../hooks/useArtTint";
import { gameArt } from "../../utils/gameArt";
import { API, VERDICT_META, compact, date, timeAgo } from "../game/format";
import ScrollRail from "../game/ScrollRail";
import rail from "../game/ScrollRail.module.css";
import Select from "../Select";
import { SHELVES, NUDGE_HOURS, hoursText } from "../library/libraryData";
import styles from "./QuickLook.module.css";

const SHELF_OPTIONS = [["", "No shelf"], ...SHELVES];
const when = (d) => (d && Date.now() - d < 30 * 864e5 ? timeAgo(d) : date(d));
const plain = (html) => (html ? new DOMParser().parseFromString(html, "text/html").body.textContent.trim() : "");
const nameOf = (x) => (typeof x === "string" ? x : x?.name) ?? null;
// Long text cut near `max`: at a sentence's end if there's one late enough,
// else at a word, with an ellipsis.
function clip(text, max = 420) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (stop > max * 0.5) return cut.slice(0, stop + 1);
  return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:\s]+$/, "")}…`;
}

// One game's data, fetched when `id` changes; { id, value } so a stale
// answer (for the game before) is never shown.
function useFetched(id, url, skip = false) {
  const [got, setGot] = useState({ id: null, value: null });
  useEffect(() => {
    if (skip) return;
    let cancelled = false;
    fetch(url, { credentials: "include" })
      .then((r) => (r.status === 401 ? { signedOut: true } : r.ok ? r.json() : null))
      .then((value) => !cancelled && setGot({ id, value }))
      .catch(() => !cancelled && setGot({ id, value: null }));
    return () => { cancelled = true; };
  }, [id, url, skip]);
  return { ready: got.id === id, value: got.id === id ? got.value : null };
}

/*
 * A game at a glance, anywhere in the app (QuickLookProvider): a drawer from
 * the right in the game's colour with its art, your side of it (hours, last
 * two weeks, achievements, shelf, verdict), friends who own it, what it's
 * about, screenshots and its latest news, and the way on to the full game
 * page. Public details: /api/gamepage/:id (the game page's own, cached, so
 * opening the page after is quick); yours: /:id/me, unless the caller
 * already has them (the Library); friends: /:id/community.
 *
 * Escape, the ✕ or a click on the dimmed page closes it; ← / → step through
 * the row or grid it was opened from. Focus goes to the drawer and back to
 * where it was when it closes.
 */
export default function QuickLook({ seed, onClose, onStep, onShelf }) {
  const navigate = useNavigate();
  const closeRef = useRef(null);
  const bodyRef = useRef(null);
  const id = seed.rawgId;

  const info = useFetched(id, `${API}/api/gamepage/${id}`);
  const meFetched = useFetched(id, `${API}/api/gamepage/${id}/me`, Boolean(seed.mine));
  const community = useFetched(id, `${API}/api/gamepage/${id}/community`);
  const d = info.value;
  const me = seed.mine ?? meFetched.value;
  const meReady = Boolean(seed.mine) || meFetched.ready;

  // Shelf changes made here, per game, over what was loaded.
  const [shelves, setShelves] = useState({});

  const cover = seed.cover || d?.images?.hero || null;
  const tint = useArtTint(cover ? [cover] : []);

  // Focus in, and back out to where it was on close.
  useEffect(() => {
    const before = document.activeElement;
    closeRef.current?.focus();
    return () => before?.focus?.();
  }, []);

  // A new game: back to the top.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [id]);

  useEffect(() => {
    const key = (e) => {
      if (e.key === "Escape") onClose();
      else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.target.closest?.("input, textarea")) {
        e.preventDefault();
        onStep(e.key === "ArrowLeft" ? -1 : 1);
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose, onStep]);

  const openPage = () => {
    onClose();
    navigate(`/game/${id}`);
  };

  const name = seed.name || d?.name || "…";
  const genres = seed.genres.length ? seed.genres : (d?.genres ?? []).map(nameOf).filter(Boolean);
  const released = seed.released || d?.released;
  const year = released ? new Date(released).getUTCFullYear() : null;
  const dev = nameOf(d?.developers?.[0]);
  const about = d ? clip(plain(d.shortDescription) || plain(d.description)) : "";
  const shots = (d?.screenshots ?? []).slice(0, 6);
  const news = d?.news
    ? [...(d.news.updates?.items ?? []), ...(d.news.patches?.items ?? []), ...(d.news.press?.items ?? [])]
        .filter((n, i, all) => all.findIndex((m) => m.title === n.title) === i)
        .sort((x, y) => (y.date ?? 0) - (x.date ?? 0))
        .slice(0, 3)
    : [];
  const playing = d?.players?.now;

  // Your side: the caller's (Library) or /me's, in one shape.
  const signedIn = meReady && me && !me.signedOut;
  const owned = Boolean(me?.owned);
  const hours = me?.hours ?? me?.playtimeHours ?? 0;
  const recent = me?.recent ?? me?.playtime2WeeksHours ?? 0;
  const a = me?.achievements;
  const appid = me?.appid ?? null;
  const shelf = id in shelves ? shelves[id] : me?.shelf ?? null;
  const v = me?.verdict ? VERDICT_META[me.verdict] : null;
  const friends = community.value?.friends
    ? community.value.friends.filter((f) => f.owns)
    : seed.owners ?? [];

  // The page's own shelf handling when it has one (the Library keeps its
  // grid in step), else straight to the API; undone if it doesn't save.
  const changeShelf = async (status) => {
    const before = shelf;
    setShelves((s) => ({ ...s, [id]: status }));
    try {
      if (onShelf) {
        if ((await onShelf(appid, status)) === false) throw new Error();
      } else {
        const r = await fetch(`${API}/api/library/shelves/${appid}`, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        if (!r.ok) throw new Error();
      }
    } catch {
      setShelves((s) => ({ ...s, [id]: before }));
    }
  };

  return createPortal(
    <>
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      <aside
        className={styles.drawer}
        style={tint ? { "--tint": tint } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={`${name}, quick look`}
      >
        <button ref={closeRef} type="button" className={styles.close} onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>

        <div className={styles.bodyWrap}>
          <div ref={bodyRef} className={`${styles.body} ${rail.scroller}`}>
            <div className={styles.art}>
              {cover && <img src={gameArt(cover, 1280)} alt="" />}
              {v && <span className={styles.verdict} style={{ "--v": v.color }}>{v.label}</span>}
            </div>

            <div className={styles.main}>
              <header>
                <h2 className={styles.title}>{name}</h2>
                {(year || dev) && <p className={styles.meta}>{[year, dev].filter(Boolean).join(" · ")}</p>}
                {genres.length > 0 && (
                  <div className={styles.chips}>
                    {genres.slice(0, 4).map((x) => <span key={x} className={styles.chip}>{x}</span>)}
                  </div>
                )}
              </header>

              {!meReady ? (
                <div className={styles.skeleton} aria-label="Loading"><span /><span /></div>
              ) : signedIn && owned ? (
                <>
                  <section>
                    <p className={styles.label}>You</p>
                    <dl className={styles.stats}>
                      <div className={`${styles.stat} ${styles.statAccent}`}>
                        <dt>Played</dt>
                        <dd>{hoursText(hours)}</dd>
                      </div>
                      <div className={styles.stat}>
                        <dt>Last 2 weeks</dt>
                        <dd>{recent > 0 ? hoursText(recent) : "–"}</dd>
                      </div>
                      <div className={styles.stat}>
                        <dt>
                          Achievements
                          {a?.total > 0 && <span className={styles.achBar}><span style={{ width: `${(a.unlocked / a.total) * 100}%` }} /></span>}
                        </dt>
                        <dd>{a?.total > 0 ? `${a.unlocked}/${a.total}` : "–"}</dd>
                      </div>
                    </dl>
                  </section>

                  <div className={styles.actions}>
                    {appid && (
                      <>
                        <span className={styles.actionsLabel}>Shelf</span>
                        <Select
                          ariaLabel={`Shelf for ${name}`}
                          value={shelf ?? ""}
                          options={SHELF_OPTIONS}
                          onChange={(s) => changeShelf(s || null)}
                        />
                      </>
                    )}
                    <span className={styles.gap} />
                    {v ? (
                      <span className={styles.yourVerdict} style={{ "--v": v.color }}>Your verdict: <b>{v.label}</b></span>
                    ) : hours >= NUDGE_HOURS ? (
                      <button type="button" className={styles.review} onClick={openPage}>Leave a verdict</button>
                    ) : null}
                  </div>
                </>
              ) : signedIn ? (
                <p className={styles.notOwned}>
                  {v ? <>Not in your Steam library · Your verdict: <b style={{ color: v.color }}>{v.label}</b></> : "Not in your Steam library."}
                </p>
              ) : null}

              {friends.length > 0 && (
                <section>
                  <p className={styles.label}>Friends who own it</p>
                  <div className={styles.friends}>
                    {friends.map((f) => (
                      <span key={f.id} className={styles.friend} title={f.hours ? `${f.name}: ${hoursText(f.hours)}` : f.name}>
                        <span className={styles.avatarWrap}>
                          {f.avatar ? (
                            <img className={styles.avatar} src={f.avatar} alt="" />
                          ) : (
                            <span className={styles.avatar}>{f.name.charAt(0).toUpperCase()}</span>
                          )}
                          {f.status && f.status !== "offline" && <span className={styles.online} aria-label="online" />}
                        </span>
                        {f.name}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              <section>
                <p className={styles.label}>About</p>
                {!info.ready ? (
                  <div className={styles.skeleton} aria-label="Loading"><span /><span /><span /></div>
                ) : about ? (
                  <p className={styles.about}>{about}</p>
                ) : (
                  <p className={styles.muted}>No description yet.</p>
                )}
              </section>

              {shots.length > 0 && (
                <section>
                  <p className={styles.label}>Screenshots</p>
                  <div className={styles.shots}>
                    {shots.map((s, i) => <img key={i} src={gameArt(s.thumb || s.full, 640)} alt="" loading="lazy" />)}
                  </div>
                </section>
              )}

              {news.length > 0 && (
                <section>
                  <p className={styles.label}>Latest news</p>
                  <ul className={styles.news}>
                    {news.map((n) => (
                      <li key={n.title}>
                        <button type="button" className={styles.newsItem} onClick={openPage}>
                          {n.image ? <img className={styles.newsThumb} src={n.image} alt="" loading="lazy" /> : <span className={styles.newsThumb} />}
                          <span className={styles.newsText}>
                            <span className={styles.newsTitle} title={n.title}>{n.title}</span>
                            <span className={styles.newsWhen}>{when(n.date)}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </div>
          <ScrollRail targetRef={bodyRef} watch={`${id}:${info.ready}:${meReady}`} style={{ right: 6, top: 8, bottom: 8 }} />
        </div>

        <footer className={styles.foot}>
          {playing > 0 && (
            <span className={styles.playing}>
              <span className={styles.liveDot} aria-hidden="true" />
              <b>{compact(playing)}</b> playing on Steam now
            </span>
          )}
          <button type="button" className={styles.openBtn} onClick={openPage}>
            Open game page <ArrowRight size={15} />
          </button>
        </footer>
      </aside>
    </>,
    document.body
  );
}
