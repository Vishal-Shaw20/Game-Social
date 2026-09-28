import { useEffect, useRef, useState } from "react";
import { Crown, Sparkles, Meh, ThumbsDown, Lock } from "lucide-react";
import MentionInput from "../../MentionInput";
import { TAGS, tagSections, normalizeTags } from "../../shared/reviewTags";
import { API, VERDICT_META, findMyReview } from "./format";
import ScrollRail from "./ScrollRail";
import rail from "./ScrollRail.module.css";
import styles from "./GameDock.module.css";

const ICONS = { perfection: Crown, almost_good: Sparkles, subpar: Meh, awful_fun: ThumbsDown };
const EMPTY = { verdict: null, body: "", pros: [], cons: [] };

/* Auto-save: the on/off choice is remembered per browser; the draft itself
   lives on the server (/api/review-drafts), private to its author. */
const AUTOSAVE_KEY = "gs.reviewAutosave";
const SAVE_DELAY = 1500;

function readAutosavePref() {
  try {
    return localStorage.getItem(AUTOSAVE_KEY) === "1";
  } catch {
    return false;
  }
}
function writeAutosavePref(on) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, on ? "1" : "0");
  } catch {
    /* private mode etc.: the switch still works for this visit */
  }
}

const draftApi = (gameId, init) =>
  fetch(`${API}/api/review-drafts/${gameId}`, { credentials: "include", ...init });

// What gets saved: the fields the composer controls, plus which published
// review it edits (if any). Compared as JSON to skip no-op saves.
const draftPayload = (d, editingId) => ({
  verdict: d.verdict ?? null,
  body: d.body ?? "",
  pros: d.pros ?? [],
  cons: d.cons ?? [],
  reviewId: editingId ?? null,
});
const isEmptyDraft = (p) => !p.verdict && !p.body.trim() && !p.pros.length && !p.cons.length;

// A published review as composer fields.
const reviewFields = (r) => ({
  verdict: r.verdict, title: r.title || "", body: r.body || "",
  pros: normalizeTags(r.pros, "pros"), cons: normalizeTags(r.cons, "cons"),
  completed: Boolean(r.completed),
});

// Same content? Tags compare as sets: the order they were picked in doesn't
// show anywhere.
const sortedTags = (list) => [...(list ?? [])].sort();
const sameReview = (a, b) =>
  (a.verdict ?? null) === (b.verdict ?? null) &&
  (a.body ?? "").trim() === (b.body ?? "").trim() &&
  JSON.stringify(sortedTags(a.pros)) === JSON.stringify(sortedTags(b.pros)) &&
  JSON.stringify(sortedTags(a.cons)) === JSON.stringify(sortedTags(b.cons));

/*
 * The review form, laid out in columns to fit the dock bar:
 *   verdict | writing box (text, Auto-save, Post) | what worked / what didn't
 * There's no title field; an existing review's title is kept when edited.
 *
 * Auto-save: while on, the draft is saved to the server shortly after each
 * change and restored into the dock next time this game is opened, on any
 * device. Drafts are never shown to anyone else. Switching it off deletes
 * the saved draft (the text stays in the box for this visit); posting
 * deletes it too (server side).
 * `compact` (a short dock) tightens it: no column labels, smaller controls.
 * Posting and editing go through the /api/reviews endpoints.
 * One review per game: once you've posted, the same form stays in edit mode
 * with your review loaded (`draft` is null until you change something), and
 * Auto-save starts off there whatever it is for new reviews.
 */
