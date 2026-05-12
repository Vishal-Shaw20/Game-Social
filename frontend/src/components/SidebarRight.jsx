import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useSocket } from "../hooks/useSocket";
import styles from "./SidebarRight.module.css";
// import { useVoiceChat } from "../hooks/useVoiceChat";  // ← Commented out

const POLL_INTERVAL = 8000;
const SIDEBAR_WIDTH = 220;
const HANDLE_WIDTH = 32;

export default function SidebarRight() {
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const lastIdsRef = useRef([]);

  // Game page detection
  const isGamePage = location.pathname.startsWith("/game/");
  const gameId = isGamePage ? params.id : null;
  const [gameName, setGameName] = useState(null);

  // Auth and Socket
  const {
    currentUser,
    isAuthenticated,
    authChecked,
    requireLogin,
  } = useAuth();

  const { socket, connected } = useSocket(
    authChecked,
    isAuthenticated,
    currentUser
  );

  // Fetch game name when on game page
  useEffect(() => {
    if (!isGamePage || !gameId) {
      setGameName(null);
      return;
    }

    let cancelled = false;

    async function fetchGameName() {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL}/api/gameLookup/${gameId}`);
        if (!res.ok) return;
        const game = await res.json();
        if (!cancelled && game?.name) {
          setGameName(game.name);
        }
      } catch (err) {
        console.error("Failed to fetch game name", err);
      }
    }

    fetchGameName();
    return () => { cancelled = true; };
  }, [isGamePage, gameId]);

  async function fetchNotifications() {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/notifications`, {
        credentials: "include"
      });
      if (!res.ok) return;

      const data = await res.json();
      const newIds = data.map(n => n._id);

      const changed =
        newIds.length !== lastIdsRef.current.length ||
        newIds.some((id, i) => id !== lastIdsRef.current[i]);

      if (changed) {
        lastIdsRef.current = newIds;
        setNotifications(data);
      }
    } catch {}
  }

  useEffect(() => {
    fetchNotifications();
    const id = setInterval(fetchNotifications, POLL_INTERVAL);
    return () => clearInterval(id);
  }, []);

  async function openNotification(n) {
    await fetch(`${import.meta.env.VITE_API_URL}/api/notifications/${n._id}/read`, {
      method: "POST",
      credentials: "include"
    });
    navigate(n.url);
  }

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <aside className={`${styles.rightSidebar} ${open ? styles.open : ""}`}>
      {/* Toggle handle */}
      <div className={styles.toggle} onClick={() => setOpen(o => !o)}>
        {open ? "→" : "←"}
      </div>

      {/* Panel */}
      <div className={styles.panel}>
        <div className={styles.header}>
          <h3>Notifications</h3>
          {unreadCount > 0 && <span className={styles.badge}>{unreadCount}</span>}
        </div>

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
    </aside>
  );
}
