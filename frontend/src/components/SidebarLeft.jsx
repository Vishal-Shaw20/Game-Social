import React, { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Home,
  LayoutDashboard,
  LogIn,
  Library,
  MessageSquare
} from "lucide-react";
import styles from "./SidebarLeft.module.css";

export default function SidebarLeft() {
  // null until known (so nothing flashes as disabled for a signed-in user)
  const [authenticated, setAuthenticated] = useState(null);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // Back, on every page: to the previous page, or home when the page was
  // opened directly (nothing in this tab to go back to).
  const goBack = () => (window.history.state?.idx > 0 ? navigate(-1) : navigate("/"));

  // Checked again on every page change, so signing in or out shows at once.
  useEffect(() => {
    let cancelled = false;
    fetch(`${import.meta.env.VITE_API_URL}/auth/user`, {
      credentials: "include"
    })
      .then(r => (r.ok ? r.json() : null))
      .then(user => !cancelled && setAuthenticated(Boolean(user?._id)))
      .catch(() => {});
    return () => { cancelled = true; };
  }, [pathname]);

  const links = [
    { to: "/", label: "Home", icon: Home },
    authenticated
      ? { to: "/dashboard", label: "Profile", icon: LayoutDashboard }
      : { to: "/login", label: "Login", icon: LogIn },
    { to: "/library", label: "Library", icon: Library, needsAuth: true },
    { to: "/social", label: "Social", icon: MessageSquare, needsAuth: true }
  ];

  return (
    <>
      {/* Pinned near the top of the screen, above the brand; outside the
          rail (which is centred with a transform), so the rest stay put. */}
      <button type="button" className={`${styles.hoverBtn} ${styles.backBtn}`} onClick={goBack} aria-label="Back">
        <span className={styles.icon}>
          <ArrowLeft size={18} strokeWidth={1.75} />
        </span>
        <span className={styles.label}>Back</span>
      </button>

      <div className={styles.hoverRail} data-nav-rail /* the game page's bottom dock measures this to stay below it */>
        <div className={styles.brandVertical} onClick={() => navigate("/")}>
          GAMESOCIAL
        </div>

        {links.map(l =>
          l.needsAuth && authenticated === false ? (
            <span
              key={l.to}
              className={`${styles.hoverBtn} ${styles.disabled}`}
              role="link"
              aria-disabled="true"
              aria-label={`${l.label} (sign in to open)`}
              title={`Sign in to open ${l.label}`}
            >
              <span className={styles.icon}>
                <l.icon size={18} strokeWidth={1.75} />
              </span>
            </span>
          ) : (
            <NavLink key={l.to} to={l.to} className={styles.hoverBtn}>
              <span className={styles.icon}>
                <l.icon size={18} strokeWidth={1.75} />
              </span>
              <span className={styles.label}>{l.label}</span>
            </NavLink>
          )
        )}
      </div>
    </>
  );
}