export default function ReviewComposer({
  gameId, reviews, setReviews, draft, setDraft,
  currentUserId, compact = false, tagContext = null,
}) {
  const [saving, setSaving] = useState(false);
  const [tagTab, setTagTab] = useState(0); // 0 what worked, 1 what didn't
  const worksRef = useRef(null);
  const didntRef = useRef(null);
  const [error, setError] = useState(null);
  const mine = findMyReview(reviews, currentUserId);
  const editingId = mine?._id ?? null;
  const published = mine ? reviewFields(mine) : null;
  const d = { ...EMPTY, ...(draft ?? published) };
  // Checked on every render, so changing things back to exactly what's posted
  // counts as no change again (Update off, no Cancel, nothing to auto-save).
  const untouched = published ? sameReview(d, published) : draft == null;
  const set = (patch) => setDraft({ ...d, ...patch });

  /* ── auto-save ── */
  // Separate switches: new reviews follow the remembered choice; editing a
  // posted review starts off.
  const [autosaveNew, setAutosaveNew] = useState(readAutosavePref);
  const [autosaveEdit, setAutosaveEdit] = useState(false);
  const autosave = editingId ? autosaveEdit : autosaveNew;
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState({ kind: "idle", at: null }); // idle | restored | saving | saved | error
  const lastSaved = useRef(null);       // JSON of the last payload the server has
  const hasServerDraft = useRef(false);

  // Restore a saved draft once, when the signed-in user is known.
  useEffect(() => {
    if (!currentUserId) return;
    let cancelled = false;
    draftApi(gameId)
      .then((r) => (r.ok ? r.json() : null))
      .then((saved) => {
        if (cancelled) return;
        if (saved) {
          const restored = {
            verdict: saved.verdict, body: saved.body || "",
            pros: normalizeTags(saved.pros, "pros"), cons: normalizeTags(saved.cons, "cons"),
          };
          setDraft(restored);
          lastSaved.current = JSON.stringify(draftPayload(restored, saved.reviewId));
          hasServerDraft.current = true;
          (saved.reviewId ? setAutosaveEdit : setAutosaveNew)(true);
          setSaveState({ kind: "restored", at: saved.updatedAt });
        }
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoaded(true));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per user and game
  }, [currentUserId, gameId]);

  // Save shortly after the draft stops changing.
  const payload = draftPayload(d, editingId);
  const payloadKey = JSON.stringify(payload);
  useEffect(() => {
    if (!autosave || !loaded || !currentUserId) return;
    // Nothing changed from what's shown by default (blank, or your review).
    // Edited back to exactly what's posted: a saved draft is stale now, so
    // drop it (after the same pause, in case you're mid-edit).
    if (untouched) {
      if (!editingId || !hasServerDraft.current) return;
      const t = setTimeout(() => {
        hasServerDraft.current = false;
        lastSaved.current = null;
        draftApi(gameId, { method: "DELETE" }).catch(() => {});
        setSaveState({ kind: "idle", at: null });
      }, SAVE_DELAY);
      return () => clearTimeout(t);
    }
    if (payloadKey === lastSaved.current) return;
    // Nothing typed and nothing on the server: nothing to save (this is also
    // the state right after posting).
    if (isEmptyDraft(JSON.parse(payloadKey)) && !hasServerDraft.current) return;
    const t = setTimeout(async () => {
      setSaveState((s) => ({ ...s, kind: "saving" }));
      try {
        const r = await draftApi(gameId, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: payloadKey,
        });
        if (!r.ok) throw Object.assign(new Error("save failed"), { status: r.status });
        lastSaved.current = payloadKey;
        hasServerDraft.current = true;
        setSaveState({ kind: "saved", at: Date.now() });
      } catch (err) {
        // The status makes a failure diagnosable at a glance (404: a backend
        // without the draft API; 429: rate limited; 401: signed out).
        setSaveState((s) => ({ ...s, kind: "error", status: err.status ?? "network" }));
      }
    }, SAVE_DELAY);
    return () => clearTimeout(t);
  }, [autosave, loaded, currentUserId, gameId, payloadKey, untouched, editingId]);

  const discardServerDraft = () => {
    lastSaved.current = null;
    if (!hasServerDraft.current) return;
    hasServerDraft.current = false;
    draftApi(gameId, { method: "DELETE" }).catch(() => {});
  };

  const toggleAutosave = () => {
    const on = !autosave;
    if (editingId) {
      setAutosaveEdit(on);
    } else {
      setAutosaveNew(on);
      writeAutosavePref(on);
    }
    if (!on) discardServerDraft();
    setSaveState({ kind: "idle", at: null });
  };

  // A tag is one aspect with two sides: picking it under one tab takes it
  // off the other ("Satisfying gunplay" and "Floaty gunplay" can't both hold).
  const toggleTag = (key, id) => {
    const other = key === "pros" ? "cons" : "pros";
    set({
      [key]: d[key].includes(id) ? d[key].filter((t) => t !== id) : [...d[key], id],
      [other]: d[other].filter((t) => t !== id),
    });
  };

  // General tags, then a section per genre pack (and multiplayer). Tags an
  // older review picked that this game doesn't offer any more are listed at
  // the end, so they can still be seen and removed.
  const sections = tagSections(tagContext ?? {});
  const offered = new Set(sections.flatMap((s) => s.tags));
  const extra = [...new Set([...d.pros, ...d.cons])].filter((id) => TAGS[id] && !offered.has(id));
  if (extra.length) sections.push({ key: "extra", title: "Picked earlier", tags: extra });
  const multi = sections.length > 1;

  async function submit() {
    if (!d.verdict || saving) return;
    setSaving(true);
    setError(null);
    const base = mine;
    try {
      const res = await fetch(
        editingId ? `${API}/api/reviews/${editingId}` : `${API}/api/reviews/${gameId}`,
        {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          // Title and "finished" aren't in the composer any more: an edit
          // keeps whatever the published review had.
          body: JSON.stringify({
            verdict: d.verdict,
            body: d.body,
            pros: d.pros,
            cons: d.cons,
            title: d.title ?? base?.title ?? "",
            completed: d.completed ?? base?.completed ?? false,
          }),
        }
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Couldn't save your review. Try again.");
      }
      const saved = await res.json();
      setReviews((prev) =>
        editingId ? prev.map((r) => (r._id === saved._id ? { ...r, ...saved } : r)) : [saved, ...prev]
      );
      // The server deleted the draft along with posting.
      hasServerDraft.current = false;
      lastSaved.current = null;
      setSaveState({ kind: "idle", at: null });
      // Back to showing the published review, now in edit mode.
      setDraft(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`${styles.composer} ${compact ? styles.composerCompact : ""}`} data-write-review>
      <div className={styles.col}>
        <div className={styles.colLabel}>Verdict</div>
        <div className={styles.verdicts}>
          {Object.entries(VERDICT_META).map(([key, v]) => {
            const Icon = ICONS[key];
            const on = d.verdict === key;
            return (
              <button
                key={key}
                type="button"
                className={`${styles.verdictBtn} ${on ? styles.verdictOn : ""}`}
                style={{ "--c": v.color }}
                // Clicking the chosen verdict again clears it.
                onClick={() => set({ verdict: on ? null : key })}
                aria-pressed={on}
              >
                <Icon size={17} /> {v.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* The writing box: dark, with its own footer holding the controls. */}
      <div className={`${styles.col} ${styles.textCol}`}>
        <div className={styles.colLabel}>{editingId ? "Editing your review" : "Your review"}</div>
        <div className={styles.writeBox}>
          <MentionInput value={d.body} onChange={(v) => set({ body: v })} placeholder="What did you think? @mention friends…" rows={3} />
          <div className={styles.writeFoot}>
            <button
              type="button"
              role="switch"
              aria-checked={autosave}
              className={`${styles.autosave} ${autosave ? styles.autosaveOn : ""}`}
              onClick={toggleAutosave}
              title={autosave
                ? "Your draft is saved as you type and comes back next time. Only you can see it. Turning this off deletes the saved draft."
                : "Save this draft as you type, so it's here when you come back. Only you can see it."}
            >
              <span className={styles.switch} aria-hidden="true"><span /></span>
              Auto-save
            </button>
            {error ? (
              <span className={styles.error}>{error}</span>
            ) : autosave && saveState.kind !== "idle" ? (
              <span className={`${styles.hint} ${saveState.kind === "error" ? styles.error : ""}`}>
                <Lock size={11} /> {saveLabel(saveState)}
              </span>
            ) : (
              !d.verdict && <span className={styles.hint}>Pick a verdict to post</span>
            )}
            <span className={styles.footSpacer} />
            {/* Cancel drops your changes and reloads the published review. */}
            {editingId && !untouched && (
              <button className={styles.cancelLink} onClick={() => { discardServerDraft(); setDraft(null); }}>
                Cancel
              </button>
            )}
            <button
              className={styles.submitBtn}
              onClick={submit}
              disabled={!d.verdict || saving || (editingId && untouched)}
            >
              {saving ? "Saving…" : editingId ? "Update" : "Post"}
            </button>
          </div>
        </div>
      </div>

      <div className={`${styles.col} ${styles.tagsCol}`}>
        <div className={styles.tagTabs} role="tablist" style={{ "--t": tagTab }}>
          <span className={styles.tagTabBar} aria-hidden="true" />
          {[["What worked", d.pros.length], ["What didn't", d.cons.length]].map(([label, n], i) => (
            <button
              key={label}
              type="button"
              role="tab"
              aria-selected={tagTab === i}
              className={`${styles.tagTab} ${tagTab === i ? styles.tagTabOn : ""}`}
              onClick={() => setTagTab(i)}
            >
              {label}
              {n > 0 && <span className={i ? styles.countCon : styles.countPro}>{n}</span>}
            </button>
          ))}
        </div>
        {/* The two chip sets stacked; the tab slides between them vertically. */}
        <div className={styles.tagViewport}>
          <div className={styles.tagTrack} style={{ "--t": tagTab }}>
            {[["pros", 0, styles.proOn], ["cons", 1, styles.conOn]].map(([key, side, onCls], i) => (
              <div key={key} className={styles.tagPanel} inert={tagTab !== i}>
                <div ref={i ? didntRef : worksRef} className={`${styles.tagScroll} ${rail.scroller}`}>
                {sections.map((sec) => (
                  <div key={sec.key} className={styles.tagSection}>
                    {multi && <div className={styles.tagSectionTitle}>{sec.title}</div>}
                    <div className={styles.tagChips}>
                      {sec.tags.map((id) => (
                        <button
                          key={id}
                          type="button"
                          className={`${styles.tagChip} ${d[key].includes(id) ? onCls : ""}`}
                          aria-pressed={d[key].includes(id)}
                          onClick={() => toggleTag(key, id)}
                        >
                          {TAGS[id][side]}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                </div>
                <ScrollRail targetRef={i ? didntRef : worksRef} watch={`${sections.length}:${tagTab}`} />
              </div>
            ))}
          </div>
        </div>
      </div>

    </div>
  );
}

function saveLabel({ kind, at, status }) {
  if (kind === "saving") return "Saving draft…";
  if (kind === "error") return `Couldn't save draft (${status})`;
  if (kind === "restored") return `Draft restored${at ? ` · saved ${new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}`;
  return "Draft saved · only you can see it";
}
