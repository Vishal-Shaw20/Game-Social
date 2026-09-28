import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ensureConnected, useSocketEvent } from "../realtime/socket";
import { useVoice } from "../realtime/voiceContext";
import VoiceDock from "./social/VoiceDock";
import styles from "./SidebarRight.module.css";

const API_URL = import.meta.env.VITE_API_URL;

/*
 * Notifications arrive instantly: the list is loaded once, then the server
 * pushes each new one over the shared socket ("notification" event). It
 * reloads after a reconnect, to catch anything sent while offline. (This
 * used to poll every 8 seconds.)
 */
export default function SidebarRight() {
  const voice = useVoice();
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/notifications`, { credentials: "include" });
      if (!res.ok) return;
      setNotifications(await res.json());
    } catch { /* ignored */ }
  }, []);

  useEffect(() => {
    load(); // eslint-disable-line react-hooks/set-state-in-effect
    const s = ensureConnected();
    // Fires on every (re)connect after the first; the initial load covers it.
    const onReconnect = () => load();
    s.io.on("reconnect", onReconnect);
    return () => s.io.off("reconnect", onReconnect);
  }, [load]);

  const onNotification = useCallback((n) => {
    setNotifications(prev =>
      prev.some(p => p._id === n._id) ? prev : [n, ...prev].slice(0, 30)
    );
  }, []);
  useSocketEvent("notification", onNotification);

  async function openNotification(n) {
    if (!n.read) {
      setNotifications(prev => prev.map(p => (p._id === n._id ? { ...p, read: true } : p)));
      fetch(`${API_URL}/api/notifications/${n._id}/read`, {
        method: "POST",
        credentials: "include"
      }).catch(() => {});
    }
    if (n.url) navigate(n.url);
  }

  function markAllRead() {
    setNotifications(prev => prev.map(p => ({ ...p, read: true })));
    fetch(`${API_URL}/api/notifications/read-all`, {
      method: "POST",
      credentials: "include"
    }).catch(() => {});
  }

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <aside className={`${styles.rightSidebar} ${open ? styles.open : ""}`}>
      {/* Toggle handle; a dot marks unread notifications while it's closed. */}
      <div className={styles.toggle} onClick={() => setOpen(o => !o)}>
        {open ? "→" : "←"}
        {!open && unreadCount > 0 && <span className={styles.toggleDot} aria-label={`${unreadCount} unread`} />}
        {!open && voice.joined && (
          <span className={styles.toggleVoiceDot} aria-label="In a voice room" />
        )}
      </div>

      {/* Panel: notifications above, the live call below. */}
      <div className={styles.panel}>
        <div className={styles.notifications}>
          <div className={styles.header}>
            <h3>Notifications</h3>
            {unreadCount > 0 && <span className={styles.badge}>{unreadCount}</span>}
          </div>

          {unreadCount > 0 && (
            <button type="button" className={styles.markAll} onClick={markAllRead}>
              Mark all read
            </button>
          )}

          {notifications.length === 0 && (
            <div className={styles.empty}>No notifications</div>
          )}

          {notifications.map(n => (
            <div
              key={n._id}
              className={`${styles.notification} ${n.read ? styles.read : styles.unread}`}
              onClick={() => openNotification(n)}
            >
              <div className={styles.text}>{n.text}</div>
              <div className={styles.time}>
                {new Date(n.createdAt).toLocaleTimeString()}
              </div>
            </div>
          ))}
        </div>

        <VoiceDock />
      </div>
    </aside>
  );
}
