import { useState } from "react";
import styles from "./Profile.module.css";

const API = import.meta.env.VITE_API_URL;

const ROWS = [
  ["friends", "Friend requests", "When someone sends you a request, or accepts yours."],
  ["mentions", "Mentions", "When someone @mentions you in chat or a review."],
  ["likes", "Likes", "When someone likes your review or your comment."],
  ["messages", "Messages", "Direct and group messages you haven't seen yet."],
];

/*
 * Which notifications you get. A switch saves at once (and flips back if it
 * doesn't save). Turned off, that kind isn't stored or shown at all.
 */
export default function NotificationsPanel({ prefs }) {
  const [on, setOn] = useState(prefs);
  const [error, setError] = useState(null);

  const flip = async (key) => {
    const next = !on[key];
    setOn((p) => ({ ...p, [key]: next }));
    setError(null);
    try {
      const r = await fetch(`${API}/api/account/notifications`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ [key]: next }),
      });
      if (!r.ok) throw new Error();
    } catch {
      setOn((p) => ({ ...p, [key]: !next }));
      setError("Couldn't save that. Try again.");
    }
  };

  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>Notifications</h2>
      {ROWS.map(([key, label, hint]) => (
        <div key={key} className={styles.setting}>
          <span className={styles.settingText}>
            <span className={styles.settingLabel}>{label}</span>
            <span className={styles.settingHint}>{hint}</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={on[key]}
            aria-label={label}
            className={`${styles.switch} ${on[key] ? styles.switchOn : ""}`}
            onClick={() => flip(key)}
          />
        </div>
      ))}
      {error && <p className={styles.err} role="alert">{error}</p>}
    </section>
  );
}
