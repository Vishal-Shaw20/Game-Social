import { Link } from "react-router-dom";
import Avatar from "./Avatar";
import styles from "./Profile.module.css";

const STATUS = { online: "Online", away: "Away", offline: "Offline" };

/*
 * Your friends, online first: their status line, who's playing what right
 * now, and a way to their public profile.
 */
export default function FriendsPanel({ friends }) {
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>
        Friends <span className={styles.count}>{friends.length}</span>
      </h2>
      {friends.length ? (
        <div className={styles.list}>
          {friends.map((f) => {
            const body = (
              <>
                <span className={styles.avatarWrap}>
                  <Avatar src={f.avatar} name={f.name} size={38} />
                  <span
                    className={`${styles.dot} ${f.status === "online" ? styles.dotOnline : f.status === "away" ? styles.dotAway : ""}`}
                    aria-label={STATUS[f.status] ?? "Offline"}
                  />
                </span>
                <span className={styles.rowText}>
                  <span className={styles.rowName}>{f.name}</span>
                  {f.customStatus?.text && <span className={styles.rowStatus}>“{f.customStatus.text}”</span>}
                  <span className={styles.rowSub}>
                    {f.playing ? <>Playing <b>{f.playing}</b></> : STATUS[f.status] ?? "Offline"}
                    {f.username && ` · @${f.username}`}
                  </span>
                </span>
              </>
            );
            return f.username ? (
              <Link key={f.id} className={styles.row} to={`/u/${f.username}`}>{body}</Link>
            ) : (
              <div key={f.id} className={styles.row}>{body}</div>
            );
          })}
        </div>
      ) : (
        <p className={styles.muted}>
          No friends yet. <Link to="/social">Find people in Social</Link>
        </p>
      )}
    </section>
  );
}
