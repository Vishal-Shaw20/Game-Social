import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Check, Eye, Link2, LogOut, Pencil } from "lucide-react";
import { useArtTint } from "../hooks/useArtTint";
import ProfileHero from "./profile/ProfileHero";
import EditProfile from "./profile/EditProfile";
import StatusPanel from "./profile/StatusPanel";
import FriendsPanel from "./profile/FriendsPanel";
import VoicePanel from "./profile/VoicePanel";
import ConnectionsPanel from "./profile/ConnectionsPanel";
import SecurityPanel from "./profile/SecurityPanel";
import NotificationsPanel from "./profile/NotificationsPanel";
import DangerZone from "./profile/DangerZone";
import styles from "./profile/Profile.module.css";

const API = import.meta.env.VITE_API_URL;

/*
 * Your profile (/dashboard), from /api/account: a hero with you (over your
 * banner game's art, or your most played games', in their colour, like the
 * Library), your status, friends, push-to-talk, connected accounts,
 * security (email, password, other devices), notifications, and deleting
 * your account. What you play lives on the Library page, not here.
 */
export default function Dashboard() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  // A Google / Steam sign-up that picked a username for you says so once.
  const [assigned] = useState(() => params.get("usernameAssigned") === "true");

  useEffect(() => {
    if (params.has("usernameAssigned")) setParams({}, { replace: true });
  }, [params, setParams]);

  const load = useCallback(
    () =>
      fetch(`${API}/api/account`, { credentials: "include" })
        .then((r) => {
          if (r.status === 401) {
            navigate("/login", { replace: true });
            return null;
          }
          return r.ok ? r.json() : Promise.reject();
        })
        .then((j) => {
          if (!j) return;
          setData(j);
          setError(null);
        })
        .catch(() => setError("Couldn't load your profile. Try again in a moment.")),
    [navigate]
  );
  useEffect(() => { load(); }, [load]);

  const banner = data?.profile.banner?.cover;
  const tint = useArtTint(banner ? [banner] : data?.wall?.slice(0, 3) ?? []);

  const logout = async () => {
    await fetch(`${API}/auth/logout`, { method: "POST", credentials: "include" }).catch(() => {});
    navigate("/login", { replace: true });
  };

  if (error) return <div className={`${styles.state} ${styles.stateError}`}>{error}</div>;
  if (!data) return <div className={styles.state}>Loading your profile…</div>;

  const { profile } = data;
  const publicPath = profile.username ? `/u/${profile.username}` : null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${publicPath}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* no clipboard (not a secure context): nothing to do */
    }
  };

  return (
    <div className={styles.page} style={tint ? { "--accent": tint } : undefined}>
      {assigned && profile.username && (
        <p className={styles.notice}>
          We picked <b>@{profile.username}</b> for you.
          <button type="button" className={`${styles.btnGhost} ${styles.small}`} onClick={() => setEditing(true)}>Change it</button>
        </p>
      )}

      <ProfileHero
        person={profile}
        stats={data.stats}
        wall={data.wall}
        actions={
          <>
            <button type="button" className={styles.btnAccent} onClick={() => setEditing(true)}>
              <Pencil size={14} /> Edit profile
            </button>
            {publicPath && (
              <Link className={styles.btnGhost} to={publicPath}>
                <Eye size={15} /> View public profile
              </Link>
            )}
            {publicPath && (
              <button type="button" className={styles.iconBtn} onClick={copy} aria-label="Copy link to your public profile" title={copied ? "Copied" : "Copy link to your public profile"}>
                {copied ? <Check size={15} /> : <Link2 size={15} />}
              </button>
            )}
            <button type="button" className={styles.iconBtn} onClick={logout} aria-label="Log out" title="Log out">
              <LogOut size={15} />
            </button>
          </>
        }
      />

      <div className={styles.columns}>
        <div className={styles.col}>
          <StatusPanel key={profile.status?.text ?? ""} status={profile.status} onChange={load} />
          <FriendsPanel friends={data.friends} />
          <VoicePanel />
        </div>
        <div className={styles.col}>
          <ConnectionsPanel connections={data.connections} onChange={load} />
          <SecurityPanel email={profile.email} emailVerified={profile.emailVerified} hasPassword={data.hasPassword} onChange={load} />
          <NotificationsPanel prefs={data.notifications} />
        </div>
      </div>

      <DangerZone username={profile.username} />

      {editing && (
        <EditProfile
          profile={profile}
          accent={tint}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            load();
          }}
        />
      )}
    </div>
  );
}
