import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import CommentItem from "./CommentItem";
import MentionInput from "../MentionInput";
import styles from "./ReviewComments.module.css";

function updateLikesRecursive(list, commentId, userId, liked) {
  return list.map(c => {
    if (String(c._id) === String(commentId)) {
      return {
        ...c,
        likes: liked
          ? [...(c.likes || []), userId]
          : (c.likes || []).filter(id => String(id) !== String(userId))
      };
    }
    if (c.replies?.length) {
      return { ...c, replies: updateLikesRecursive(c.replies, commentId, userId, liked) };
    }
    return c;
  });
}

function updateCommentRecursive(list, id, body) {
  return list.map(c => {
    if (String(c._id) === String(id)) {
      return { ...c, body, edited: true };
    }
    if (c.replies?.length) {
      return { ...c, replies: updateCommentRecursive(c.replies, id, body) };
    }
    return c;
  });
}

// The list is flat (buildTree nests it for display); a deleted comment's
// replies go too, as they do on the server.
function deleteCommentRecursive(list, id) {
  const gone = new Set([String(id)]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of list) {
      if (c.parentId && gone.has(String(c.parentId)) && !gone.has(String(c._id))) {
        gone.add(String(c._id));
        grew = true;
      }
    }
  }
  return list.filter(c => !gone.has(String(c._id)));
}

function buildTree(comments) {
  const map = {};
  const roots = [];

  comments.forEach(c => {
    map[c._id] = { ...c, replies: [] };
  });

  comments.forEach(c => {
    if (c.parentId && map[c.parentId]) {
      map[c.parentId].replies.push(map[c._id]);
    } else {
      roots.push(map[c._id]);
    }
  });

  return roots;
}

export default function ReviewComments({ reviewId, currentUserId, onCountChange }) {
  const [comments, setComments] = useState([]);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [loading, setLoading] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");
  const [error, setError] = useState(null);

  // Lets the review card keep its comment count in step.
  useEffect(() => {
    onCountChange?.(comments.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- report changes in count only
  }, [comments.length]);

  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_URL}/api/reviews/${reviewId}/comments`, { credentials: "include" })
      .then(r => r.json())
      .then(setComments)
      .catch(() => {});
  }, [reviewId]);

  async function toggleLike(commentId) {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/reviews/comments/${commentId}/like`, {
        method: "POST",
        credentials: "include"
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Something went wrong");
        return;
      }
      const json = await res.json();
      if (typeof json.liked !== "boolean") return;

      setComments(prev =>
        updateLikesRecursive(prev, commentId, currentUserId, json.liked)
      );
    } catch {
      setError("Something went wrong");
    }
  }

  async function submitEdit() {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/reviews/comments/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ body: editText })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Something went wrong");
        return;
      }

      const updated = await res.json();

      setComments(prev =>
        updateCommentRecursive(prev, updated._id, updated.body)
      );

      setEditingId(null);
      setEditText("");
    } catch {
      setError("Something went wrong");
    }
  }

  async function deleteComment(id) {
    if (!window.confirm("Delete this comment and its replies?")) return;

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/reviews/comments/${id}`, {
        method: "DELETE",
        credentials: "include"
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Something went wrong");
        return;
      }

      setComments(prev => deleteCommentRecursive(prev, id));
    } catch {
      setError("Something went wrong");
    }
  }

  async function submit() {
    if (!text.trim()) return;

    setLoading(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/reviews/${reviewId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ body: text, parentId: replyTo })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Something went wrong");
        return;
      }

      const saved = await res.json();
      setComments(prev => [...prev, saved]);
      setText("");
      setReplyTo(null);
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const tree = buildTree(comments);
  const replyingTo = replyTo ? comments.find(c => String(c._id) === String(replyTo)) : null;
  const replyName = replyingTo?.userId?.displayName || replyingTo?.userId?.username || "comment";

  return (
    <div className={styles.thread}>
      {error && <p className={styles.error}>{error}</p>}

      {tree.length === 0 && <p className={styles.empty}>No comments yet.</p>}
      {tree.map(c => (
        <CommentItem
          key={c._id}
          comment={c}
          onReply={setReplyTo}
          onToggleLike={toggleLike}
          // The lit pencil again cancels the edit.
          onEdit={(comment) => {
            if (comment._id === editingId) return setEditingId(null);
            setEditingId(comment._id);
            setEditText(comment.body);
          }}
          onDelete={deleteComment}
          currentUserId={currentUserId}
          editingId={editingId}
        />
      ))}

      {/* One writing box, dark like the dock's: editing a comment, replying,
          or a new comment. */}
      {currentUserId && (
        <div className={styles.box}>
          {editingId ? (
            <>
              <MentionInput value={editText} onChange={setEditText} rows={2} />
              <div className={styles.boxFoot}>
                <span className={styles.context}>Editing your comment</span>
                <button type="button" className={styles.ghost} onClick={() => setEditingId(null)}>Cancel</button>
                <button type="button" className={styles.send} onClick={submitEdit} disabled={!editText.trim()}>Update</button>
              </div>
            </>
          ) : (
            <>
              <MentionInput
                value={text}
                onChange={setText}
                placeholder={replyTo ? `Reply to ${replyName}…` : "Add a comment… @mention friends"}
                rows={2}
              />
              <div className={styles.boxFoot}>
                {replyTo && (
                  <span className={styles.context}>
                    Replying to {replyName}
                    <button type="button" className={styles.clear} onClick={() => setReplyTo(null)} aria-label="Cancel reply">
                      <X size={13} />
                    </button>
                  </span>
                )}
                <button type="button" className={styles.send} onClick={submit} disabled={loading || !text.trim()}>
                  {replyTo ? "Reply" : "Comment"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
