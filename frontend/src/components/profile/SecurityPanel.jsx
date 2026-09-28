import { useState } from "react";
import EmailSetting from "./EmailSetting";
import styles from "./Profile.module.css";

const API = import.meta.env.VITE_API_URL;
const MIN_PASSWORD = 8;

/*
 * Your email (verified or not; change it with a code), password (change it, or add one to an account that signs in with Google
 * or Steam, so you can also sign in with your email or username) and
 * signing out every other device.
 */
export default function SecurityPanel({ email, emailVerified, hasPassword, onChange }) {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState({ current: "", next: "" });
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null); // { ok, text, where }

  const post = async (path, body, where) => {
    setBusy(where);
    setMsg(null);
    try {
      const r = await fetch(`${API}/api/account/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body ?? {}),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "Something went wrong. Try again.");
      return j;
    } catch (e) {
      setMsg({ ok: false, text: e.message, where });
      return null;
    } finally {
      setBusy(null);
    }
  };

  const savePassword = async (e) => {
    e.preventDefault();
    if (pw.next.length < MIN_PASSWORD) {
      return setMsg({ ok: false, text: `Use at least ${MIN_PASSWORD} characters for your password.`, where: "pw" });
    }
    const j = await post("password", hasPassword ? pw : { next: pw.next }, "pw");
    if (!j) return;
    setPw({ current: "", next: "" });
    setOpen(false);
    setMsg({ ok: true, text: j.added ? "Password added. You can now sign in with your email or username too." : "Password changed.", where: "pw" });
    onChange();
  };

  const signOutOthers = async () => {
    const j = await post("signout-others", null, "sessions");
    if (j) {
      setMsg({
        ok: true,
        text: j.signedOut ? `Signed out ${j.signedOut} other ${j.signedOut === 1 ? "device" : "devices"}.` : "No other devices were signed in.",
        where: "sessions",
      });
    }
  };

  const note = (where) =>
    msg?.where === where && <p className={msg.ok ? styles.ok : styles.err} role={msg.ok ? "status" : "alert"}>{msg.text}</p>;

  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>Security</h2>

      <EmailSetting email={email} verified={emailVerified} onChange={onChange} />

      <div className={styles.setting}>
        <span className={styles.settingText}>
          <span className={styles.settingLabel}>Password</span>
          <span className={styles.settingHint}>
            {hasPassword ? "Change the password you sign in with." : "Add one so you can also sign in with your email or username."}
          </span>
        </span>
        {!open && (
          <button type="button" className={`${styles.btnGhost} ${styles.small}`} onClick={() => { setOpen(true); setMsg(null); }}>
            {hasPassword ? "Change" : "Add a password"}
          </button>
        )}
      </div>
      {open && (
        <form className={styles.form} onSubmit={savePassword}>
          {hasPassword && (
            <input className={styles.input} type="password" placeholder="Current password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))} required />
          )}
          <input className={styles.input} type="password" placeholder="New password" autoComplete="new-password" minLength={MIN_PASSWORD} value={pw.next} onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))} required />
          <p className={styles.hint}>At least {MIN_PASSWORD} characters.</p>
          <div className={styles.formActions}>
            <button type="submit" className={`${styles.btnAccent} ${styles.small}`} disabled={busy === "pw"}>
              {busy === "pw" ? "Saving…" : hasPassword ? "Change password" : "Add password"}
            </button>
            <button type="button" className={`${styles.btnGhost} ${styles.small}`} onClick={() => { setOpen(false); setPw({ current: "", next: "" }); setMsg(null); }}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {note("pw")}

      <div className={styles.setting}>
        <span className={styles.settingText}>
          <span className={styles.settingLabel}>Other devices</span>
          <span className={styles.settingHint}>Sign out everywhere except here, e.g. on a computer you've stopped using.</span>
        </span>
        <button type="button" className={`${styles.btnGhost} ${styles.small}`} onClick={signOutOthers} disabled={busy === "sessions"}>
          {busy === "sessions" ? "Signing out…" : "Sign out others"}
        </button>
      </div>
      {note("sessions")}
    </section>
  );
}
