import { useEffect, useState } from "react";
import styles from "./ScrollPager.module.css";

/* One dash per item (a slideshow: media viewer, hero screenshots). */
export function Dashes({ count, active, onSelect, label = (i) => `Item ${i + 1}`, className = "", style }) {
  if (count < 2) return null;
  return (
    <div className={`${styles.pager} ${className}`} style={style}>
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          className={`${styles.dash} ${i === active ? styles.dashActive : ""}`}
          onClick={() => onSelect(i)}
          aria-label={label(i)}
          aria-current={i === active ? "true" : undefined}
        />
      ))}
    </div>
  );
}

/**
 * One dash per screenful of a horizontally scrolling element (a card row).
 * Follows the row as it scrolls or resizes; clicking a dash scrolls there.
 * Renders nothing while everything fits. `watch` re-attaches when the row's
 * contents change (e.g. a list that loads later).
 */
export default function ScrollPager({ targetRef, watch, className = "", style }) {
  const [state, setState] = useState({ pages: 1, active: 0 });

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;

    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const w = el.clientWidth;
        if (!w) return;
        const max = el.scrollWidth - w;
        const pages = max > 4 ? Math.ceil(el.scrollWidth / w - 0.05) : 1;
        const active = pages > 1 ? Math.round((el.scrollLeft / max) * (pages - 1)) : 0;
        setState((s) => (s.pages === pages && s.active === active ? s : { pages, active }));
      });
    };

    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure); // also fires once on observe
    ro.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [targetRef, watch]);

  const go = (i) => {
    const el = targetRef.current;
    if (!el || state.pages < 2) return;
    const max = el.scrollWidth - el.clientWidth;
    el.scrollTo({ left: (i / (state.pages - 1)) * max, behavior: "smooth" });
  };

  return (
    <Dashes
      count={state.pages}
      active={state.active}
      onSelect={go}
      label={(i) => `Scroll to part ${i + 1} of ${state.pages}`}
      className={className}
      style={style}
    />
  );
}
