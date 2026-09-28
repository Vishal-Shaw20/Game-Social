import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { requirementRows } from "./requirements";
import styles from "./GamePanels.module.css";

const OS = [["pc", "Windows"], ["mac", "macOS"], ["linux", "Linux / SteamOS"]];

/*
 * System requirements in the panels' language (GamePanels.module.css): a tab
 * per platform, then one table, a row per spec (OS, processor, memory…) with
 * Minimum and Recommended side by side (only the columns the game gives).
 * Lines without a label ("Requires a 64-bit processor") sit above it as
 * pills; long notes and Steam's legal text fold away under "Notes".
 */
export default function GameRequirements({ requirements, legalNotice }) {
  const available = OS.filter(([k]) => requirements?.[k] && requirementRows(requirements[k]).rows.length);
  const [picked, setPicked] = useState(null);
  const [notesOpen, setNotesOpen] = useState(false);
  if (!available.length) return null;
  const os = available.some(([k]) => k === picked) ? picked : available[0][0];
  const { rows, lines, notes, hasMin, hasRec } = requirementRows(requirements[os]);
  const both = hasMin && hasRec;
  const extras = notes.length + (legalNotice ? 1 : 0);

  return (
    <section className={styles.panel}>
      <h2 className={styles.title}>System requirements</h2>

      {available.length > 1 && (
        <div className={styles.newsTabs} role="tablist" aria-label="Platform">
          {available.map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={k === os}
              className={`${styles.newsTab} ${k === os ? styles.newsTabOn : ""}`}
              onClick={() => { setPicked(k); setNotesOpen(false); }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {lines.length > 0 && (
        <div className={styles.reqLines}>
          {lines.map((l) => <span key={l} className={styles.reqLine}>{l}</span>)}
        </div>
      )}

      <div className={`${styles.reqTable} ${both ? styles.reqTableTwo : ""}`} role="table" aria-label="System requirements">
        <div className={styles.reqHead} role="row">
          <span role="columnheader" />
          {hasMin && <span role="columnheader">Minimum</span>}
          {hasRec && <span role="columnheader" className={styles.reqRecHead}>Recommended</span>}
        </div>
        {rows.map((r) => (
          <div key={r.label} className={styles.reqRow} role="row">
            <span className={styles.reqLabel} role="rowheader">{r.label}</span>
            {hasMin && <span className={styles.reqCell} role="cell">{r.min ?? "—"}</span>}
            {hasRec && <span className={`${styles.reqCell} ${styles.reqRec}`} role="cell">{r.rec ?? "—"}</span>}
          </div>
        ))}
      </div>

      {extras > 0 && (
        <div className={styles.reqNotes}>
          <button
            type="button"
            className={styles.reqNotesToggle}
            onClick={() => setNotesOpen((v) => !v)}
            aria-expanded={notesOpen}
          >
            Notes
            <ChevronDown size={14} className={notesOpen ? styles.reqNotesOpen : ""} />
          </button>
          {notesOpen && (
            <div className={styles.reqNotesBody}>
              {notes.map((n, i) => (
                <p key={i}>
                  {(n.level || n.label) && (
                    <b>{[n.level, n.label].filter(Boolean).join(" · ")}: </b>
                  )}
                  {n.text}
                </p>
              ))}
              {legalNotice && <p className={styles.reqLegal}>{legalNotice}</p>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
