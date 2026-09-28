import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Skull } from "lucide-react";
import styles from "./Profile.module.css";
import doom from "./Doom.module.css";

const API = import.meta.env.VITE_API_URL;
const HOLD_MS = 2500;

/*
 * Deleting your account. The button at the bottom of the page opens it: the
 * whole screen goes blood-red, you type your username, then hold the button
 * down (letting go cancels). When it's done, a cut to black and home.
 * Your reviews, comments and messages stay, as "Deleted user".
 */
export default function DangerZone({ username }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <section className={styles.danger}>
        <span>
          <h2 className={styles.dangerTitle}>Delete account</h2>
          <p className={styles.muted}>Permanently remove your account and everything tied to it. There's no undo.</p>
        </span>
        <button type="button" className={styles.btnDanger} onClick={() => setOpen(true)}>Delete account…</button>
      </section>
      {open && <Doom username={username} onClose={() => setOpen(false)} />}
    </>
  );
}

function Doom({ username, onClose }) {
  const [typed, setTyped] = useState("");
  const [holding, setHolding] = useState(false);
  const [phase, setPhase] = useState("confirm"); // confirm | deleting | gone
  const [error, setError] = useState(null);
  const timer = useRef(null);
  const inputRef = useRef(null);
  const ready = typed.trim().toLowerCase() === (username || "").toLowerCase() && Boolean(username);

  useEffect(() => {
    inputRef.current?.focus();
    const key = (e) => e.key === "Escape" && phase === "confirm" && onClose();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose, phase]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const destroy = async () => {
    setHolding(false);
    setPhase("deleting");
    setError(null);
    try {
      const r = await fetch(`${API}/api/account`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ confirm: typed.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "It couldn't be deleted. Try again.");
      setPhase("gone");
      // a full load, so nothing of the signed-in app lingers
      setTimeout(() => { window.location.href = "/"; }, 3200);
    } catch (e) {
      setError(e.message);
      setPhase("confirm");
    }
  };

  const start = () => {
    if (!ready || phase !== "confirm") return;
    setHolding(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(destroy, HOLD_MS);
  };
  const stop = () => {
    clearTimeout(timer.current);
    setHolding(false);
  };

  return createPortal(
    <div className={doom.doom} role="alertdialog" aria-modal="true" aria-labelledby="doom-title" aria-describedby="doom-sub">
      <div className={doom.tint} aria-hidden="true" />
      <div className={doom.shadow} aria-hidden="true" />

      {phase === "gone" ? (
        <div className={doom.final} role="status">
          <h2>Your account has been deleted.</h2>
          <p>Goodbye</p>
        </div>
      ) : (
        <div className={doom.dialog}>
          <Skull size={46} className={doom.skull} aria-hidden="true" />
          <h2 id="doom-title" className={doom.title}>Delete your account?</h2>
          <p id="doom-sub" className={doom.sub}>This cannot be undone</p>

          <div className={doom.lists}>
            <div className={`${doom.list} ${doom.gone}`}>
              <b>Gone forever</b>
              <ul>
                <li>Your profile, username and email</li>
                <li>Linked Google and Steam</li>
                <li>Your Steam library, hours and shelves</li>
                <li>Friends and friend requests</li>
                <li>Notifications, activity, settings</li>
              </ul>
            </div>
            <div className={`${doom.list} ${doom.stays}`}>
              <b>Stays, as "Deleted user"</b>
              <ul>
                <li>Your reviews</li>
                <li>Your comments</li>
                <li>Your chat messages</li>
              </ul>
            </div>
          </div>

          <label className={doom.label} htmlFor="doom-confirm">
            Type <code>{username}</code> to confirm
          </label>
          <input
            ref={inputRef}
            id="doom-confirm"
            className={doom.input}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={phase !== "confirm"}
          />

          <button
            type="button"
            className={`${doom.hold} ${holding ? doom.holding : ""}`}
            style={{ "--hold": `${HOLD_MS}ms` }}
            disabled={!ready || phase !== "confirm"}
            onPointerDown={start}
            onPointerUp={stop}
            onPointerLeave={stop}
            onPointerCancel={stop}
            onKeyDown={(e) => (e.key === " " || e.key === "Enter") && !e.repeat && (e.preventDefault(), start())}
            onKeyUp={(e) => (e.key === " " || e.key === "Enter") && stop()}
          >
            <span>{phase === "deleting" ? "Deleting…" : holding ? "Keep holding…" : "Hold to delete forever"}</span>
          </button>
          {error && <p className={doom.err} role="alert">{error}</p>}

          <button type="button" className={doom.keep} onClick={onClose} disabled={phase !== "confirm"}>
            No, keep my account
          </button>
        </div>
      )}
    </div>,
    document.body
  );
}
