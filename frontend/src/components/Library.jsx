import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { useArtTint } from "../hooks/useArtTint";
import GameCarousel from "./GameCarousel";
import Select from "./Select";
import ScrollRail from "./game/ScrollRail";
import rail from "./game/ScrollRail.module.css";
import LibraryCard from "./library/LibraryCard";
import GenreStrip from "./library/LibraryOverview";
import LibraryHero from "./library/LibraryHero";
import { FindMatchDialog } from "./library/LibraryDialogs";
import { useQuickLook } from "./quicklook/quickLookContext";
import {
  SHELVES, FILTERS, SORTS, libraryItems, libraryStats, applyView, facets, hoursText,
} from "./library/libraryData";
import styles from "./Library.module.css";

const API = import.meta.env.VITE_API_URL;
const ROW = 12;

// Which rows the page shows, decided when the library loads (not live), so
// shelving a game doesn't slide a whole row in above the games box.
function rowKeysFor(json) {
  const games = json?.games ?? [];
  const matched = new Set(games.filter((g) => g.rawg?.id).map((g) => String(g.steam.appid)));
  const keys = [];
  if (games.some((g) => g.rawg?.id && g.steam.playtime2Weeks > 0)) keys.push("lately");
  if (Object.entries(json?.shelves ?? {}).some(([appid, s]) => s === "backlog" && matched.has(String(appid)))) keys.push("backlog");
  return keys;
}

// Matched games as the homepage's carousel reads them (one card per RAWG game).
function carouselGames(list) {
  const seen = new Set();
  return list
    .filter((g) => g.matched && !seen.has(g.rawgId) && seen.add(g.rawgId))
    .slice(0, ROW)
    .map((g) => ({
      id: g.rawgId,
      name: g.name,
      background_image: g.cover,
      released: g.released,
      genres: g.genres,
      platforms: g.platforms,
      metacritic: g.metacritic,
      rating: g.rating,
    }));
}

/*
 * The genre, platform and "show" filters, in one popover behind a button so
 * the header stays compact. Closes on a click outside or Escape.
 */
