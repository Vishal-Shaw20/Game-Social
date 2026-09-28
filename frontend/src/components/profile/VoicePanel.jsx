import { useEffect, useState } from "react";
import { useVoice, pttKeyLabel } from "../../realtime/voiceContext";
import styles from "./Profile.module.css";

const PTT_DELAYS = [0, 150, 300, 600];

/*
 * Push-to-talk, the same settings as a voice room's gear (saved to your
 * account through the voice provider): the key you hold, how long the mic
 * stays open after you let go, and a click when it opens and closes.
 */
export default function VoicePanel() {
  const { pttKey, pttDelay, pttSounds, setPtt } = useVoice();
  const [binding, setBinding] = useState(false);

  // Binding: the next key pressed is the shortcut (Escape cancels).
  useEffect(() => {
    if (!binding) return;
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== "Escape") setPtt({ key: e.code });
      setBinding(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [binding, setPtt]);

  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>Voice · push to talk</h2>

      <div className={styles.setting}>
        <span className={styles.settingText}>
          <span className={styles.settingLabel}>Shortcut</span>
          <span className={styles.settingHint}>Hold it to talk in a voice room. Ignored while you're typing.</span>
        </span>
        <button
          type="button"
          className={`${styles.keyBtn} ${binding ? styles.keyBinding : ""}`}
          onClick={() => setBinding((b) => !b)}
          title={binding ? "Press a key (Esc to cancel)" : "Click, then press a key"}
        >
          {binding ? "Press a key…" : pttKeyLabel(pttKey)}
        </button>
      </div>

      <div className={styles.setting}>
        <span className={styles.settingText}>
          <span className={styles.settingLabel}>Release delay</span>
          <span className={styles.settingHint}>Keeps your mic open a moment after you let go, so your last word isn't cut off.</span>
        </span>
        <span className={styles.seg} role="radiogroup" aria-label="Release delay">
          {PTT_DELAYS.map((ms) => (
            <button
              key={ms}
              type="button"
              role="radio"
              aria-checked={pttDelay === ms}
              className={pttDelay === ms ? styles.segOn : ""}
              onClick={() => setPtt({ delay: ms })}
            >
              {ms ? `${ms} ms` : "Off"}
            </button>
          ))}
        </span>
      </div>

      <div className={styles.setting}>
        <span className={styles.settingText}>
          <span className={styles.settingLabel}>Sound cues</span>
          <span className={styles.settingHint}>A soft click when your mic opens and closes.</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={pttSounds}
          aria-label="Sound cues"
          className={`${styles.switch} ${pttSounds ? styles.switchOn : ""}`}
          onClick={() => setPtt({ sounds: !pttSounds })}
        />
      </div>
    </section>
  );
}
