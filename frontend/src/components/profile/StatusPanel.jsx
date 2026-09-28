import { useState } from "react";
import Select from "../Select";
import styles from "./Profile.module.css";

const API = import.meta.env.VITE_API_URL;
const MAX = 80;
const PRESETS = ["Looking for a group", "Down to play", "Streaming", "Busy, not playing"];
const CLEAR = [
  ["never", "Don't clear"],
  ["1h", "In 1 hour"],
  ["4h", "In 4 hours"],
  ["today", "At the end of today"],
  ["week", "In a week"],
];

// When a status set now should clear, for each choice (null: never).
function expiry(choice) {
  const now = new Date();
  if (choice === "1h") return new Date(now.getTime() + 3600e3);
  if (choice === "4h") return new Date(now.getTime() + 4 * 3600e3);
  if (choice === "week") return new Date(now.getTime() + 7 * 864e5);
  if (choice === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  return null;
}

// "clears in 3 hours" / "clears tomorrow at 9:00"
function clearsText(at) {
  const ms = new Date(at).getTime() - Date.now();
  if (ms < 3600e3) return `clears in ${Math.max(1, Math.round(ms / 60e3))} min`;
  if (ms < 24 * 3600e3) return `clears in ${Math.round(ms / 3600e3)} h`;
  return `clears ${new Date(at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
}

/*
 * Your custom status: a short line friends see by your name (in Social, on
 * profiles), with a few ready-made ones and when it should clear itself.
 */
export default function StatusPanel({ status, onChange }) {
  const [text, setText] = useState(status?.text ?? "");
  const [clear, setClear] = useState("never");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const save = async (next) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`${API}/api/account`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: next }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "Couldn't save your status.");
      setMsg({ ok: true, text: next ? "Status set. Your friends can see it." : "Status cleared." });
      if (!next) setText("");
      onChange();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const left = MAX - text.length;
  const changed = text.trim() !== (status?.text ?? "") || clear !== "never";

  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>Your status</h2>
      <p className={styles.muted}>
        {status?.text
          ? <>Friends see <b style={{ color: "#f0f6fc" }}>“{status.text}”</b> · {status.expiresAt ? clearsText(status.expiresAt) : "until you clear it"}.</>
          : "A short line your friends see next to your name."}
      </p>

      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) save({ text: text.trim(), expiresAt: expiry(clear)?.toISOString() ?? null });
        }}
      >
        <div className={styles.presets}>
          {PRESETS.map((p) => (
            <button key={p} type="button" className={styles.preset} onClick={() => setText(p)}>{p}</button>
          ))}
        </div>
        <input
          className={styles.input}
          value={text}
          maxLength={MAX}
          placeholder="What are you up to? e.g. LFG for Elden Ring, 9pm"
          onChange={(e) => setText(e.target.value)}
        />
        <div className={styles.inline}>
          <span className={styles.settingHint}>Clear it</span>
          <Select ariaLabel="Clear status" value={clear} options={CLEAR} onChange={setClear} />
          <span className={`${styles.counter} ${styles.grow}`} style={{ textAlign: "right" }}>{left}</span>
        </div>
        <div className={styles.formActions}>
          <button type="submit" className={`${styles.btnAccent} ${styles.small}`} disabled={busy || !text.trim() || !changed}>
            {busy ? "Saving…" : "Set status"}
          </button>
          {status?.text && (
            <button type="button" className={`${styles.btnGhost} ${styles.small}`} onClick={() => save(null)} disabled={busy}>
              Clear status
            </button>
          )}
        </div>
      </form>
      {msg && <p className={msg.ok ? styles.ok : styles.err} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
    </section>
  );
}
