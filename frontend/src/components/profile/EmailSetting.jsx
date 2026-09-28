import { useState } from "react";
import styles from "./Profile.module.css";

const API = import.meta.env.VITE_API_URL;

/*
 * Your email in the Security panel: the address and whether it's verified,
 * and changing it (or adding one): type the new address, get a code there,
 * enter it. Until then, the old one stays.
 */
export default function EmailSetting({ email, verified, onChange }) {
  const [step, setStep] = useState("idle"); // idle | enter | code
  const [next, setNext] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const post = async (path, body) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`${API}/api/account/email/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "Something went wrong. Try again.");
      return j;
    } catch (e) {
      setMsg({ ok: false, text: e.message });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const sendCode = async (e) => {
    e?.preventDefault();
    const j = await post("code", { email: next });
    if (j) {
      setStep("code");
      setCode("");
      setMsg({ ok: true, text: `We sent a 6-digit code to ${j.email}.` });
    }
  };
  const verify = async (e) => {
    e.preventDefault();
    const j = await post("verify", { code });
    if (j) {
      setStep("idle");
      setNext("");
      setMsg({ ok: true, text: `Your email is now ${j.email}.` });
      onChange();
    }
  };
  const cancel = () => {
    setStep("idle");
    setNext("");
    setCode("");
    setMsg(null);
  };

  return (
    <>
      <div className={styles.setting}>
        <span className={styles.settingText}>
          <span className={styles.settingLabel}>Email</span>
          <span className={styles.settingHint}>
            {email ? (
              <>
                {email}
                <span className={`${styles.badge} ${verified ? styles.badgeOk : styles.badgeWarn}`}>
                  {verified ? "Verified" : "Not verified"}
                </span>
              </>
            ) : (
              "No email yet. Add one to reset your password and get codes."
            )}
          </span>
        </span>
        {step === "idle" && (
          <button type="button" className={`${styles.btnGhost} ${styles.small}`} onClick={() => { setStep("enter"); setMsg(null); }}>
            {email ? (verified ? "Change" : "Change or verify") : "Add email"}
          </button>
        )}
      </div>

      {step === "enter" && (
        <form className={styles.form} onSubmit={sendCode}>
          <input className={styles.input} type="email" placeholder={email ? "New email" : "Your email"} autoComplete="email" value={next} onChange={(e) => setNext(e.target.value)} required autoFocus />
          <p className={styles.hint}>We'll send a code there to make sure it's yours.{email && !verified && " To verify your current one, enter it again."}</p>
          <div className={styles.formActions}>
            <button type="submit" className={`${styles.btnAccent} ${styles.small}`} disabled={busy}>{busy ? "Sending…" : "Send code"}</button>
            <button type="button" className={`${styles.btnGhost} ${styles.small}`} onClick={cancel}>Cancel</button>
          </div>
        </form>
      )}

      {step === "code" && (
        <form className={styles.form} onSubmit={verify}>
          <input
            className={styles.input}
            placeholder="6-digit code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            required
            autoFocus
          />
          <div className={styles.formActions}>
            <button type="submit" className={`${styles.btnAccent} ${styles.small}`} disabled={busy || code.length !== 6}>{busy ? "Checking…" : "Confirm email"}</button>
            <button type="button" className={`${styles.btnGhost} ${styles.small}`} onClick={() => sendCode()} disabled={busy}>Send a new code</button>
            <button type="button" className={`${styles.btnGhost} ${styles.small}`} onClick={cancel}>Cancel</button>
          </div>
        </form>
      )}
      {msg && <p className={msg.ok ? styles.ok : styles.err} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
    </>
  );
}
