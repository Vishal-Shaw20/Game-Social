import React from "react";
import styles from "./CommentItem.module.css";

export default function CommentItem({
  comment,
  onReply,
  onToggleLike,
  onEdit,
  onDelete,
  depth = 0,
  currentUserId
}) {
  const isMine =
    String(comment.userId?._id || comment.userId) === String(currentUserId);

  const liked =
    Array.isArray(comment.likes) &&
    currentUserId &&
    comment.likes.some(id => String(id) === String(currentUserId));

  return (
    <div className={styles.comment} style={{ marginLeft: depth * 20 }}>
      <div className={styles.commentMeta}>
        <strong>{comment.userId?.displayName || "User"}</strong>
        {comment.edited && <span className={styles.edited}> • edited</span>}
      </div>

      <div className={styles.commentBody}>{comment.body}</div>

      <div className={styles.commentActions}>
        <button type="button" onClick={() => onReply(comment._id)}>
          Reply
        </button>

        <button
          type="button"
          className={`${styles.likeBtn} ${liked ? styles.liked : ""}`}
          onClick={() => onToggleLike(comment._id)}
        >
          {liked ? "💔 Unlike" : "❤️ Like"} {comment.likes?.length || 0}
        </button>

        {isMine && (
          <>
            <button type="button" onClick={() => onEdit(comment)}>
              ✏️ Edit
            </button>

            <button
              type="button"
              className={styles.danger}
              onClick={() => onDelete(comment._id)}
            >
              🗑 Delete
            </button>
          </>
        )}
      </div>

      {comment.replies?.map(r => (
        <CommentItem
          key={r._id}
          comment={r}
          onReply={onReply}
          onToggleLike={onToggleLike}
          onEdit={onEdit}
          onDelete={onDelete}
          depth={depth + 1}
          currentUserId={currentUserId}
        />
      ))}
    </div>
  );
}
