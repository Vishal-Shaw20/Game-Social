import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MessageSquare, MoreVertical } from "lucide-react";
import styles from "./Squad.module.css";

const API_URL = import.meta.env.VITE_API_URL;

const nameOf = (u) => u?.displayName || u?.username || "Someone";
const initial = (n) => (n || "?").trim().charAt(0).toUpperCase();

const STATUS_LABEL = { online: "Online", idle: "Idle", offline: "Offline" };

export function Avatar({ user, presence, size = 36 }) {
  const status = presence?.status ?? "offline";
  return (
    <div className={styles.avatarWrap} style={{ width: size, height: size }}>
      {user?.avatar ? (
        <img src={user.avatar} alt="" className={styles.avatar} />
      ) : (
        <div className={styles.avatarFallback}>{initial(nameOf(user))}</div>
      )}
      {presence && <span className={`${styles.dot} ${styles[`dot_${status}`]}`} title={STATUS_LABEL[status]} />}
    </div>
  );
}

/** Status line under a name: what they're playing, or online/idle/offline. */
function statusLine(presence) {
  if (presence?.playing) return `Playing ${presence.playing}`;
  return STATUS_LABEL[presence?.status ?? "offline"];
}

/**
 * The friends list with Discord's four views: Online, All, Pending and
 * Add Friend. Pending covers both directions; Add Friend searches by
 * username and shows what state you're in with that person.
 */
