import React, { useState, useEffect, useRef } from "react";
import styles from "./MentionInput.module.css";

/*
 * A textarea that suggests usernames after "@". With the list open,
 * ↑/↓ move, Enter or Tab picks, Esc closes; otherwise keys go to the
 * caller's onKeyDown. Any other props (onFocus, maxLength, aria-label…) go
 * on the textarea; `inputRef` (a callback) gets the textarea itself.
 */
export default function MentionInput({
  value,
  onChange,
  placeholder,
  rows = 3,
  onKeyDown,
  inputRef,
  ...rest
}) {
  const [query, setQuery] = useState(null);
  const [results, setResults] = useState([]);
  const [active, setActive] = useState(0);
  const [cursor, setCursor] = useState(0);
  const ref = useRef();

  useEffect(() => {
    if (!query) return;
    let cancelled = false;
    fetch(`${import.meta.env.VITE_API_URL}/api/users/search?username=${encodeURIComponent(query)}`, {
      credentials: "include"
    })
      .then(r => r.ok ? r.json() : [])
      .then(list => {
        if (cancelled) return;
        setResults(list);
        setActive(0);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [query]);

  const setRefs = (el) => {
    ref.current = el;
    inputRef?.(el);
  };

  const handleChange = (e) => {
    const text = e.target.value;
    const pos = e.target.selectionStart;

    setCursor(pos);
    onChange(text);

    const slice = text.slice(0, pos);
    const match = slice.match(/@([a-zA-Z0-9_]*)$/);

    setQuery(match ? match[1] : null);
  };

  const insertMention = (username) => {
    const before = value.slice(0, cursor).replace(/@[\w]*$/, `@${username} `);
    const after = value.slice(cursor);
    onChange(before + after);
    setQuery(null);
    setResults([]);
    ref.current.focus();
  };

  const open = Boolean(query) && results.length > 0;

  const handleKeyDown = (e) => {
    if (open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const d = e.key === "ArrowDown" ? 1 : -1;
        setActive(i => (i + d + results.length) % results.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(results[Math.min(active, results.length - 1)].username);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setQuery(null);
        return;
      }
    }
    onKeyDown?.(e);
  };

  return (
    <div className={styles.mentionContainer}>
      <textarea
        {...rest}
        ref={setRefs}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        className={styles.mentionTextarea}
      />

      {open && (
        <div className={styles.mentionDropdown} role="listbox">
          {results.map((u, i) => (
            <div
              key={u._id}
              role="option"
              aria-selected={i === active}
              className={`${styles.mentionItem} ${i === active ? styles.mentionItemActive : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                insertMention(u.username);
              }}
              onMouseEnter={() => setActive(i)}
            >
              @{u.username}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
