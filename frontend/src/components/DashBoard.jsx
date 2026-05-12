import React, { useEffect, useState } from "react";
import styles from "./DashBoard.module.css";

export default function Dashboard() {
  const [user, setUser] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    displayName: "",
    username: ""
  });

  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_URL}/auth/user`, {
      credentials: "include"
    })
      .then(res => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then(data => {
        setUser(data);
        setForm({
          displayName: data.displayName || "",
          username: data.username || ""
        });
      })
      .catch(() =>
        setError("Failed to load user. Please try logging in again.")
      );
  }, []);

  const handleLogout = async () => {
    const res = await fetch(
      `${import.meta.env.VITE_API_URL}/auth/logout`,
      { method: "POST", credentials: "include" }
    );
    if (res.ok) window.location.href = "/";
    else setError("Logout failed");
  };

  const handleConnect = provider => {
    window.location.href = `${import.meta.env.VITE_API_URL}/auth/${provider}`;
  };

  const handleSave = async () => {
    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/api/profile`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(form)
        }
      );

      if (!res.ok) throw new Error();
      const updated = await res.json();
      setUser(updated);
      setEditing(false);
    } catch {
      setError("Profile update failed");
    }
  };

  const isConnected = provider =>
    user?.linkedAccounts?.some(a => a.provider === provider);

  return (
    <div className={styles.dashRoot}>
      <div className={styles.dashHeader}>
        <div>
          <h1>Profile</h1>
          <p>Your profile & linked gaming accounts</p>
        </div>

        <div className={styles.headerActions}>
          <button
            className={styles.connectBtn}
            onClick={() => setEditing(v => !v)}
          >
            {editing ? "Cancel" : "Edit Profile"}
          </button>

          <button className={styles.logoutBtn} onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>

      {error && <div className={styles.dashError}>{error}</div>}

      {!user ? (
        <div className={styles.dashLoading}>Loading profile…</div>
      ) : (
        <div className={styles.dashGrid}>
          <section className={`${styles.dashCard} ${styles.profileCard}`}>
            <div className={styles.profileMain}>
              <div className={styles.avatarGlow}>
                {user.displayName?.[0] || "U"}
              </div>

              <div className={styles.profileInfo}>
                {editing ? (
                  <>
                    <input
                      className={styles.profileInput}
                      value={form.displayName}
                      onChange={e =>
                        setForm({ ...form, displayName: e.target.value })
                      }
                      placeholder="Display name"
                    />
                    <input
                      className={styles.profileInput}
                      value={form.username}
                      onChange={e =>
                        setForm({ ...form, username: e.target.value })
                      }
                      placeholder="Username"
                    />
                    <button
                      className={`${styles.connectBtn} ${styles.saveBtn}`}
                      onClick={handleSave}
                    >
                      Save Changes
                    </button>
                  </>
                ) : (
                  <>
                    <h2>{user.displayName}</h2>
                    <span>{user.username}</span>
                    <span>{user.email}</span>
                  </>
                )}
              </div>
            </div>
          </section>

          <section className={`${styles.dashCard} ${styles.accountsCard}`}>
            <h3>Connected Accounts</h3>

            <div className={styles.accountsList}>
              {["google", "steam", "epic", "riot"].map(p => (
                <div key={p} className={styles.accountRow}>
                  <span className={styles.provider}>{p}</span>
                  {isConnected(p) ? (
                    <span className={styles.statusConnected}>Connected</span>
                  ) : (
                    <button
                      className={styles.connectBtn}
                      onClick={() => handleConnect(p)}
                    >
                      Connect
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
