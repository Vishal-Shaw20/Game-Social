import { useEffect, useRef, useState } from "react";
import ScrollRail from "./ScrollRail";
import rail from "./ScrollRail.module.css";
import styles from "./Game.module.css";

/*
 * Two columns side by side, as tall as the shorter one's content: that one
 * shows whole, the taller one scrolls inside (with the dock's scrollbar,
 * shown while the pointer is over that side).
 * Heights are re-measured whenever either side's content changes size (a
 * "More" opening, images loading). Stacked on narrow screens, where both
 * show whole.
 */
const STACKED = "(max-width: 960px)";

export default function EvenColumns({ left, right }) {
  const leftRef = useRef(null);
  const rightRef = useRef(null);
  const [height, setHeight] = useState(null);

  useEffect(() => {
    const l = leftRef.current?.firstElementChild;
    const r = rightRef.current?.firstElementChild;
    if (!l || !r) return;
    const mq = window.matchMedia(STACKED);
    const measure = () => {
      setHeight(mq.matches ? null : Math.ceil(Math.min(l.offsetHeight, r.offsetHeight)));
    };
    const ro = new ResizeObserver(measure); // fires once on observe, too
    ro.observe(l);
    ro.observe(r);
    mq.addEventListener("change", measure);
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", measure);
    };
  }, []);

  return (
    <div className={styles.evenCols} style={height ? { height } : undefined}>
      <div className={styles.evenCol}>
        <div ref={leftRef} className={`${styles.evenScroll} ${rail.scroller}`}>
          <div>{left}</div>
        </div>
        <ScrollRail targetRef={leftRef} className={styles.evenRail} />
      </div>
      <div className={styles.evenCol}>
        <div ref={rightRef} className={`${styles.evenScroll} ${rail.scroller}`}>
          <div>{right}</div>
        </div>
        <ScrollRail targetRef={rightRef} className={styles.evenRail} />
      </div>
    </div>
  );
}
