import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Check, Link2, MessageSquare, Pencil, UserCheck, UserPlus, X } from "lucide-react";
import { useArtTint } from "../hooks/useArtTint";
import { gameArt } from "../utils/gameArt";
import { VERDICT_META, date } from "./game/format";
import { useQuickLook } from "./quicklook/quickLookContext";
import ProfileHero from "./profile/ProfileHero";
import Avatar from "./profile/Avatar";
import styles from "./profile/Profile.module.css";

const API = import.meta.env.VITE_API_URL;

/*
 * Someone's public profile (/u/:username), in the same language as your own:
 * a hero with them (their banner game's art, or their most played games'),
 * their status, bio and favourite game; a way to be friends (add, accept,
 * cancel), and a link to share it; their reviews (a quick look on each
 * game) and their friends. On your own, it says so and links to editing.
 */
export default function UserProfile() {
  const { username } = useParams();
  const quickLook = useQuickLook();
  const [got, setGot] = useState({ key: null, profile: null, reviews: [], error: null });
  const [relation, setRelation] = useState({ key: null, value: null, requestId: null });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const enc = encodeURIComponent(username);
    Promise.all([
      fetch(`${API}/api/users/${enc}/profile`, { credentials: "include" }).then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
      fetch(`${API}/api/reviews/user/${enc}`, { credentials: "include" }).then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ])
      .then(([profile, reviews]) => !cancelled && setGot({ key: username, profile, reviews: Array.isArray(reviews) ? reviews : [], error: null }))
      .catch((status) => !cancelled && setGot({ key: username, profile: null, reviews: [], error: status === 404 ? "No one here: that username doesn't exist." : "Couldn't load this profile." }));
    return () => { cancelled = true; };
  }, [username]);

  const ready = got.key === username;
  const p = ready ? got.profile : null;
  const tint = useArtTint(p ? (p.banner?.cover ? [p.banner.cover] : p.wall.slice(0, 3)) : []);

  if (!ready) return <div className={styles.state}>Loading profile…</div>;
  if (!p) return <div className={`${styles.state} ${styles.stateError}`}>{got.error}</div>;

  const rel = relation.key === username ? relation : { value: p.relation, requestId: p.requestId };
  const setRel = (value, requestId = null) => setRelation({ key: username, value, requestId });

  const friendAction = async (method, path, next) => {
    setBusy(true);
    setActionError(null);
    try {
      const r = await fetch(`${API}/api/friends/${path}`, { method, credentials: "include" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "That didn't work. Try again.");
      next(j);
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/u/${p.username}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* no clipboard: nothing to do */
    }
  };

  const small = `${styles.small}`;
  let friendButtons = null;
  if (rel.value === "self") {
    friendButtons = <Link className={styles.btnAccent} to="/dashboard"><Pencil size={14} /> Edit your profile</Link>;
  } else if (rel.value === "guest") {
    friendButtons = <Link className={styles.btnGhost} to="/login"><UserPlus size={15} /> Sign in to add friend</Link>;
  } else if (rel.value === "none") {
    friendButtons = (
      <button type="button" className={styles.btnAccent} disabled={busy}
        onClick={() => friendAction("POST", `request/${p.id}`, (j) => setRel(j.status === "friends" ? "friend" : "outgoing", j.requestId ?? null))}>
        <UserPlus size={15} /> Add friend
      </button>
    );
  } else if (rel.value === "outgoing") {
    friendButtons = (
      <>
        <span className={`${styles.btnGhost} ${small}`} aria-live="polite"><Check size={14} /> Request sent</span>
        {rel.requestId && (
          <button type="button" className={`${styles.btnDanger} ${small}`} disabled={busy}
            onClick={() => friendAction("DELETE", `requests/${rel.requestId}`, () => setRel("none"))}>
            Cancel
          </button>
        )}
      </>
    );
  } else if (rel.value === "incoming") {
    friendButtons = (
      <>
        <button type="button" className={styles.btnAccent} disabled={busy}
          onClick={() => friendAction("POST", `requests/${rel.requestId}/accept`, () => setRel("friend"))}>
          <UserCheck size={15} /> Accept request
        </button>
        <button type="button" className={`${styles.iconBtn}`} disabled={busy} aria-label="Decline request" title="Decline request"
          onClick={() => friendAction("POST", `requests/${rel.requestId}/decline`, () => setRel("none"))}>
          <X size={15} />
        </button>
      </>
    );
  } else if (rel.value === "friend") {
    friendButtons = (
      <>
        <span className={styles.btnGhost}><UserCheck size={15} /> Friends</span>
        <Link className={styles.btnAccent} to="/social"><MessageSquare size={14} /> Message</Link>
      </>
    );
  }

  return (
    <div className={styles.page} style={tint ? { "--accent": tint } : undefined}>
      {rel.value === "self" && (
        <p className={styles.selfNote}>This is how others see your profile. <Link to="/dashboard">Back to your profile</Link></p>
      )}

      <ProfileHero
        person={p}
        stats={{ reviews: p.stats.reviews, friends: p.stats.friends }}
        wall={p.wall}
        actions={
          <>
            {friendButtons}
            <button type="button" className={styles.iconBtn} onClick={copy} aria-label="Copy link to this profile" title={copied ? "Copied" : "Copy link to this profile"}>
              {copied ? <Check size={15} /> : <Link2 size={15} />}
            </button>
          </>
        }
      />
      {actionError && <p className={styles.err} role="alert">{actionError}</p>}

      <div className={styles.columns}>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>
            Reviews <span className={styles.count}>{got.reviews.length}</span>
          </h2>
          {got.reviews.length ? (
            <div className={styles.list}>
              {got.reviews.slice(0, 12).map((r) => {
                const v = VERDICT_META[r.verdict];
                const text = r.title || r.body || "";
                return (
                  <button
                    key={r._id}
                    type="button"
                    className={styles.reviewItem}
                    onClick={() => quickLook({ rawgId: r.rawgId, name: r.game?.name, cover: r.game?.cover })}
                    title={r.game?.name ? `Quick look: ${r.game.name}` : "Quick look"}
                  >
                    {r.game?.cover ? <img className={styles.reviewThumb} src={gameArt(r.game.cover, 420)} alt="" /> : <span className={styles.reviewThumb} />}
                    <span className={styles.rowText}>
                      <span className={styles.reviewMeta}>
                        <span className={styles.rowName}>{r.game?.name ?? "A game"}</span>
                        {v && <span className={styles.verdictChip} style={{ "--v": v.color }}>{v.label}</span>}
                      </span>
                      {text && <span className={styles.reviewExcerpt}>{text}</span>}
                      <span className={styles.rowSub}>{date(r.createdAt)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className={styles.muted}>No reviews yet.</p>
          )}
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>
            Friends <span className={styles.count}>{p.stats.friends}</span>
          </h2>
          {p.friends.length ? (
            <div className={styles.list}>
              {p.friends.map((f) =>
                f.username ? (
                  <Link key={f.id} className={styles.row} to={`/u/${f.username}`}>
                    <Avatar src={f.avatar} name={f.name} size={36} />
                    <span className={styles.rowText}>
                      <span className={styles.rowName}>{f.name}</span>
                      <span className={styles.rowSub}>@{f.username}</span>
                    </span>
                  </Link>
                ) : null
              )}
            </div>
          ) : (
            <p className={styles.muted}>No friends yet.</p>
          )}
        </section>
      </div>
    </div>
  );
}
