import React, { useEffect, useState } from "react";
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

function deleteCommentRecursive(list, id) {
  return list
    .filter(c => String(c._id) !== String(id))
    .map(c =>
      c.replies ? { ...c, replies: deleteCommentRecursive(c.replies, id) } : c
    );
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

export default function ReviewComments({ reviewId, currentUserId }) {
  const [comments, setComments] = useState([]);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [loading, setLoading] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");
  const [error, setError] = useState(null);

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

  return (
    <div className={styles.reviewComments}>
      {error && (
        <p style={{ color: "#f85149", fontSize: "13px", margin: "0 0 12px" }}>{error}</p>
      )}
      {tree.map(c => (
        <CommentItem
          key={c._id}
          comment={c}
          onReply={setReplyTo}
          onToggleLike={toggleLike}
          onEdit={(comment) => {
            setEditingId(comment._id);
            setEditText(comment.body);
          }}
          onDelete={deleteComment}
          currentUserId={currentUserId}
        />
      ))}

      {editingId && (
        <>
          <MentionInput value={editText} onChange={setEditText} rows={3} />
          <button onClick={submitEdit}>Update</button>
          <button className={styles.cancelBtn} onClick={() => setEditingId(null)}>Cancel</button>
        </>
      )}

      <MentionInput
        value={text}
        onChange={setText}
        placeholder={replyTo ? "Write a reply…" : "Write a comment…"}
        rows={3}
      />

      <button onClick={submit} disabled={loading}>
        {replyTo ? "Reply" : "Comment"}
      </button>
    </div>
  );
}
