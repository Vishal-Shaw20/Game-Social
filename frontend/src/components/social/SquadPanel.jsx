import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, Check, Hash, Headphones, HeadphoneOff, Mic, MicOff, Phone, PhoneOff,
  Plus, Settings, Users, X
} from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { ensureConnected, useSocketEvent } from "../../realtime/socket";
import FriendsView, { Avatar } from "./FriendsView";
import ChatView from "./ChatView";
import VoicePanel from "./VoicePanel";
import { useVoice } from "../../realtime/voiceContext";
import styles from "./Squad.module.css";

const API_URL = import.meta.env.VITE_API_URL;
const api = (path, options = {}) => fetch(`${API_URL}${path}`, { credentials: "include", ...options });

const nameOf = (u) => u?.displayName || u?.username || "Someone";
export const MAX_GROUP_MEMBERS = 10;

const titleOf = (conv, meId) => {
  if (conv.type === "group") {
    return (
      conv.name ||
      conv.members.filter((m) => String(m._id) !== String(meId)).map(nameOf).join(", ") ||
      "Group"
    );
  }
  return nameOf(conv.other);
};

/**
 * The Squad tab: conversations on the left, friends or an open chat in the
 * middle, and who's active on the right.
 *
 * Everything updates live over the shared socket: presence, new messages,
 * friend requests and conversation changes. The open conversation is kept
 * in the URL (?c=<id>) so a notification can link straight to a chat.
 */
