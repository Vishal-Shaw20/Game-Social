import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./Social.module.css";

function Social() {
  const navigate = useNavigate();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(null);

  const [friends, setFriends] = useState([]);
  const [activity, setActivity] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);

  /* ===========================
     LOAD FRIENDS
  =========================== */
  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_URL}/api/friends`, { credentials: "include" })
      .then(r => (r.ok ? r.json() : []))
      .then(setFriends)
      .catch(() => {});
  }, []);

  /* ===========================
     LOAD FRIEND ACTIVITY
  =========================== */
  useEffect(() => {
    setActivityLoading(true);
    fetch(`${import.meta.env.VITE_API_URL}/api/friends/activity`, { credentials: "include" })
      .then(r => (r.ok ? r.json() : []))
      .then(setActivity)
      .catch(() => {})
      .finally(() => setActivityLoading(false));
  }, []);

  /* ===========================
     USER SEARCH
  =========================== */
  useEffect(() => {
    if (query.trim().length < 3) {
      setResults([]);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(
          `${import.meta.env.VITE_API_URL}/api/users/search?username=${encodeURIComponent(query)}`,
          { credentials: "include", signal: controller.signal }
        );

        if (res.status === 429) {
          const data = await res.json().catch(() => ({}));
          setError(data.error || "Too many search requests, please slow down");
          return;
        }

        if (!res.ok) return;

        const data = await res.json();
        setResults(data);
      } catch (err) {
        if (err.name !== "AbortError") setError("Failed to search users");
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  const handleAddFriend = async (e, userId) => {
    e.stopPropagation();
    setAdding(userId);

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/friends/add/${userId}`, {
        method: "POST",
        credentials: "include"
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to send friend request");
        return;
      }

      setResults(prev =>
        prev.map(u =>
          u._id === userId ? { ...u, isFriend: true } : u
        )
      );
    } catch {
      setError("Failed to send friend request");
    } finally {
      setAdding(null);
    }
  };

  const openProfile = (username) => {
    navigate(`/u/${username}`);
  };

  const openActivity = (a) => {
    if (a.url) navigate(a.url);
  };

  return (
    <div className={styles.socialContainer}>
      {/* SEARCH */}
      <input
        type="text"
        placeholder="Search by username..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className={styles.socialInput}
      />

      {/* FRIENDS */}
      {friends.length > 0 && (
        <div className={styles.socialSection}>
          <div className={styles.socialSectionTitle}>Friends</div>
          <div className={styles.socialRow}>
            {friends.map(f => (
              <div
                key={f._id}
                className={styles.socialFriendItem}
                onClick={() => openProfile(f.username)}
              >
                {f.avatar && (
                  <img src={f.avatar} alt="" className={styles.socialAvatarSmall} />
                )}
                @{f.username}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* FRIEND ACTIVITY */}
      <div className={styles.socialSection}>
        <div className={styles.socialSectionTitle}>Friend Activity</div>

        {activityLoading && <div className={styles.socialInfo}>Loading activity…</div>}

        {!activityLoading && activity.length === 0 && (
          <div className={styles.socialInfo}>No recent activity</div>
        )}

        {activity.map(a => (
          <div
            key={a._id}
            className={styles.socialActivityItem}
            onClick={() => openActivity(a)}
          >
            <strong>{a.actorId?.displayName}</strong>{" "}
            <span>{a.text}</span>
            <div className={styles.socialTime}>
              {new Date(a.createdAt).toLocaleTimeString()}
            </div>
          </div>
        ))}
      </div>

      {/* SEARCH RESULTS */}
      {loading && <p className={styles.socialInfo}>Searching…</p>}
      {error && <p className={styles.socialError}>{error}</p>}

      <ul className={styles.socialList}>
        {results.map(user => (
          <li
            key={user._id}
            className={styles.socialItem}
            onClick={() => openProfile(user.username)}
          >
            {user.avatar && (
              <img src={user.avatar} alt="" className={styles.socialAvatar} />
            )}

            <div className={styles.socialItemContent}>
              <strong>@{user.username}</strong>
              <div className={styles.socialSub}>{user.displayName}</div>
            </div>

            {!user.isFriend && (
              <button
                className={styles.socialAddBtn}
                disabled={adding === user._id}
                onClick={(e) => handleAddFriend(e, user._id)}
              >
                +
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default Social;