function FiltersMenu({ items, view, set, genres, platforms }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const active = (view.filter !== "all") + Boolean(view.genre) + Boolean(view.platform);

  useEffect(() => {
    if (!open) return;
    // (a dropdown's menu opened from here is on <body>, but still "inside")
    const down = (e) => !ref.current?.contains(e.target) && !e.target.closest?.("[data-select-menu]") && setOpen(false);
    const key = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <div className={styles.filterWrap} ref={ref}>
      <button
        type="button"
        className={`${styles.filterBtn} ${active ? styles.filterBtnOn : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <SlidersHorizontal size={14} />
        Filters{active > 0 && <span className={styles.filterCount}>{active}</span>}
      </button>
      {open && (
        <div className={styles.filterPop} role="dialog" aria-label="Filters">
          <p className={styles.subLabel}>Show</p>
          <div className={styles.chips}>
            {FILTERS.map(([k, label, keep]) => {
              const n = items.filter(keep).length;
              if (k !== "all" && !n) return null;
              return (
                <button
                  key={k}
                  type="button"
                  className={`${styles.chip} ${view.filter === k ? styles.chipOn : ""}`}
                  onClick={() => set({ filter: k })}
                  aria-pressed={view.filter === k}
                >
                  {label}{k !== "all" && <span className={styles.chipCount}>{n}</span>}
                </button>
              );
            })}
          </div>
          <div className={styles.filterSelects}>
            <div>
              <span className={styles.subLabel}>Genre</span>
              <Select
                full
                ariaLabel="Genre"
                value={view.genre}
                options={[["", "All genres"], ...genres.map((x) => [x, x])]}
                onChange={(genre) => set({ genre })}
              />
            </div>
            <div>
              <span className={styles.subLabel}>Platform</span>
              <Select
                full
                ariaLabel="Platform"
                value={view.platform}
                options={[["", "All platforms"], ...platforms.map((x) => [x, x])]}
                onChange={(platform) => set({ platform })}
              />
            </div>
          </div>
          {active > 0 && (
            <button type="button" className={styles.clearBtn} onClick={() => set({ filter: "all", genre: "", platform: "" })}>
              Clear filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/*
 * Your Steam library (/api/library), in the homepage's language: a hero of
 * your most played games' art with your numbers (LibraryHero), carousel
 * rows (playing lately, backlog), then every game (your hours by genre,
 * which also filters, then shelves, search, sort and filters). "Find match"
 * opens over the page.
 */
export default function Library() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState(null);
  const [achievements, setAchievements] = useState({});
  const [view, setView] = useState({ shelf: "all", filter: "all", genre: "", platform: "", query: "", sort: "hours" });
  const [matchFor, setMatchFor] = useState(null);
  const [rowKeys, setRowKeys] = useState([]);
  const quickLook = useQuickLook();

  const load = useCallback(
    () =>
      fetch(`${API}/api/library`, { credentials: "include" })
        .then((res) => (res.ok ? res.json() : Promise.reject()))
        .then((json) => { setData(json); setRowKeys(rowKeysFor(json)); setError(null); })
        .catch(() => setError("Failed to load library"))
        .finally(() => setLoading(false)),
    []
  );

  useEffect(() => { load(); }, [load]);

  // Achievement progress arrives after the page (it asks Steam per game).
  const linked = Boolean(data?.linked);
  useEffect(() => {
    if (!linked) return;
    let cancelled = false;
    fetch(`${API}/api/library/achievements`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => !cancelled && j?.games && setAchievements(j.games))
      .catch(() => {});
    return () => { cancelled = true; };
  }, [linked]);

  const items = useMemo(() => libraryItems(data, achievements), [data, achievements]);
  const stats = useMemo(() => libraryStats(items), [items]);
  // The page's colour: your most played games' (the hero and the games box).
  const topCovers = useMemo(
    () => [...items].filter((g) => g.cover).sort((a, b) => b.hours - a.hours).slice(0, 3).map((g) => g.cover),
    [items]
  );
  const tint = useArtTint(topCovers);
  const gridRef = useRef(null);
  const shown = useMemo(() => applyView(items, view), [items, view]);
  const genres = useMemo(() => facets(items, "genres"), [items]);
  const platforms = useMemo(() => facets(items, "platforms"), [items]);
  const byRawg = useMemo(() => new Map(items.filter((g) => g.matched).map((g) => [g.rawgId, g])), [items]);
  const rows = useMemo(() => {
    const byHours = [...items].sort((a, b) => b.hours - a.hours);
    return [
      { key: "lately", title: "Playing lately", games: carouselGames([...items].filter((g) => g.recent > 0).sort((a, b) => b.recent - a.recent)), recent: true, empty: "Nothing played in the last two weeks." },
      { key: "backlog", title: "Backlog", games: carouselGames(byHours.filter((g) => g.shelf === "backlog")), empty: "Your backlog is clear." },
    ].filter((r) => rowKeys.includes(r.key));
  }, [items, rowKeys]);
  const set = (patch) => setView((v) => ({ ...v, ...patch }));
  // A card's quick look: your side of it from what the page already has (no
  // extra request), stepping through the grid's matched games in its order,
  // and shelf changes made through the page so the grid keeps in step.
  const lookSeed = (g) => ({
    rawgId: g.rawgId,
    name: g.name,
    cover: g.cover,
    genres: g.genres,
    released: g.released,
    owners: g.owners,
    mine: { owned: true, appid: g.appid, hours: g.hours, recent: g.recent, achievements: g.achievements, shelf: g.shelf, verdict: g.verdict },
  });
  const openLook = (g) =>
    quickLook(lookSeed(g), { list: shown.filter((x) => x.matched).map(lookSeed), onShelf: setShelf });

  // "Sync now": fetch the library from Steam, then show the new one.
  const syncNow = async () => {
    setSyncing(true);
    setSyncNote(null);
    try {
      const res = await fetch(`${API}/api/me/library/sync`, { method: "POST", credentials: "include" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Couldn't sync. Try again in a moment.");
      if (json.private) {
        setSyncNote("Steam didn't share your games (your game details may be private), so your library is as it was.");
      }
      await load();
    } catch (e) {
      setSyncNote(e.message);
    } finally {
      setSyncing(false);
    }
  };

  // A shelf change shows at once, and is undone if it doesn't save.
  const setShelf = async (appid, status) => {
    const before = data.shelves?.[appid] ?? null;
    const put = (s) => setData((d) => {
      const shelves = { ...(d.shelves ?? {}) };
      if (s) shelves[appid] = s; else delete shelves[appid];
      return { ...d, shelves };
    });
    put(status);
    try {
      const r = await fetch(`${API}/api/library/shelves/${appid}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error();
      return true;
    } catch {
      put(before);
      setSyncNote("Couldn't save that shelf. Try again.");
      return false;
    }
  };

  if (loading) return <div className={styles.libraryState}>Loading your library…</div>;
  if (error) return <div className={`${styles.libraryState} ${styles.libraryStateError}`}>{error}</div>;
  if (!data?.linked) {
    return (
      <div className={styles.libraryState}>
        <h2>No Steam Library</h2>
        <p>Link your Steam account to see your games here.</p>
      </div>
    );
  }

  const shelfCount = (k) => (k === "all" ? items.length : items.filter((g) => g.shelf === k).length);
  const shelfTabs = [["all", "All"], ...SHELVES];
  const fixedGrid = items.length > 8;
  const tagFor = (row) => (game) => {
    const g = byRawg.get(game.id);
    if (!g) return null;
    return row.recent ? `2 wk · ${hoursText(g.recent)}` : hoursText(g.hours);
  };
  const rowsBlock = rows.length > 0 && (
    <div className={styles.rows}>
      {rows.map((r) =>
        r.games.length ? (
          <GameCarousel key={r.key} games={r.games} title={r.title} renderDateTag={tagFor(r)} edge="fade" />
        ) : (
          <section key={r.key} className={styles.rowEmpty}>
            <h2>{r.title}</h2>
            <p>{r.empty}</p>
          </section>
        )
      )}
    </div>
  );

  return (
    <div className={styles.library}>
      <LibraryHero
        items={items}
        stats={stats}
        lastSyncedAt={data.lastSyncedAt}
        syncing={syncing}
        onSync={syncNow}
        note={syncNote}
        tint={tint}
      />

      {rowsBlock}

      <section className={styles.allGames} style={tint ? { "--accent": tint } : undefined}>
        <div className={styles.allHead}>
          <h2 className={styles.sectionTitle}>
            All games
          </h2>
          <div className={styles.toolbarEnd}>
            <label className={styles.search}>
              <Search size={14} />
              <input value={view.query} onChange={(e) => set({ query: e.target.value })} placeholder="Search your games" aria-label="Search your games" />
            </label>
            <Select
              ariaLabel="Sort"
              align="right"
              value={view.sort}
              options={SORTS.map(([k, label]) => [k, label])}
              onChange={(sort) => set({ sort })}
            />
            <FiltersMenu items={items} view={view} set={set} genres={genres} platforms={platforms} />
          </div>
        </div>

        <div className={styles.allNav}>
          <div className={styles.tabs} role="tablist" aria-label="Shelves">
            {shelfTabs.map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={view.shelf === k}
                className={`${styles.tab} ${view.shelf === k ? styles.tabOn : ""} ${shelfCount(k) ? "" : styles.tabEmpty}`}
                onClick={() => set({ shelf: k })}
              >
                {label}<span className={styles.chipCount}>{shelfCount(k)}</span>
              </button>
            ))}
          </div>
          <span className={styles.navDivider} aria-hidden="true" />
          <GenreStrip items={items} active={view.genre} onPick={(genre) => set({ genre })} />
        </div>

        <div className={styles.gridWrap}>
          <div ref={gridRef} className={`${styles.gridScroll} ${fixedGrid ? styles.gridScrollFixed : ""} ${rail.scroller}`}>
            {shown.length ? (
              <div className={styles.grid}>
                {shown.map((g) => (
                  <LibraryCard key={g.appid} g={g} onShelf={setShelf} onFindMatch={setMatchFor} onOpen={openLook} />
                ))}
              </div>
            ) : (
              <p className={styles.empty}>No games match these filters.</p>
            )}
          </div>
          {/* in the box's right padding, clear of the cards */}
          <ScrollRail targetRef={gridRef} watch={shown.length} style={{ right: -14 }} />
        </div>
      </section>

      {matchFor && (
        <FindMatchDialog
          game={matchFor}
          onClose={() => setMatchFor(null)}
          onMatched={() => { setMatchFor(null); load(); }}
        />
      )}
    </div>
  );
}