export default function SquadPanel() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const voice = useVoice();
  const me = currentUser ?? {};
  const [params, setParams] = useSearchParams();
  const openId = params.get("c");

  const [friends, setFriends] = useState([]);
  const [requests, setRequests] = useState({ incoming: [], outgoing: [] });
  const [conversations, setConversations] = useState([]);
  const [presence, setPresence] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [convFilter, setConvFilter] = useState("");
  const [groupOpen, setGroupOpen] = useState(false);

  /* ── Loading ── */
  const loadFriends = useCallback(async () => {
    try {
      const [f, r] = await Promise.all([api("/api/friends"), api("/api/friends/requests")]);
      if (f.ok) {
        const list = await f.json();
        setFriends(list);
        setPresence((prev) => {
          const next = { ...prev };
          for (const friend of list) if (friend.presence) next[String(friend._id)] = friend.presence;
          return next;
        });
      }
      if (r.ok) setRequests(await r.json());
    } catch { /* ignored */ }
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const res = await api("/api/conversations");
      if (res.ok) setConversations(await res.json());
    } catch { /* ignored */ }
  }, []);

  useEffect(() => {
    loadFriends();
    loadConversations();
    ensureConnected();
  }, [loadFriends, loadConversations]);

  /* ── Live updates ── */
  useSocketEvent("friends-changed", useCallback(() => loadFriends(), [loadFriends]));
  useSocketEvent("conversation-changed", useCallback(() => loadConversations(), [loadConversations]));

  useSocketEvent(
    "presence",
    useCallback((p) => {
      setPresence((prev) => ({
        ...prev,
        [String(p.userId)]: { ...(prev[String(p.userId)] ?? {}), ...p }
      }));
    }, [])
  );

  useSocketEvent(
    "conv-message",
    useCallback(
      (msg) => {
        setConversations((prev) => {
          const i = prev.findIndex((c) => String(c._id) === String(msg.conversationId));
          if (i < 0) {
            loadConversations(); // a conversation we don't know about yet
            return prev;
          }
          const conv = {
            ...prev[i],
            lastMessage: { text: msg.text, userId: msg.from.id, at: msg.ts },
            lastMessageAt: msg.ts,
            unread:
              String(msg.conversationId) === String(openId) || msg.from.id === String(me._id)
                ? 0
                : (prev[i].unread ?? 0) + 1
          };
          // Most recent conversation first.
          return [conv, ...prev.filter((_, idx) => idx !== i)];
        });
      },
      [loadConversations, openId, me._id]
    )
  );

  useSocketEvent(
    "conversation-read",
    useCallback(({ conversationId }) => {
      setConversations((prev) =>
        prev.map((c) => (String(c._id) === String(conversationId) ? { ...c, unread: 0 } : c))
      );
    }, [])
  );

  /* Tell the server we're still here, so "online" doesn't decay to "idle"
     while someone is reading. */
  useEffect(() => {
    const ping = () => ensureConnected().emit("active");
    const events = ["click", "keydown", "pointermove"];
    let last = 0;
    const handler = () => {
      if (Date.now() - last < 60_000) return;
      last = Date.now();
      ping();
    };
    events.forEach((e) => window.addEventListener(e, handler, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, handler));
  }, []);

  /* ── Actions ── */
  async function act(key, path, method, failMsg, body) {
    setBusy(key);
    setError(null);
    try {
      const res = await api(path, {
        method,
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {})
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || failMsg);
        return null;
      }
      await loadFriends();
      return res.status === 204 ? {} : await res.json().catch(() => ({}));
    } catch {
      setError(failMsg);
      return null;
    } finally {
      setBusy(null);
    }
  }

  const openConversation = useCallback(
    (id) => {
      setParams((p) => {
        const q = new URLSearchParams(p);
        if (id) q.set("c", id);
        else q.delete("c");
        return q;
      }, { replace: true });
    },
    [setParams]
  );

  async function messageFriend(friend) {
    setBusy(friend._id);
    try {
      const res = await api(`/api/conversations/dm/${friend._id}`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Couldn't open that conversation");
        return;
      }
      const conv = await res.json();
      await loadConversations();
      openConversation(conv._id);
    } finally {
      setBusy(null);
    }
  }

  async function createGroup(name, memberIds) {
    const res = await act("group", "/api/conversations/group", "POST", "Couldn't create the group", {
      name,
      memberIds
    });
    if (res?._id) {
      await loadConversations();
      openConversation(res._id);
      setGroupOpen(false);
    }
  }

  function removeFriend(friend) {
    if (!window.confirm(`Remove ${nameOf(friend)} from your friends?`)) return;
    act(friend._id, `/api/friends/remove/${friend._id}`, "DELETE", "Failed to remove friend");
  }

  async function leaveGroup(conv) {
    if (!window.confirm(`Leave ${titleOf(conv, me._id)}?`)) return;
    await api(`/api/conversations/${conv._id}/members/${me._id}`, { method: "DELETE" });
    await loadConversations();
    if (String(openId) === String(conv._id)) openConversation(null);
  }

  const markConversationRead = useCallback((id) => {
    setConversations((prev) =>
      prev.map((c) => (String(c._id) === String(id) ? { ...c, unread: 0 } : c))
    );
  }, []);

  /* ── Derived ── */
  const openConv = useMemo(
    () => conversations.find((c) => String(c._id) === String(openId)) ?? null,
    [conversations, openId]
  );

  const shownConversations = useMemo(() => {
    const q = convFilter.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => titleOf(c, me._id).toLowerCase().includes(q));
  }, [conversations, convFilter, me._id]);

  // Active Now: friends in a game, or otherwise online.
  const activeNow = friends
    .map((f) => ({ ...f, presence: presence[String(f._id)] ?? f.presence }))
    .filter((f) => f.presence?.playing || f.presence?.status === "online")
    .sort((a, b) => (b.presence?.playing ? 1 : 0) - (a.presence?.playing ? 1 : 0));

  return (
    <div className={styles.squad}>
      {/* ── Left: conversations ── */}
      <aside className={styles.sidebar}>
        <input
          className={styles.findInput}
          placeholder="Find or start a conversation"
          value={convFilter}
          onChange={(e) => setConvFilter(e.target.value)}
        />

        <button
          type="button"
          className={`${styles.navItem} ${!openId ? styles.navItemActive : ""}`}
          onClick={() => openConversation(null)}
        >
          <Users size={16} className={styles.navIcon} aria-hidden="true" />
          <span className={styles.navLabel}>Friends</span>
          {requests.incoming.length > 0 && <span className={styles.pill}>{requests.incoming.length}</span>}
        </button>

        <div className={styles.sidebarHeader}>
          <span>Direct messages</span>
          <button
            type="button"
            className={styles.iconBtn}
            title="New group chat"
            aria-label="New group chat"
            onClick={() => setGroupOpen(true)}
          >
            <Plus size={16} />
          </button>
        </div>

        <div className={styles.convList}>
          {shownConversations.length === 0 && (
            <p className={styles.mutedSmall}>
              {conversations.length === 0 ? "No conversations yet." : "Nothing matches that."}
            </p>
          )}
          {shownConversations.map((c) => {
            const other = c.type === "dm" ? c.other : null;
            const p = other ? presence[String(other._id)] ?? other.presence : null;
            return (
              <button
                key={c._id}
                type="button"
                className={`${styles.convItem} ${String(c._id) === String(openId) ? styles.convItemActive : ""}`}
                onClick={() => openConversation(c._id)}
              >
                {c.type === "dm" ? (
                  <Avatar user={other} presence={p ?? { status: "offline" }} size={32} />
                ) : (
                  <div className={styles.groupAvatar} aria-hidden="true"><Hash size={15} /></div>
                )}
                <span className={styles.convText}>
                  <span className={styles.convName}>{titleOf(c, me._id)}</span>
                  {c.type === "group" && (
                    <span className={styles.convSub}>{c.members.length} members</span>
                  )}
                </span>
                {c.unread > 0 && <span className={styles.unread}>{c.unread}</span>}
              </button>
            );
          })}
        </div>

        {/* Voice controls: present, but switched off for now. */}
        <div className={styles.voiceBar}>
          <div className={styles.voiceUser}>
            <Avatar user={me} presence={{ status: "online" }} size={28} />
            <span className={styles.voiceName}>{nameOf(me)}</span>
          </div>
          <div className={styles.voiceButtons}>
            {/* Voice controls live in the notification bar (VoiceDock), so
                they're reachable from every page; only settings here. */}
            <button
              type="button"
              className={styles.voiceBtn}
              title="Profile settings"
              aria-label="Profile settings"
              onClick={() => navigate("/dashboard")}
            >
              <Settings size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Middle: friends list or the open chat ── */}
      <main className={styles.main}>
        {error && <div className={styles.errorBar}>{error}</div>}

        {openConv ? (
          <>
            <header className={styles.chatHeader}>
              <button
                type="button"
                className={styles.backBtn}
                onClick={() => openConversation(null)}
                title="Back"
                aria-label="Back"
              >
                <ArrowLeft size={16} />
              </button>
              {openConv.type === "dm" ? (
                <Avatar
                  user={openConv.other}
                  presence={presence[String(openConv.other?._id)] ?? { status: "offline" }}
                  size={32}
                />
              ) : (
                <div className={styles.groupAvatar} aria-hidden="true"><Hash size={15} /></div>
              )}
              <div className={styles.chatHeaderText}>
                <div className={styles.chatTitle}>{titleOf(openConv, me._id)}</div>
                <div className={styles.chatSub}>
                  {openConv.type === "group"
                    ? `${openConv.members.length} members`
                    : presence[String(openConv.other?._id)]?.playing
                      ? `Playing ${presence[String(openConv.other?._id)].playing}`
                      : (presence[String(openConv.other?._id)]?.status ?? "offline")}
                </div>
              </div>
              <div className={styles.chatHeaderActions}>
                <button
                  type="button"
                  className={`${styles.voiceBtn} ${voice.isIn(`conv:${openConv._id}`) ? styles.voiceBtnLive : ""}`}
                  disabled={!voice.enabled}
                  onClick={() =>
                    voice.isIn(`conv:${openConv._id}`)
                      ? voice.leave()
                      : voice.join(`conv:${openConv._id}`, titleOf(openConv, me._id))
                  }
                  title={
                    !voice.enabled
                      ? "Voice chat is switched off"
                      : voice.isIn(`conv:${openConv._id}`)
                        ? "Leave voice"
                        : "Start voice"
                  }
                  aria-label="Voice"
                >
                  {voice.isIn(`conv:${openConv._id}`) ? <PhoneOff size={15} /> : <Phone size={15} />}
                </button>
                {openConv.type === "group" && (
                  <button type="button" className={styles.ghostBtn} onClick={() => leaveGroup(openConv)}>
                    Leave
                  </button>
                )}
              </div>
            </header>
            <div className={styles.voiceSlot}>
              <VoicePanel
                roomId={`conv:${openConv._id}`}
                label={titleOf(openConv, me._id)}
                title="Voice"
                compact
              />
            </div>
            <ChatView
              key={openConv._id}
              conversation={openConv}
              me={me}
              onRead={markConversationRead}
            />
          </>
        ) : (
          <FriendsView
            friends={friends}
            requests={requests}
            presence={presence}
            busy={busy}
            onMessage={messageFriend}
            onAccept={(id) => act(id, `/api/friends/requests/${id}/accept`, "POST", "Failed to accept request")}
            onDecline={(id) => act(id, `/api/friends/requests/${id}/decline`, "POST", "Failed to decline request")}
            onCancel={(id) => act(id, `/api/friends/requests/${id}`, "DELETE", "Failed to cancel request")}
            onRemove={removeFriend}
            onSendRequest={(id) => act(id, `/api/friends/request/${id}`, "POST", "Failed to send friend request")}
          />
        )}
      </main>

      {/* ── Right: Active Now, or the members of an open group ── */}
      <aside className={styles.rightColumn}>
        {openConv?.type === "group" ? (
          <>
            <div className={styles.rightTitle}>Members — {openConv.members.length}</div>
            {openConv.members.map((m) => (
              <div key={m._id} className={styles.activeRow}>
                <Avatar user={m} presence={presence[String(m._id)] ?? { status: "offline" }} size={32} />
                <span className={styles.rowText}>
                  <span className={styles.rowName}>{nameOf(m)}</span>
                  <span className={styles.rowSub}>
                    {presence[String(m._id)]?.playing ?? presence[String(m._id)]?.status ?? "offline"}
                  </span>
                </span>
              </div>
            ))}
          </>
        ) : (
          <>
            <div className={styles.rightTitle}>Active Now</div>
            {activeNow.length === 0 ? (
              <p className={styles.mutedSmall}>
                It's quiet for now. When a friend starts playing, they'll show up here.
              </p>
            ) : (
              activeNow.map((f) => (
                <button
                  key={f._id}
                  type="button"
                  className={styles.activeCard}
                  onClick={() => messageFriend(f)}
                  title={`Message ${nameOf(f)}`}
                >
                  <Avatar user={f} presence={f.presence} size={36} />
                  <span className={styles.rowText}>
                    <span className={styles.rowName}>{nameOf(f)}</span>
                    <span className={styles.rowSub}>
                      {f.presence?.playing ? `Playing ${f.presence.playing}` : "Online"}
                    </span>
                  </span>
                </button>
              ))
            )}
          </>
        )}
      </aside>

      {groupOpen && (
        <GroupDialog
          friends={friends}
          onClose={() => setGroupOpen(false)}
          onCreate={createGroup}
          busy={busy === "group"}
        />
      )}
    </div>
  );
}

