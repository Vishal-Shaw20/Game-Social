// src/hooks/useAutoAdvance.js
//
// The homepage Trending carousel's slide logic (TrendingSpotlight), for any
// one-at-a-time slideshow:
//   - moves on every ADVANCE_MS; any change of slide, by hand or by itself,
//     restarts the count, as does resuming after a pause;
//   - pauses while the pointer is over it, while it has keyboard focus
//     (not a mouse click's leftover focus), while it's mostly scrolled out
//     of view, and while the tab is hidden;
//   - never auto-advances for people who ask for reduced motion;
//   - ← / → step through it, and a touch swipe does too.
//
// useAutoAdvance({ rootRef, index, count, onStep, canAdvance })
//   rootRef     the element watched for being in view
//   onStep(d)   move by d (+1 / -1); the automatic step is onStep(1)
//   canAdvance  false holds it still (e.g. while a trailer is showing)
// Returns { bind, swipe }: spread `bind` on each element that should pause
// it and take the arrow keys, `swipe` on the element that can be swiped.
import { useEffect, useRef, useState } from "react";

export const ADVANCE_MS = 6000;
const SWIPE_PX = 50;

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function useAutoAdvance({ rootRef, index, count, onStep, canAdvance = true }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [inView, setInView] = useState(true);
  const [tabHidden, setTabHidden] = useState(() => typeof document !== "undefined" && document.hidden);
  const paused = hovered || focused || !inView || tabHidden;

  // Kept in a ref so a new callback each render doesn't restart the count.
  const stepRef = useRef(onStep);
  useEffect(() => { stepRef.current = onStep; }, [onStep]);

  // (count: the element may only appear once there's something to show)
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, [rootRef, count]);

  useEffect(() => {
    const onVis = () => setTabHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    if (count < 2 || paused || !canAdvance || reducedMotion()) return;
    const id = setTimeout(() => stepRef.current(1), ADVANCE_MS);
    return () => clearTimeout(id);
  }, [index, paused, count, canAdvance]);

  const bind = {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
    // Keyboard focus only: a clicked dash keeps focus after the pointer has
    // left, which would otherwise pause it indefinitely.
    onFocus: (e) => setFocused(e.target.matches(":focus-visible")),
    onBlur: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
    },
    onKeyDown: (e) => {
      if (e.key === "ArrowRight") { e.preventDefault(); stepRef.current(1); }
      if (e.key === "ArrowLeft") { e.preventDefault(); stepRef.current(-1); }
    },
  };

  const start = useRef(null);
  const swipe = {
    onPointerDown: (e) => {
      if (e.pointerType === "mouse") return;
      start.current = e.clientX;
    },
    onPointerUp: (e) => {
      if (start.current == null) return;
      const dx = e.clientX - start.current;
      start.current = null;
      if (Math.abs(dx) > SWIPE_PX) stepRef.current(dx < 0 ? 1 : -1);
    },
  };

  return { bind, swipe };
}
