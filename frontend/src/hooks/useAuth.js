import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

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
        const user = {
          id: data._id,
          name: data.displayName || data.name || data.email || "User",
          email: data.email,
        };
        if (mounted) {
          setCurrentUser(user);
          setIsAuthenticated(true);
        }
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