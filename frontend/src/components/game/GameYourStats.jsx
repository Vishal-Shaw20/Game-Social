import { useState } from "react";
import { ChevronDown, Library } from "lucide-react";
import { hours } from "./format";
import s from "./GameHero.module.css";

/* Your card in the title panel (GameHero), laid out like the dock's
   columns: a "You" label with "In your library", your playtime as the
   headline, achievements with a meter, and your in-game stats behind a
   toggle. Only for a signed-in
   user who owns the game on Steam. */
export default function GameYourStats({ me }) {
  const [showStats, setShowStats] = useState(false);
  if (!me?.owned) return null;
  const a = me.achievements;
  const pct = a?.total ? Math.round((a.unlocked / a.total) * 100) : null;
  const recent = me.playtime2WeeksHours > 0 ? hours(me.playtime2WeeksHours) : null;

  return (
    <aside className={s.you} aria-label="Your stats">
      <div className={s.youHead}>
        <span className={s.label}>You</span>
        <span className={s.owned}><Library size={13} /> In your library</span>
      </div>

      <div>
        <div className={s.youPlay}>{hours(me.playtimeHours) ?? "0 h"}</div>
        <div className={s.youSub}>played{recent ? ` · ${recent} in the last 2 weeks` : ""}</div>
      </div>

      {a?.total > 0 && (
        <div>
          <div className={s.youRow}>
            <span>Achievements</span>
            <b>{a.unlocked}/{a.total} · {pct}%</b>
          </div>
          <div className={s.meter} aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
        </div>
      )}

      {me.privateProfile && (
        <p className={s.youNote}>
          Your Steam game details are private, so achievements can't be read. Set "Game details" to public in your
          Steam privacy settings to see them here.
        </p>
      )}

      {me.stats?.length > 0 && (
        <div>
          <button type="button" className={s.youToggle} onClick={() => setShowStats((v) => !v)} aria-expanded={showStats}>
            In-game stats ({me.stats.length})
            <ChevronDown size={14} className={showStats ? s.youToggleOpen : ""} />
          </button>
          {showStats && (
            <div className={s.youList} style={{ marginTop: 8 }}>
              {me.stats.map((st) => (
                <div key={st.name} className={s.youRow}>
                  <span className={s.youName}>{st.label}</span>
                  <b>{Number(st.value).toLocaleString()}</b>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
