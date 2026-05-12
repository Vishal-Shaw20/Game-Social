// src/components/GameReviews.jsx
import React from "react";
import ReviewComments from "./ReviewComments";
import TagSelector from "./TagSelector";
import { PRO_TAGS, CON_TAGS } from "../shared/reviewTags";
import MentionInput from "../MentionInput";
import styles from "./GameReviews.module.css";

import {
  Crown,
  ThumbsDown,
  Meh,
  Sparkles,
  Heart,
  HeartOff,
  Pencil,
  Trash2,
  CheckCircle
} from "lucide-react";

const VERDICTS = {
  awful_fun: {
    label: "A disaster, but kind of funny",
    Icon: ThumbsDown,
    color: "#f85149"
  },
  subpar: {
    label: "Subpar slop",
    Icon: Meh,
    color: "#d29922"
  },
  almost_good: {
    label: "Almost had something",
    Icon: Sparkles,
    color: "#58a6ff"
  },
  perfection: {
    label: "Perfection",
    Icon: Crown,
    color: "#2ea043"
  }
};

export default function GameReviews({
  gameId,
  reviews,
  setReviews,
  owned,
  myReview,
  setMyReview,
  reviewLoading,
  currentUserId
}) {
  const [editingReviewId, setEditingReviewId] = React.useState(null);
  const [error, setError] = React.useState(null);

  const isMine = r => String(r.userId) === String(currentUserId);
  const isLikedByMe = r =>
    Array.isArray(r.likes) &&
    currentUserId &&
    r.likes.some(id => String(id) === String(currentUserId));

  const submitReview = async () => {
    const isEdit = Boolean(editingReviewId);
    const url = isEdit
      ? `${import.meta.env.VITE_API_URL}/api/reviews/${editingReviewId}`
      : `${import.meta.env.VITE_API_URL}/api/reviews/${gameId}`;

    const method = isEdit ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(myReview)
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Something went wrong");
      return;
    }

    setError(null);
    const saved = await res.json();

    setReviews(prev =>
      isEdit
        ? prev.map(r => (r._id === saved._id ? saved : r))
        : [saved, ...prev]
    );

    setEditingReviewId(null);
    setMyReview({});
  };

  return (
    <div className={styles.reviewSection}>
      <h2>Community Reviews</h2>

      {error && <p style={{ color: "#f85149", margin: "0.5rem 0" }}>{error}</p>}

      <div className={styles.reviewCount}>
        {reviews.length} community review{reviews.length !== 1 && "s"}
      </div>

      <div className={styles.reviewList}>
        {reviews.map(r => {
          const V = VERDICTS[r.verdict];
          const VerdictIcon = V.Icon;

          return (
            <div key={r._id} className={styles.reviewCard}>
              <div className={styles.verdictPill} style={{ color: V.color }}>
                <VerdictIcon size={14} />
                {V.label}
              </div>

              <div className={styles.reviewMeta}>
                Played {r.playtimeHours ?? "?"} hrs
                {r.completed && (
                  <>
                    {" "}
                    • <CheckCircle size={12} /> Completed
                  </>
                )}
              </div>

              {r.title && <h4>{r.title}</h4>}
              {r.body && <p>{r.body}</p>}

              <button
                className={`${styles.likeBtn} ${isLikedByMe(r) ? styles.liked : ""}`}
                onClick={async () => {
                  const liked = isLikedByMe(r);

                  const res = await fetch(
                    `${import.meta.env.VITE_API_URL}/api/reviews/${r._id}/${liked ? "unlike" : "like"}`,
                    { method: "POST", credentials: "include" }
                  );

                  if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    setError(data.error || "Something went wrong");
                    return;
                  }

                  setReviews(prev =>
                    prev.map(rv =>
                      rv._id === r._id
                        ? {
                            ...rv,
                            likes: liked
                              ? rv.likes.filter(
                                  id =>
                                    String(id) !== String(currentUserId)
                                )
                              : [...(rv.likes || []), currentUserId]
                          }
                        : rv
                    )
                  );
                }}
              >
                {isLikedByMe(r) ? (
                  <>
                    <HeartOff size={14} /> Unlike
                  </>
                ) : (
                  <>
                    <Heart size={14} /> Like
                  </>
                )}
                <span className={styles.likeCount}>{r.likes.length}</span>
              </button>

              {isMine(r) && (
                <div className={styles.reviewActions}>
                  <button
                    onClick={() => {
                      setEditingReviewId(r._id);
                      setMyReview({
                        title: r.title || "",
                        body: r.body || "",
                        pros: r.pros || [],
                        cons: r.cons || [],
                        verdict: r.verdict,
                        completed: r.completed || false
                      });
                    }}
                  >
                    <Pencil size={14} /> Edit
                  </button>

                  <button
                    onClick={async () => {
                      if (!window.confirm("Delete this review?")) return;

                      const res = await fetch(
                        `${import.meta.env.VITE_API_URL}/api/reviews/${r._id}`,
                        { method: "DELETE", credentials: "include" }
                      );

                      if (!res.ok) {
                        const data = await res.json().catch(() => ({}));
                        setError(data.error || "Something went wrong");
                        return;
                      }

                      setReviews(prev =>
                        prev.filter(rv => rv._id !== r._id)
                      );
                    }}
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              )}

              <ReviewComments
                reviewId={r._id}
                currentUserId={currentUserId}
              />
            </div>
          );
        })}
      </div>

      {owned && (
        <div className={styles.writeReview}>
          <h3>{editingReviewId ? "Edit your review" : "Write your review"}</h3>

          <MentionInput
            value={myReview.title || ""}
            onChange={v => setMyReview({ ...myReview, title: v })}
            placeholder="Title (optional)"
            rows={1}
          />

          <MentionInput
            value={myReview.body || ""}
            onChange={v => setMyReview({ ...myReview, body: v })}
            placeholder="Your thoughts..."
            rows={4}
          />

          <TagSelector
            tags={PRO_TAGS}
            selected={myReview.pros || []}
            onChange={v => setMyReview({ ...myReview, pros: v })}
          />

          <TagSelector
            tags={CON_TAGS}
            selected={myReview.cons || []}
            onChange={v => setMyReview({ ...myReview, cons: v })}
          />

          <div className={styles.verdictPicker}>
            {Object.entries(VERDICTS).map(([key, v]) => {
              const Icon = v.Icon;
              return (
                <button
                  key={key}
                  onClick={() =>
                    setMyReview({ ...myReview, verdict: key })
                  }
                  className={myReview.verdict === key ? styles.verdictActive : ""}
                  style={{ color: v.color }}
                >
                  <Icon size={16} />
                  {v.label}
                </button>
              );
            })}
          </div>

          <button
            className={styles.submitBtn}
            onClick={submitReview}
            disabled={reviewLoading || !myReview.verdict}
          >
            {editingReviewId ? "Update Review" : "Submit Review"}
          </button>

          {editingReviewId && (
            <button
              className={styles.cancelBtn}
              onClick={() => {
                setEditingReviewId(null);
                setMyReview({});
              }}
            >
              Cancel Edit
            </button>
          )}
        </div>
      )}
    </div>
  );
}
