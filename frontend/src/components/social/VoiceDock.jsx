import { Headphones, HeadphoneOff, Mic, MicOff, PhoneOff, Radio } from "lucide-react";
import { useVoice, pttKeyLabel } from "../../realtime/voiceContext";
import styles from "./VoiceDock.module.css";

const initial = (n) => (n || "?").trim().charAt(0).toUpperCase();

/**
 * The live call, in the right sidebar: which room, who's in it, and every
 * control (mute, deafen, push-to-talk, leave).
 *
 * It lives in the sidebar rather than on a page so a call keeps running and
 * stays reachable while you browse: joining happens on a game page or in a
 * chat, controlling it happens here.
 *
 * Renders nothing when voice is switched off in the backend.
 */
export default function VoiceDock() {
  const voice = useVoice();
  if (!voice.enabled) return null;

  const {
    joined, connecting, error, peers, label,
    muted, deafened, pushToTalk, pttKey, talking, speaking,
    leave, setMuted, setDeafened, setPushToTalk, setTalking
  } = voice;

  const micOpen = !muted && !deafened && (!pushToTalk || talking);

  return (
    <section className={styles.dock}>
      <div className={styles.head}>
        <span className={styles.title}>Voice</span>
        {joined && <span className={styles.live}>Live</span>}
      </div>

      {!joined ? (
        <p className={styles.hint}>
          {connecting
            ? "Connecting…"
            : "Not in a voice room. Join one from a game page or a chat."}
        </p>
      ) : (
        <>
          <div className={styles.room} title={label || "Voice room"}>
            {label || "Voice room"}
          </div>

          {error && <p className={styles.error}>{error}</p>}

          <ul className={styles.people}>
            <li className={`${styles.person} ${speaking && micOpen ? styles.speaking : ""}`}>
              <span className={styles.avatar}>{initial("You")}</span>
              <span className={styles.name}>You</span>
              {!micOpen && <MicOff size={12} className={styles.mutedIcon} />}
            </li>
            {peers.map((p) => (
              <li
                key={p.socketId}
                className={`${styles.person} ${p.speaking ? styles.speaking : ""}`}
              >
                <span className={styles.avatar}>
                  {p.avatar ? <img src={p.avatar} alt="" /> : initial(p.name)}
                </span>
                <span className={styles.name}>{p.name}</span>
                {p.muted && <MicOff size={12} className={styles.mutedIcon} />}
              </li>
            ))}
          </ul>

          <div className={styles.controls}>
            <button
              type="button"
              className={`${styles.ctrl} ${muted ? styles.ctrlOn : ""}`}
              onClick={() => setMuted((m) => !m)}
              title={muted ? "Unmute" : "Mute"}
              aria-label={muted ? "Unmute" : "Mute"}
              aria-pressed={muted}
            >
              {muted ? <MicOff size={14} /> : <Mic size={14} />}
            </button>

            <button
              type="button"
              className={`${styles.ctrl} ${deafened ? styles.ctrlOn : ""}`}
              onClick={() => setDeafened((d) => !d)}
              title={deafened ? "Undeafen" : "Deafen (mute everyone)"}
              aria-label={deafened ? "Undeafen" : "Deafen"}
              aria-pressed={deafened}
            >
              {deafened ? <HeadphoneOff size={14} /> : <Headphones size={14} />}
            </button>

            <button
              type="button"
              className={`${styles.ctrl} ${pushToTalk ? styles.ctrlOn : ""}`}
              onClick={() => setPushToTalk((p) => !p)}
              title={pushToTalk ? "Switch to open mic" : `Switch to push-to-talk (hold ${pttKeyLabel(pttKey)})`}
              aria-label="Push to talk"
              aria-pressed={pushToTalk}
            >
              <Radio size={14} />
            </button>

            <button
              type="button"
              className={styles.leave}
              onClick={leave}
              title="Leave voice"
              aria-label="Leave voice"
            >
              <PhoneOff size={14} />
            </button>
          </div>

          {pushToTalk && (
            <button
              type="button"
              className={`${styles.talk} ${talking ? styles.talkOn : ""}`}
              onPointerDown={() => setTalking(true)}
              onPointerUp={() => setTalking(false)}
              onPointerLeave={() => setTalking(false)}
            >
              {talking ? "Talking…" : `Hold to talk (or ${pttKeyLabel(pttKey)})`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
