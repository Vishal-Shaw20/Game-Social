import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import styles from "./Select.module.css";

const MENU_MAX = 288;

/*
 * The site's dropdown, in place of a native <select> (whose menu the OS
 * draws and CSS can't reach). A pill button opens a menu of options below
 * it (or above, when there's no room), rendered on <body> so a scrolling
 * or clipping parent can't cut it off; it takes the page's --accent along.
 *
 * Focus stays on the button: arrows / Home / End move through the options,
 * Enter or Space picks, Escape or Tab closes, typing a letter jumps to it.
 * A click outside, a scroll or a resize closes it too. The menu carries
 * data-select-menu so a popover it opens from can tell its clicks apart.
 *
 * options: [[value, label], ...]. The button is as wide as its longest
 * option, so it doesn't resize as the value changes. size "sm" is the small
 * pill for over art; full makes it as wide as its container.
 */
export default function Select({ value, options, onChange, ariaLabel, size, full = false, align = "left", className = "" }) {
  const [menu, setMenu] = useState(null); // { style, up, active } while open
  const btnRef = useRef(null);
  const listRef = useRef(null);
  const id = useId();
  const open = Boolean(menu);
  const index = Math.max(0, options.findIndex(([v]) => v === value));
  const label = options[index]?.[1] ?? "";

  const show = () => {
    const btn = btnRef.current;
    const r = btn.getBoundingClientRect();
    const height = Math.min(MENU_MAX, options.length * 36 + 14);
    const below = window.innerHeight - r.bottom - 8;
    const up = below < height && r.top - 8 > below;
    const style = {
      minWidth: r.width,
      "--accent": getComputedStyle(btn).getPropertyValue("--accent") || undefined,
      ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
      ...(align === "right" ? { right: document.documentElement.clientWidth - r.right } : { left: r.left }),
    };
    setMenu({ style, up, active: index });
  };
  const close = () => setMenu(null);
  const pick = (i) => {
    const v = options[i]?.[0];
    close();
    if (v !== undefined && v !== value) onChange(v);
  };
  const setActive = (i) => setMenu((m) => m && { ...m, active: (i + options.length) % options.length });

  // Outside clicks, scrolling (anywhere but the menu) and resizes close it.
  useEffect(() => {
    if (!open) return;
    const down = (e) => {
      if (!btnRef.current?.contains(e.target) && !listRef.current?.contains(e.target)) setMenu(null);
    };
    const scroll = (e) => !listRef.current?.contains(e.target) && setMenu(null);
    const resize = () => setMenu(null);
    document.addEventListener("mousedown", down);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("mousedown", down);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", resize);
    };
  }, [open]);

  // Keep the highlighted option in view.
  useEffect(() => {
    if (!menu) return;
    listRef.current?.children[menu.active]?.scrollIntoView({ block: "nearest" });
  }, [menu]);

  const onKeyDown = (e) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // not the popover this sits in
      close();
    } else if (e.key === "Tab") close();
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive(menu.active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(menu.active - 1); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(menu.active); }
    else if (e.key.length === 1) {
      const k = e.key.toLowerCase();
      const n = options.length;
      for (let s = 1; s <= n; s++) {
        const i = (menu.active + s) % n;
        if (String(options[i][1]).toLowerCase().startsWith(k)) { setActive(i); break; }
      }
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`${styles.trigger} ${size === "sm" ? styles.sm : ""} ${full ? styles.full : ""} ${open ? styles.open : ""} ${className}`}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-activedescendant={open ? `${id}-${menu.active}` : undefined}
        aria-label={ariaLabel ? `${ariaLabel}: ${label}` : undefined}
      >
        <span className={styles.value}>
          {options.map(([v, text], i) => (
            <span key={String(v)} className={i === index ? "" : styles.ghost} aria-hidden={i === index ? undefined : true}>
              {text}
            </span>
          ))}
        </span>
        <ChevronDown size={size === "sm" ? 12 : 14} className={styles.chevron} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <ul
            ref={listRef}
            id={id}
            role="listbox"
            aria-label={ariaLabel}
            data-select-menu=""
            className={`${styles.menu} ${menu.up ? styles.menuUp : ""}`}
            style={menu.style}
            onMouseDown={(e) => e.preventDefault()} // keep focus on the button
          >
            {options.map(([v, text], i) => (
              <li
                key={String(v)}
                id={`${id}-${i}`}
                role="option"
                aria-selected={v === value}
                className={`${styles.option} ${i === menu.active ? styles.active : ""} ${v === value ? styles.selected : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(i)}
              >
                {text}
                <Check size={13} className={styles.check} aria-hidden="true" />
              </li>
            ))}
          </ul>,
          document.body
        )}
    </>
  );
}
