import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

// Once per browser session, when signed in: the backend refreshes the
// user's Steam library if it's stale (GET /api/frontend-hit, see
// backend/middleware/SteamAutoSync.js). Fire and forget.
let steamPinged = false;
function pingSteamSync() {
  if (steamPinged) return;
  steamPinged = true;
  try {
    if (sessionStorage.getItem("gs.steamSyncPing")) return;
    sessionStorage.setItem("gs.steamSyncPing", "1");
  } catch {
    /* no session storage: once per page load, then */
  }
  fetch(`${import.meta.env.VITE_API_URL}/api/frontend-hit`, { credentials: "include" }).catch(() => {});
}

export function useAuth() {
  const [currentUser, setCurrentUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [loginPrompt, setLoginPrompt] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;

    const refreshAuth = async () => {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/user`, { credentials: "include" });
        if (!res.ok) throw new Error();
        const data = await res.json();
        // The whole user, not a three-field summary: the Social pages need
        // _id (to tell my own messages and memberships apart), username and
        // avatar. id/name stay for older callers.
        const user = {
          ...data,
          id: data._id,
          name: data.displayName || data.name || data.email || "User",
        };
        if (mounted) {
          setCurrentUser(user);
          setIsAuthenticated(true);
        }
        pingSteamSync();
      } catch {
        if (mounted) {
          setCurrentUser(null);
          setIsAuthenticated(false);
        }
      } finally {
        if (mounted) setAuthChecked(true);
      }
    };

    refreshAuth();
    window.addEventListener("focus", refreshAuth);
    const onStorage = (e) => e.key === "auth:changed" && refreshAuth();
    window.addEventListener("storage", onStorage);

    return () => {
      mounted = false;
      window.removeEventListener("focus", refreshAuth);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const requireLogin = (action) => {
    setLoginPrompt(`You must be logged in to ${action}.`);
    setTimeout(() => navigate("/login"), 2000);
  };

  return {
    currentUser,
    isAuthenticated,
    authChecked,
    loginPrompt,
    setLoginPrompt,
    requireLogin,
  };
}