export default function FriendsView({
  friends,
  requests,
  presence,
  busy,
  onMessage,
  onAccept,
  onDecline,
  onCancel,
  onRemove,
  onSendRequest
}) {
  const navigate = useNavigate();
  const [view, setView] = useState("online");
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);

  const pendingCount = requests.incoming.length + requests.outgoing.length;

  const withPresence = friends.map((f) => ({ ...f, presence: presence[String(f._id)] ?? f.presence }));
  const matches = (u) =>
    !filter.trim() ||
    nameOf(u).toLowerCase().includes(filter.toLowerCase()) ||
    (u.username ?? "").toLowerCase().includes(filter.toLowerCase());

  const shown = withPresence
    .filter(matches)
    .filter((f) => (view === "online" ? f.presence?.status && f.presence.status !== "offline" : true))
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));

  /* Add Friend: search by username. */
  useEffect(() => {
    if (view !== "add" || query.trim().length < 3) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        setSearching(true);
        setError(null);
        const res = await fetch(
          `${API_URL}/api/users/search?username=${encodeURIComponent(query)}`,
          { credentials: "include", signal: controller.signal }
        );
        if (res.status === 429) {
          setError("Too many searches, please slow down");
          return;
        }
        if (!res.ok) return;
        setResults(await res.json());
      } catch (err) {
        if (err.name !== "AbortError") setError("Search failed");
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [view, query, requests, friends]);

  const openProfile = (username) => username && navigate(`/u/${username}`);

  return (
    <div className={styles.friends}>
      <header className={styles.friendsHeader}>
        <span className={styles.friendsTitle}>Friends</span>
        <nav className={styles.viewTabs}>
          {[
            ["online", "Online"],
            ["all", "All"],
            ["pending", "Pending"]
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`${styles.viewTab} ${view === key ? styles.viewTabActive : ""}`}
              onClick={() => setView(key)}
            >
              {label}
              {key === "pending" && pendingCount > 0 && (
                <span className={styles.pill}>{pendingCount}</span>
              )}
            </button>
          ))}
          <button
            type="button"
            className={`${styles.addFriendBtn} ${view === "add" ? styles.addFriendBtnActive : ""}`}
            onClick={() => setView("add")}
          >
            Add Friend
          </button>
        </nav>
      </header>

      <div className={styles.friendsBody}>
        {view === "add" ? (
          <>
            <input
              className={styles.search}
              placeholder="Find someone by username…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            {searching && <p className={styles.muted}>Searching…</p>}
            {error && <p className={styles.error}>{error}</p>}
            {!searching && query.trim().length >= 3 && results.length === 0 && (
              <p className={styles.muted}>No one found with that username.</p>
            )}
            {results.map((u) => (
              <div key={u._id} className={styles.row}>
                <button type="button" className={styles.rowMain} onClick={() => openProfile(u.username)}>
                  <Avatar user={u} />
                  <span className={styles.rowText}>
                    <span className={styles.rowName}>{nameOf(u)}</span>
                    <span className={styles.rowSub}>@{u.username}</span>
                  </span>
                </button>
                <div className={styles.rowActions}>
                  {u.relation === "friend" && <span className={styles.muted}>Friends</span>}
                  {u.relation === "outgoing" && (
                    <button className={styles.ghostBtn} disabled={busy === u.requestId} onClick={() => onCancel(u.requestId)}>
                      Requested · Cancel
                    </button>
                  )}
                  {u.relation === "incoming" && (
                    <button className={styles.primaryBtn} disabled={busy === u.requestId} onClick={() => onAccept(u.requestId)}>
                      Accept
                    </button>
                  )}
                  {(!u.relation || u.relation === "none") && (
                    <button className={styles.primaryBtn} disabled={busy === u._id} onClick={() => onSendRequest(u._id)}>
                      Add friend
                    </button>
                  )}
                </div>
              </div>
            ))}
          </>
        ) : view === "pending" ? (
          <>
            {pendingCount === 0 && <p className={styles.muted}>No pending requests.</p>}

            {requests.incoming.length > 0 && (
              <div className={styles.sectionLabel}>Incoming — {requests.incoming.length}</div>
            )}
            {requests.incoming.map((r) => (
              <div key={r._id} className={styles.row}>
                <button type="button" className={styles.rowMain} onClick={() => openProfile(r.from.username)}>
                  <Avatar user={r.from} presence={presence[String(r.from._id)]} />
                  <span className={styles.rowText}>
                    <span className={styles.rowName}>{nameOf(r.from)}</span>
                    <span className={styles.rowSub}>Incoming friend request</span>
                  </span>
                </button>
                <div className={styles.rowActions}>
                  <button className={styles.primaryBtn} disabled={busy === r._id} onClick={() => onAccept(r._id)}>
                    Accept
                  </button>
                  <button className={styles.ghostBtn} disabled={busy === r._id} onClick={() => onDecline(r._id)}>
                    Decline
                  </button>
                </div>
              </div>
            ))}

            {requests.outgoing.length > 0 && (
              <div className={styles.sectionLabel}>Sent — {requests.outgoing.length}</div>
            )}
            {requests.outgoing.map((r) => (
              <div key={r._id} className={styles.row}>
                <button type="button" className={styles.rowMain} onClick={() => openProfile(r.to.username)}>
                  <Avatar user={r.to} presence={presence[String(r.to._id)]} />
                  <span className={styles.rowText}>
                    <span className={styles.rowName}>{nameOf(r.to)}</span>
                    <span className={styles.rowSub}>Request sent</span>
                  </span>
                </button>
                <div className={styles.rowActions}>
                  <button className={styles.ghostBtn} disabled={busy === r._id} onClick={() => onCancel(r._id)}>
                    Cancel
                  </button>
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
            <input
              className={styles.search}
              placeholder="Search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <div className={styles.sectionLabel}>
              {view === "online" ? "Online" : "All friends"} — {shown.length}
            </div>

            {friends.length === 0 && (
              <p className={styles.muted}>
                No friends yet. Use <strong>Add Friend</strong> to send someone a request.
              </p>
            )}
            {friends.length > 0 && shown.length === 0 && (
              <p className={styles.muted}>
                {view === "online" ? "No one's online right now." : "No friends match that search."}
              </p>
            )}

            {shown.map((f) => (
              <div key={f._id} className={styles.row}>
                <button type="button" className={styles.rowMain} onClick={() => openProfile(f.username)}>
                  <Avatar user={f} presence={f.presence ?? { status: "offline" }} />
                  <span className={styles.rowText}>
                    <span className={styles.rowName}>{nameOf(f)}</span>
                    <span className={styles.rowSub}>{f.customStatus?.text ? `“${f.customStatus.text}” · ${statusLine(f.presence)}` : statusLine(f.presence)}</span>
                  </span>
                </button>
                <div className={styles.rowActions}>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    title={`Message ${nameOf(f)}`}
                    onClick={() => onMessage(f)}
                    aria-label={`Message ${nameOf(f)}`}
                  >
                    <MessageSquare size={15} />
                  </button>
                  <RowMenu friend={f} onRemove={onRemove} onMessage={onMessage} onProfile={openProfile} />
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/** The "⋮" menu on a friend row. */
function RowMenu({ friend, onRemove, onMessage, onProfile }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  return (
    <div className={styles.menuWrap}>
      <button
        type="button"
        className={styles.iconBtn}
        title="More"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-label="More options"
      >
        <MoreVertical size={15} />
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          <button type="button" role="menuitem" onClick={() => onProfile(friend.username)}>
            View profile
          </button>
          <button type="button" role="menuitem" onClick={() => onMessage(friend)}>
            Message
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.menuDanger}
            onClick={() => onRemove(friend)}
          >
            Remove friend
          </button>
        </div>
      )}
    </div>
  );
}
