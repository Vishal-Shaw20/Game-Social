import React, { useState, useEffect, useRef } from "react";
import styles from "./MentionInput.module.css";

export default function MentionInput({
  value,
  onChange,
  placeholder,
  rows = 3
}) {
  const [query, setQuery] = useState(null);
  const [results, setResults] = useState([]);
  const [cursor, setCursor] = useState(0);
  const ref = useRef();

  useEffect(() => {
    if (!query) return;

    fetch(`${import.meta.env.VITE_API_URL}/api/users/search?username=${query}`, {
      credentials: "include"
    })
      .then(r => r.ok ? r.json() : [])
      .then(setResults);
  }, [query]);

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

  return (
    <div className={styles.mentionContainer}>
      <textarea
        ref={ref}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={handleChange}
        className={styles.mentionTextarea}
      />

      {query && results.length > 0 && (
        <div className={styles.mentionDropdown}>
          {results.map(u => (
            <div
              key={u._id}
              className={styles.mentionItem}
              onMouseDown={() => insertMention(u.username)}
            >
              @{u.username}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
