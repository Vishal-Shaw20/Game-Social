import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { timeAgo } from "../game/format";
import Avatar from "./Avatar";
import styles from "./Profile.module.css";

const API = import.meta.env.VITE_API_URL;

const CONFIRM = {
  google: "Disconnect Google? You won't be able to sign in with it any more.",
  steam: "Disconnect Steam? Your synced library and hours leave GameSocial (your shelves are kept, in case you reconnect).",
};

/*
 * The accounts linked to yours: Google and Steam (connect, or disconnect
 * after a confirm; never your last way to sign in), Steam's library sync,
 * and Epic, which is coming.
 */
export default function ConnectionsPanel({ connections, onChange }) {
  const [confirming, setConfirming] = useState(null); // provider
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);

  const connect = (p) => { window.location.href = `${API}/auth/${p}`; };

  const disconnect = async (p) => {
    setBusy(p);
    setError(null);
    try {
      const r = await fetch(`${API}/api/account/connections/${p}`, { method: "DELETE", credentials: "include" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "Couldn't disconnect. Try again.");
      setConfirming(null);
      onChange();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    setBusy("sync");
    setError(null);
    setNote(null);
    try {
      const r = await fetch(`${API}/api/me/library/sync`, { method: "POST", credentials: "include" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || j.message || "Couldn't sync. Try again in a moment.");
      setNote(j.private ? "Steam didn't share your games (your game details may be private)." : "Synced with Steam.");
      onChange();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const { google, steam } = connections;
  const row = (p, logo, name, sub, actions) => (
    <div key={p}>
      <div className={styles.row}>
        {logo}
        <span className={styles.rowText}>
          <span className={styles.rowName}>{name}</span>
          <span className={styles.rowSub}>{sub}</span>
        </span>
        <span className={styles.rowActions}>{actions}</span>
      </div>
      {confirming === p && (
        <div className={styles.confirm} role="alert">
          {CONFIRM[p]}
          <div className={styles.confirmActions}>
            <button type="button" className={`${styles.btnDangerSolid} ${styles.small}`} onClick={() => disconnect(p)} disabled={busy === p}>
              {busy === p ? "Disconnecting…" : "Disconnect"}
            </button>
            <button type="button" className={`${styles.btnGhost} ${styles.small}`} onClick={() => setConfirming(null)}>Keep it</button>
          </div>
        </div>
      )}
    </div>
  );
  const unlink = (p) => (
    <button type="button" className={`${styles.btnDanger} ${styles.small}`} onClick={() => { setConfirming(p); setError(null); }}>
      Disconnect
    </button>
  );
  const link = (p) => (
    <button type="button" className={`${styles.btnAccent} ${styles.small}`} onClick={() => connect(p)}>Connect</button>
  );

  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>Connected accounts</h2>
      <div className={styles.list}>
        {row(
          "google",
          google.connected && google.avatar ? <Avatar src={google.avatar} name={google.name} size={40} /> : <span className={`${styles.logo} ${styles.logoGoogle}`}>G</span>,
          <>Google {google.connected && <span className={styles.connected}>Connected</span>}</>,
          google.connected ? google.name || "Signed in with Google" : "Sign in with your Google account",
          google.connected ? unlink("google") : link("google")
        )}
        {row(
          "steam",
          steam.connected && steam.avatar ? <Avatar src={steam.avatar} name={steam.name} size={40} /> : <span className={`${styles.logo} ${styles.logoSteam}`}>S</span>,
          <>Steam {steam.connected && <span className={styles.connected}>Connected</span>}</>,
          steam.connected
            ? `${steam.name ? `${steam.name} · ` : ""}${steam.gameCount ?? 0} games${steam.lastSyncedAt ? ` · synced ${timeAgo(new Date(steam.lastSyncedAt).getTime())}` : ""}`
            : "Your library, hours and achievements",
          steam.connected ? (
            <>
              <button type="button" className={`${styles.iconBtn} ${styles.small}`} onClick={sync} disabled={busy === "sync"} aria-label="Sync with Steam now" title="Sync with Steam now">
                <RefreshCw size={14} />
              </button>
              {unlink("steam")}
            </>
          ) : link("steam")
        )}
        <div className={`${styles.row} ${styles.dim}`}>
          <span className={`${styles.logo} ${styles.logoEpic}`}>E</span>
          <span className={styles.rowText}>
            <span className={styles.rowName}>Epic Games</span>
            <span className={styles.rowSub}>Linking Epic is on the way.</span>
          </span>
          <span className={styles.soon}>Coming soon</span>
        </div>
      </div>
      {note && <p className={styles.ok}>{note}</p>}
      {error && <p className={styles.err} role="alert">{error}</p>}
    </section>
  );
}
