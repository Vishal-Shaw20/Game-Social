import React from "react";
import { Link } from "react-router-dom";
import { Heart, Reply, Pencil, Trash2 } from "lucide-react";
import { timeAgo } from "./game/format";
import styles from "./CommentItem.module.css";

/* One comment and its replies, in the game dock's style. */
export default function CommentItem({
  comment,
  onReply,
  onToggleLike,
  onEdit,
  onDelete,
  depth = 0,
  currentUserId,
  editingId = null
}) {
  const editing = editingId != null && String(editingId) === String(comment._id);
  const u = comment.userId && typeof comment.userId === "object" ? comment.userId : {};
  const name = u.displayName || u.username || "Player";
  const avatar = u.profilePicture || u.linkedAccounts?.find((a) => a.avatar)?.avatar || null;
  const isMine = String(u._id || comment.userId) === String(currentUserId);
  const liked =
    Array.isArray(comment.likes) &&
    currentUserId &&
    comment.likes.some(id => String(id) === String(currentUserId));
  const likes = comment.likes?.length || 0;

  const who = (
    <>
      {avatar ? (
        <img className={styles.avatar} src={avatar} alt="" loading="lazy" />
      ) : (
        <span className={styles.avatar} aria-hidden="true">{name[0].toUpperCase()}</span>
      )}
      <span className={styles.name}>{name}</span>
    </>
  );

  return (
    <div className={`${styles.comment} ${depth ? styles.reply : ""}`}>
      <div className={styles.head}>
        {u.username ? <Link to={`/u/${u.username}`} className={styles.author}>{who}</Link> : <span className={styles.author}>{who}</span>}
        <span className={styles.when}>
          {comment.createdAt && timeAgo(comment.createdAt)}
          {comment.edited && " · edited"}
        </span>
      </div>

      <div className={styles.body}>{comment.body}</div>

      <div className={styles.actions}>
        {currentUserId && (
          <button type="button" onClick={() => onReply(comment._id)}>
            <Reply size={13} /> Reply
          </button>
        )}
        <button
          type="button"
          className={liked ? styles.liked : ""}
          onClick={() => onToggleLike(comment._id)}
          aria-pressed={Boolean(liked)}
          disabled={!currentUserId}
        >
          <Heart size={13} fill={liked ? "currentColor" : "none"} /> {likes || ""}
        </button>
        {isMine && (
          <>
            <button
              type="button"
              className={editing ? styles.active : ""}
              onClick={() => onEdit(comment)}
              aria-label={editing ? "Stop editing comment" : "Edit comment"}
              aria-pressed={editing}
            >
              <Pencil size={13} />
            </button>
            <button type="button" className={styles.danger} onClick={() => onDelete(comment._id)} aria-label="Delete comment">
              <Trash2 size={13} />
            </button>
          </>
        )}
      </div>

      {comment.replies?.length > 0 && (
        <div className={styles.replies}>
          {comment.replies.map(r => (
            <CommentItem
              key={r._id}
              comment={r}
              onReply={onReply}
              onToggleLike={onToggleLike}
              onEdit={onEdit}
              onDelete={onDelete}
              depth={depth + 1}
              currentUserId={currentUserId}
              editingId={editingId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
