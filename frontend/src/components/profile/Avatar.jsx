import { useState } from "react";
import styles from "./Profile.module.css";

/*
 * A round picture, or the name's first letter when there's none (or it
 * doesn't load).
 */
export default function Avatar({ src, name, size = 40, className = "" }) {
  const [broken, setBroken] = useState(null); // the src that failed
  const show = src && broken !== src;
  return (
    <span
      className={`${styles.avatar} ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      aria-hidden="true"
    >
      {show ? (
        <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setBroken(src)} />
      ) : (
        (name || "?").trim().charAt(0).toUpperCase()
      )}
    </span>
  );
}
