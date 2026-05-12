import React from "react";
import { Outlet } from "react-router-dom";
import SidebarLeft from "./SidebarLeft";
import SidebarRight from "./SidebarRight";
import Footer from "./Footer";
import styles from "./Layout.module.css";

export default function Layout() {
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
        <div className={styles.mainScrollable}>
          <Outlet />
        </div>
      </main>

      <aside className={styles.sidebarRight}>
        <SidebarRight />
      </aside>
    </>
  );
}
