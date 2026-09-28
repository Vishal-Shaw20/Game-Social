import { useEffect, useRef, useState } from "react";
import styles from "./ScrollRail.module.css";

/*
 * A custom vertical scrollbar for the game dock: a slim hollow glass pill in
 * the dock's accent colour (--accent), with a thumb that can be dragged.
 * Clicking the track pages towards the click. Give the element it drives the
 * `scroller` class from ScrollRail.module.css to hide the native scrollbar.
 *
 * Place it as a sibling of the scroller inside a position: relative parent.
 * Renders nothing while everything fits. `watch` re-measures when the
 * content changes in ways a resize wouldn't catch.
 */
export default function ScrollRail({ targetRef, watch, className = "", style }) {
  const railRef = useRef(null);
  const [m, setM] = useState({ show: false, size: 100, pos: 0 });
  const drag = useRef(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const { scrollTop, scrollHeight, clientHeight } = el;
        const max = scrollHeight - clientHeight;
        if (max <= 2) {
          setM((s) => (s.show ? { show: false, size: 100, pos: 0 } : s));
          return;
        }
        const size = Math.max(14, (clientHeight / scrollHeight) * 100);
        const pos = (scrollTop / max) * (100 - size);
        setM({ show: true, size, pos });
      });
    };
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure); // fires once on observe, too
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [targetRef, watch]);

  if (!m.show) return null;

  const onThumbDown = (e) => {
    e.stopPropagation();
    const el = targetRef.current;
    const rail = railRef.current.getBoundingClientRect();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = {
      y0: e.clientY,
      top0: el.scrollTop,
      // scroll pixels per pixel of thumb travel
      k: (el.scrollHeight - el.clientHeight) / Math.max(1, rail.height * (1 - m.size / 100)),
    };
    setDragging(true);
  };
  const onThumbMove = (e) => {
    const d = drag.current;
    if (!d) return;
    targetRef.current.scrollTop = d.top0 + (e.clientY - d.y0) * d.k;
  };
  const onThumbUp = () => {
    drag.current = null;
    setDragging(false);
  };

  // A click on the track pages towards it.
  const onTrackDown = (e) => {
    const el = targetRef.current;
    const rail = railRef.current.getBoundingClientRect();
    const thumbTop = rail.top + (m.pos / 100) * rail.height;
    const dir = e.clientY < thumbTop ? -1 : 1;
    el.scrollBy({ top: dir * el.clientHeight * 0.85, behavior: "smooth" });
  };

  return (
    <div ref={railRef} className={`${styles.rail} ${className}`} style={style} onPointerDown={onTrackDown} aria-hidden="true">
      <div
        className={`${styles.thumb} ${dragging ? styles.dragging : ""}`}
        style={{ top: `${m.pos}%`, height: `${m.size}%` }}
        onPointerDown={onThumbDown}
        onPointerMove={onThumbMove}
        onPointerUp={onThumbUp}
        onPointerCancel={onThumbUp}
        onLostPointerCapture={onThumbUp}
      />
    </div>
  );
}