/** Pick friends (and optionally a name) for a new group chat. */
function GroupDialog({ friends, onClose, onCreate, busy }) {
  const [name, setName] = useState("");
  const [picked, setPicked] = useState([]);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = (id) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));

  const full = picked.length + 1 >= MAX_GROUP_MEMBERS;
  const shown = friends.filter(
    (f) => !filter.trim() || nameOf(f).toLowerCase().includes(filter.trim().toLowerCase())
  );

  return (
    <div className={styles.dialogBackdrop} onClick={onClose}>
      <div
        className={styles.dialog}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="New group chat"
      >
        <div className={styles.dialogHead}>
          <div>
            <div className={styles.dialogTitle}>New group chat</div>
            <div className={styles.mutedSmall}>Pick the friends to include.</div>
          </div>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <input
          className={styles.search}
          placeholder="Group name (optional)"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
        />

        {picked.length > 0 && (
          <div className={styles.chips}>
            {picked.map((id) => {
              const f = friends.find((x) => String(x._id) === String(id));
              return (
                <button key={id} type="button" className={styles.chip} onClick={() => toggle(id)}>
                  {nameOf(f)}
                  <X size={12} />
                </button>
              );
            })}
          </div>
        )}

        <input
          className={styles.search}
          placeholder="Search friends"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />

        <div className={styles.dialogList}>
          {friends.length === 0 && <p className={styles.muted}>Add some friends first.</p>}
          {friends.length > 0 && shown.length === 0 && (
            <p className={styles.muted}>No friends match that.</p>
          )}
          {shown.map((f) => {
            const on = picked.includes(f._id);
            return (
              <button
                key={f._id}
                type="button"
                className={`${styles.pickRow} ${on ? styles.pickRowOn : ""}`}
                disabled={!on && full}
                aria-pressed={on}
                onClick={() => toggle(f._id)}
              >
                <Avatar user={f} size={32} />
                <span className={styles.rowText}>
                  <span className={styles.rowName}>{nameOf(f)}</span>
                  <span className={styles.rowSub}>@{f.username}</span>
                </span>
                <span className={`${styles.tick} ${on ? styles.tickOn : ""}`} aria-hidden="true">
                  {on ? <Check size={13} /> : null}
                </span>
              </button>
            );
          })}
        </div>

        <div className={styles.dialogFooter}>
          <span className={styles.mutedSmall}>
            {picked.length + 1} of {MAX_GROUP_MEMBERS} people
          </span>
          <div className={styles.rowActions}>
            <button type="button" className={styles.ghostBtn} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className={styles.primaryBtn}
              disabled={picked.length === 0 || busy}
              onClick={() => onCreate(name, picked)}
            >
              {busy ? "Creating\u2026" : "Create group"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
