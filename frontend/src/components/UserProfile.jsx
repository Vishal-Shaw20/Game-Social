import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import styles from "./UserProfile.module.css";

const VERDICTS = {
  awful_fun: { label: "A disaster, but kind of funny", emoji: "🤡", color: "#f85149" },
  subpar: { label: "Subpar slop", emoji: "🥱", color: "#d29922" },
  almost_good: { label: "Almost had something", emoji: "😬", color: "#58a6ff" },
  perfection: { label: "Perfection", emoji: "👑", color: "#2ea043" }
};

function UserProfile() {
  const { username } = useParams();
  const navigate = useNavigate();

  const [user, setUser] = useState(null);
  const [library, setLibrary] = useState(null);
  const [reviews, setReviews] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const loadProfileData = async () => {
      try {
        setLoading(true);
        setError(null);

        // 1. Fetch Profile
        const profileRes = await fetch(
          `${import.meta.env.VITE_API_URL}/api/users/${encodeURIComponent(username)}/profile`,
          { credentials: "include" }
        );
        if (!profileRes.ok) throw new Error("Profile not found");
        const profileData = await profileRes.json();
        if (cancelled) return;
        setUser(profileData);

        // 2. Fetch Library (in parallel for better perf)
        const libraryPromise = fetch(
          `${import.meta.env.VITE_API_URL}/api/users/${encodeURIComponent(username)}/library`,
          { credentials: "include" }
        ).then(res => res.ok ? res.json() : null);

        // 3. Fetch Reviews (in parallel)
        const reviewsPromise = fetch(
          `${import.meta.env.VITE_API_URL}/api/reviews/user/${encodeURIComponent(username)}`,
          { credentials: "include" }
        ).then(res => res.ok ? res.json() : []);

        const [libraryData, reviewsData] = await Promise.all([libraryPromise, reviewsPromise]);

        if (!cancelled) {
          setLibrary(libraryData);
          setReviews(reviewsData || []);
        }
      } catch (err) {
        if (!cancelled) {
          setError("User not found");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadProfileData();

    return () => {
      cancelled = true;
    };
  }, [username]);

  if (loading) {
    return <div className={styles.profileCenter}>Loading profile…</div>;
  }

  if (error) {
    return (
      <div className={styles.profileCenter}>
        <p>{error}</p>
        <button onClick={() => navigate(-1)} className={styles.profileBack}>Go back</button>
      </div>
    );
  }

  return (
    <div className={styles.profileContainer}>
      <button onClick={() => navigate(-1)} className={styles.profileBack}>
        ← Back
      </button>

      {/* PROFILE CARD */}
      <div className={styles.profileCard}>
        <h2>@{user.username}</h2>
        <p className={styles.profileName}>{user.displayName}</p>
        <div className={styles.profileStats}>
          <div>
            <strong>{user.friendsCount}</strong>
            <span>Friends</span>
          </div>
        </div>
      </div>

      {/* LIBRARY */}
      <div className={styles.profileSection}>
        <h3>🎮 Game Library</h3>

        {!library?.linked && <p className={styles.profileMuted}>Library not linked</p>}
        {library?.linked && library.games?.length === 0 && <p className={styles.profileMuted}>No games found</p>}
        {library?.linked && library.games?.length > 0 && (
          <ul className={styles.profileGameList}>
            {library.games.slice(0, 12).map((g, i) => (
              <li key={i} className={styles.profileGameItem}>
                {g.rawg?.name || g.steam?.name || "Unknown Game"}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* REVIEWS */}
      <div className={styles.profileSection}>
        <h3>📝 Reviews</h3>

        {reviews.length === 0 && <p className={styles.profileMuted}>No public reviews</p>}

        {reviews.map(r => (
          <div key={r._id} className={styles.profileReviewCard}>
            <div
              className={styles.profileVerdict}
              style={{ background: VERDICTS[r.verdict]?.color || "#666" }}
            >
              {VERDICTS[r.verdict]?.emoji || "❓"} {VERDICTS[r.verdict]?.label || "Unknown verdict"}
            </div>

            <div className={styles.profileMeta}>
              Played {r.playtimeHours ?? "?"} hrs
              {r.completed && " • Completed"}
            </div>

            <h4>{r.title || "Untitled Review"}</h4>
            {r.body && <p>{r.body}</p>}

            {(r.pros?.length > 0 || r.cons?.length > 0) && (
              <div className={styles.profileTagSection}>
                {r.pros?.length > 0 && (
                  <div>
                    <div className={styles.profileTagTitle}>👍 Pros</div>
                    <div className={styles.profileTagRow}>
                      {r.pros.map((p, i) => (
                        <span key={i} className={styles.profileProTag}>{p}</span>
                      ))}
                    </div>
                  </div>
                )}

                {r.cons?.length > 0 && (
                  <div>
                    <div className={styles.profileTagTitle}>👎 Cons</div>
                    <div className={styles.profileTagRow}>
                      {r.cons.map((c, i) => (
                        <span key={i} className={styles.profileConTag}>{c}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default UserProfile;
