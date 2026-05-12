// src/components/GameChat.jsx
import React, { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../hooks/useAuth";
import { useSocket } from "../hooks/useSocket";
import { useTextChat } from "../hooks/useTextChat";
import styles from "./GameChat.module.css";

export default function GameChat({ gameId }) {
  const navigate = useNavigate();
  const messagesEndRef = useRef(null);

  const {
    currentUser,
    isAuthenticated,
    authChecked,
    loginPrompt,
    setLoginPrompt,
    requireLogin
  } = useAuth();

  const { socket, connected } = useSocket(
    authChecked,
    isAuthenticated,
    currentUser
  );

  const roomTextId = `game:${gameId}`;

  const {
    joined,
    messages,
    input,
    setInput,
    join,
    leave,
    send,
    sendError
  } = useTextChat(socket, connected, roomTextId, currentUser, requireLogin);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className={styles.gcWrap}>
      {loginPrompt && (
        <div className={styles.gcLogin}>
          <span>{loginPrompt}</span>
          <button onClick={() => navigate("/login")}>Login</button>
          <button onClick={() => setLoginPrompt(null)} className={styles.ghost}>
            Dismiss
          </button>
        </div>
      )}

      <div className={styles.gcHeader}>
        <h2>Community Chat</h2>

        {!joined ? (
          <button
            onClick={join}
            disabled={!isAuthenticated || !connected}
            className={styles.primary}
          >
            {connected ? "Join Chat" : "Connecting…"}
          </button>
        ) : (
          <button onClick={leave} className={styles.secondary}>
            Leave
          </button>
        )}
      </div>

      {joined && (
        <div className={styles.gcPanel}>
          <div className={styles.gcMessages}>
            {messages.length === 0 && (
              <div className={styles.gcEmpty}>
                Be the first to say something
              </div>
            )}

            {messages.map((m, i) => {
              const mine = m.from === currentUser?.username;
              return (
                <div
                  key={m.ts + i}
                  className={`${styles.gcMsg} ${mine ? styles.mine : ""}`}
                >
                  <div className={styles.author}>{m.from}</div>
                  <div className={styles.bubble}>{m.text}</div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          <form
            className={styles.gcInputBar}
            onSubmit={e => {
              e.preventDefault();
              send(e);
            }}
          >
            {sendError && (
              <div style={{
                width: "100%",
                padding: "8px 14px",
                fontSize: "12px",
                color: "#f85149",
                background: "rgba(248,81,73,0.1)",
                borderRadius: "8px",
                marginBottom: "4px"
              }}>
                {sendError}
              </div>
            )}
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Message the community…"
              maxLength={500}
            />
            <button disabled={!input.trim()}>Send</button>
          </form>
        </div>
      )}
    </div>
  );
}
