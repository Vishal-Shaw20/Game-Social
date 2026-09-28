import { PhoneOff, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useVoice } from "../../realtime/voiceContext";
import { ensureConnected } from "../../realtime/socket";
import { Avatar } from "./FriendsView";
import styles from "./Voice.module.css";

/**
 * The voice room on a page ("game:<id>" or "conv:<id>"): who's in it, and a
 * button to join or leave.
 *
 * The call's controls (mute, deafen, push-to-talk) live in the right
 * sidebar (VoiceDock), so they stay with you as you move around the site.
 * This panel only starts and stops the call for this room.
 *
 * Renders nothing when voice is switched off in the backend, and watches the
 * headcount without connecting anything until you join.
 */
export default function VoicePanel({ roomId, label, title = "Voice", compact = false }) {
  const voice = useVoice();
  const here = voice.isIn(roomId);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!voice.enabled || !roomId) return;
    const socket = ensureConnected();
    socket.emit("voice-watch", { roomId, watch: true }, (ack) => {
      if (ack?.ok) setCount(ack.count ?? 0);
    });
    const onCount = (p) => p.roomId === roomId && setCount(p.count);
    socket.on("voice-count", onCount);
    return () => {
      socket.off("voice-count", onCount);
      socket.emit("voice-watch", { roomId, watch: false });
    };
  }, [voice.enabled, roomId]);

  if (!voice.enabled) return null;

  const { connecting, error, peers, join, leave } = voice;
  const elsewhere = voice.joined && !here;

  return (
    <section className={`${styles.panel} ${compact ? styles.compact : ""}`}>
      <header className={styles.head}>
        <span className={styles.title}>{title}</span>
        <span className={styles.count}>
          {count === 0 ? "No one here" : `${count} in voice`}
        </span>
      </header>

      {here && error && <p className={styles.error}>{error}</p>}

      {here && (
        <>
          <ul className={styles.people}>
            <li className={`${styles.person} ${voice.speaking ? styles.speaking : ""}`}>
              <Avatar user={{ displayName: "You" }} size={26} />
              <span className={styles.personName}>You</span>
            </li>
            {peers.map((p) => (
              <li key={p.socketId} className={`${styles.person} ${p.speaking ? styles.speaking : ""}`}>
                <Avatar user={p} size={26} />
                <span className={styles.personName}>{p.name}</span>
              </li>
            ))}
          </ul>
          <p className={styles.hint}>
            <Volume2 size={12} /> Mute and other controls are in the notification bar.
          </p>
        </>
      )}

      <div className={styles.controls}>
        {here ? (
          <button type="button" className={styles.leaveBtn} onClick={leave}>
            <PhoneOff size={15} /> Leave voice
          </button>
        ) : (
          <>
            <button
              type="button"
              className={styles.joinBtn}
              onClick={() => join(roomId, label)}
              disabled={connecting}
            >
              {connecting ? "Connecting\u2026" : "Join voice"}
            </button>
            {elsewhere && (
              <span className={styles.hint}>
                You're in {voice.label || "another room"}; joining moves you here.
              </span>
            )}
          </>
        )}
      </div>
    </section>
  );
}
