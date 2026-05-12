import React, { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  Home,
  LayoutDashboard,
  LogIn,
  Library,
  MessageSquare
} from "lucide-react";
import styles from "./SidebarLeft.module.css";

export default function SidebarLeft() {
  const [authenticated, setAuthenticated] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_URL}/auth/user`, {
      credentials: "include"
    })
      .then(r => (r.ok ? r.json() : null))
      .then(user => setAuthenticated(Boolean(user)))
      .catch(() => {});
  }, []);

  const links = [
    { to: "/", label: "Home", icon: Home },
    authenticated
      ? { to: "/dashboard", label: "Profile", icon: LayoutDashboard }
      : { to: "/login", label: "Login", icon: LogIn },
    { to: "/library", label: "Library", icon: Library },
    { to: "/social", label: "Social", icon: MessageSquare }
  ];

  return (
    <div className={styles.hoverRail}>
      <div className={styles.brandVertical} onClick={() => navigate("/")}>
        GAMESOCIAL
      </div>

      {links.map(l => (
        <NavLink key={l.to} to={l.to} className={styles.hoverBtn}>
          <span className={styles.icon}>
            <l.icon size={18} strokeWidth={1.75} />
          </span>
          <span className={styles.label}>{l.label}</span>
        </NavLink>
      ))}
    </div>
  );
}
