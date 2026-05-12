import React from "react";
import styles from "./Footer.module.css";

export default function Footer() {
  return (
    <footer className={styles.appFooter}>
      <div className={styles.footerInner}>
        <span className={styles.footerLeft}>
          © {new Date().getFullYear()} GameVerse
        </span>
        <span className={styles.footerRight}>
          Built for gamers · Discover · Play · Connect
        </span>
      </div>
    </footer>
  );
}
