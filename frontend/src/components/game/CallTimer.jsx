import { useEffect, useState } from "react";

/** m:ss (or h:mm:ss) since `since` (ms), ticking every second. Used for how
    long a voice room has been open and how long someone has been in it. */
export default function CallTimer({ since }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!since) return null;
  const secs = Math.max(0, Math.floor((now - since) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const ss = String(secs % 60).padStart(2, "0");
  return <time>{h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`}</time>;
}
