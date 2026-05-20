import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./SidebarRight.module.css";

const POLL_INTERVAL = 8000;

export default function SidebarRight() {
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(true);
  const navigate = useNavigate();
  const lastIdsRef = useRef([]);

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
    } catch { /* ignored */ }
  }

  useEffect(() => {
    fetchNotifications(); // eslint-disable-line react-hooks/set-state-in-effect
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
