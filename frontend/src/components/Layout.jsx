import React, { useLayoutEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router-dom";
import SidebarLeft from "./SidebarLeft";
import SidebarRight from "./SidebarRight";
import { useAuth } from "../hooks/useAuth";
import Footer from "./Footer";
import styles from "./Layout.module.css";

export default function Layout() {
  // Notifications and the voice dock are personal, so the right bar is only
  // there once someone is signed in.
  const { isAuthenticated, authChecked } = useAuth();

  // Pages scroll inside this one container, which stays mounted across
  // routes, so its position would carry over from page to page (going back
  // home landed you mid-page). Every page opens at the top instead, which also
  // gives the home page's lower rows time to load before they're reached.
  const scrollRef = useRef(null);
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [pathname]);

  return (
    <>
      <div className={styles.auroraBg} />

      <div className={styles.leftFloatZone}>
        <div className={styles.leftHoverTint} />
        <aside className={styles.sidebarLeft}>
          <SidebarLeft />
        </aside>
      </div>

      <main className={styles.mainContent}>
        <div ref={scrollRef} className={styles.mainScrollable}>
          <Outlet />
        </div>
      </main>

      {authChecked && isAuthenticated && (
        <aside className={styles.sidebarRight}>
          <SidebarRight />
        </aside>
      )}
    </>
  );
}
