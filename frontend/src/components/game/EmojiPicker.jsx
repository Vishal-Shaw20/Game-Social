import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search, Clock, Smile, Hand, Cat, Pizza, Plane, Trophy, Lightbulb, Heart, Flag,
} from "lucide-react";
import { frequentEmojis } from "./emojiUsage";
import styles from "./EmojiPicker.module.css";

/*
 * The reaction picker, in the style of Discord's: a search box, a rail of
 * categories on the left, the emojis in sections (Frequently used first),
 * and the hovered one previewed at the bottom. Standard Unicode emojis
 * only. The data (~1,900 emojis) is loaded the first time a picker opens.
 */

const RAIL = [
  { slug: "frequent", title: "Frequently used", Icon: Clock },
  { slug: "smileys_emotion", title: "Smileys & emotion", Icon: Smile },
  { slug: "people_body", title: "People", Icon: Hand },
  { slug: "animals_nature", title: "Animals & nature", Icon: Cat },
  { slug: "food_drink", title: "Food & drink", Icon: Pizza },
  { slug: "travel_places", title: "Travel & places", Icon: Plane },
  { slug: "activities", title: "Activities", Icon: Trophy },
  { slug: "objects", title: "Objects", Icon: Lightbulb },
  { slug: "symbols", title: "Symbols", Icon: Heart },
  { slug: "flags", title: "Flags", Icon: Flag },
];
// Newer emojis than this show as empty boxes on many systems still.
const MAX_EMOJI_VERSION = 15.0;

let dataPromise = null;
function loadEmojis() {
  if (!dataPromise) {
    dataPromise = import("unicode-emoji-json/data-by-group.json").then((mod) =>
      (mod.default ?? mod).map((g) => ({
        slug: g.slug,
        emojis: g.emojis
          .filter((e) => parseFloat(e.emoji_version) <= MAX_EMOJI_VERSION)
          .map((e) => ({ emoji: e.emoji, name: e.name })),
      }))
    );
  }
  return dataPromise;
}

export default function EmojiPicker({ onPick, style, pickerRef }) {
  const [groups, setGroups] = useState(null);
  const [query, setQuery] = useState("");
  const [hovered, setHovered] = useState(null);
  const [frequent] = useState(() => frequentEmojis(16));
  const gridRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    loadEmojis().then((g) => !cancelled && setGroups(g)).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const byEmoji = useMemo(() => {
    const m = new Map();
    for (const g of groups ?? []) for (const e of g.emojis) m.set(e.emoji, e);
    return m;
  }, [groups]);

  const sections = useMemo(() => {
    if (!groups) return [];
    const q = query.trim().toLowerCase();
    if (q) {
      const terms = q.split(/\s+/);
      const hits = groups.flatMap((g) => g.emojis).filter((e) => terms.every((t) => e.name.includes(t)));
      return [{ slug: "search", title: hits.length ? "Search results" : "No emoji matches that", emojis: hits }];
    }
    const freq = frequent.map((e) => byEmoji.get(e) ?? { emoji: e, name: "" });
    return [
      ...(freq.length ? [{ slug: "frequent", title: "Frequently used", emojis: freq }] : []),
      ...groups.map((g) => ({ slug: g.slug, title: RAIL.find((r) => r.slug === g.slug)?.title ?? g.slug, emojis: g.emojis })),
    ];
  }, [groups, query, frequent, byEmoji]);

  const jump = (slug) => {
    setQuery("");
    // after the unfiltered sections are back
    requestAnimationFrame(() => {
      const grid = gridRef.current;
      const sec = grid?.querySelector(`[data-sec="${slug}"]`);
      if (grid && sec) grid.scrollTop = sec.offsetTop - grid.offsetTop;
    });
  };

  const shown = hovered ?? sections[0]?.emojis[0] ?? null;

  return (
    <div ref={pickerRef} className={styles.picker} style={style} role="dialog" aria-label="Pick a reaction">
      <div className={styles.top}>
        <label className={styles.search}>
          <Search size={16} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find the perfect emoji"
            aria-label="Search emojis"
            onKeyDown={(e) => {
              // Enter picks the first result
              if (e.key === "Enter" && sections[0]?.emojis[0]) {
                e.preventDefault();
                onPick(sections[0].emojis[0].emoji);
              }
            }}
          />
        </label>
      </div>

      <div className={styles.body}>
        <nav className={styles.rail} aria-label="Emoji categories">
          {RAIL.filter((r) => r.slug !== "frequent" || frequent.length).map((r) => {
            const Icon = r.Icon;
            return (
              <button key={r.slug} type="button" title={r.title} aria-label={r.title} onClick={() => jump(r.slug)}>
                <Icon size={18} />
              </button>
            );
          })}
        </nav>

        <div ref={gridRef} className={styles.grid} onMouseLeave={() => setHovered(null)}>
          {!groups && <p className={styles.note}>Loading emojis…</p>}
          {sections.map((sec) => (
            <section key={sec.slug} data-sec={sec.slug}>
              <h3 className={styles.secTitle}>{sec.title}</h3>
              <div className={styles.cells}>
                {sec.emojis.map((e) => (
                  <button
                    key={e.emoji}
                    type="button"
                    className={styles.cell}
                    title={e.name ? `:${e.name.replace(/\s+/g, "_")}:` : undefined}
                    aria-label={e.name || e.emoji}
                    onMouseEnter={() => setHovered(e)}
                    onFocus={() => setHovered(e)}
                    onClick={() => onPick(e.emoji)}
                  >
                    {e.emoji}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      <div className={styles.preview}>
        {shown && (
          <>
            <span className={styles.previewEmoji}>{shown.emoji}</span>
            <span className={styles.previewName}>{shown.name ? `:${shown.name.replace(/\s+/g, "_")}:` : ""}</span>
          </>
        )}
      </div>
    </div>
  );
}
