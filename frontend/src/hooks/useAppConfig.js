// src/hooks/useAppConfig.js
import { useEffect, useState } from "react";

/*
 * Runtime settings from the backend (GET /api/config), fetched once per page
 * load and shared by every caller. Voice chat is switched on or off in the
 * backend's env, so it must be read at runtime: a build-time flag would need
 * a frontend rebuild to change.
 */
const API_URL = import.meta.env.VITE_API_URL;

const EMPTY = { voice: { enabled: false, iceServers: [] } };

let cache = null;
let inFlight = null;
const listeners = new Set();

function load() {
  if (cache) return Promise.resolve(cache);
  if (!inFlight) {
    inFlight = fetch(`${API_URL}/api/config`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : EMPTY))
      .catch(() => EMPTY)
      .then((config) => {
        cache = { ...EMPTY, ...config };
        inFlight = null;
        listeners.forEach((l) => l(cache));
        return cache;
      });
  }
  return inFlight;
}

export function useAppConfig() {
  const [config, setConfig] = useState(cache ?? EMPTY);

  useEffect(() => {
    let alive = true;
    listeners.add(setConfig);
    load().then((c) => alive && setConfig(c));
    return () => {
      alive = false;
      listeners.delete(setConfig);
    };
  }, []);

  return config;
}
