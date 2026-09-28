import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { gameArt } from "../utils/gameArt";
import styles from "./LoginPage.module.css";

const API = import.meta.env.VITE_API_URL;
const WALL = 30;
const COLS = 5;
const PER_COL = 10; // covers per column (repeating if there are few): taller than the wall
const MIN_PASSWORD = 8;
const RESEND_WAIT = 30; // seconds before a code can be sent again

// The covers dealt into columns, each starting at a different point, so
// neighbouring columns don't show the same games side by side.
function columns(covers) {
  if (!covers.length) return [];
  return Array.from({ length: COLS }, (_, c) =>
    Array.from({ length: PER_COL }, (_, k) => covers[(c + k * COLS) % covers.length])
  );
}

// Why a Google / Steam sign-in came back here (?error=google|steam).
const OAUTH_ERRORS = {
  google: "Google sign-in was cancelled or didn't work. Try again.",
  steam: "Steam sign-in was cancelled or didn't work. Try again.",
};

/*
 * Sign in, sign up (with an emailed code) and password reset, over the
 * homepage's featured games (/api/hero) as a tilted wall of art, its
 * columns slowly scrolling, that fades away diagonally; the form sits in
 * the dark, in one fixed accent.
 *
 * One step at a time: signin, signup → signupCode, forgot → resetCode. The
 * code steps can go back (the details are kept) and send the code again
 * after a short wait. What you've typed carries across steps where it's
 * the same thing (your email).
 */
export default function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [step, setStep] = useState("signin");
  const [checkingSession, setCheckingSession] = useState(true);
  const [loading, setLoading] = useState(false);
  // { text, action? }: action "signin" offers "Sign in instead"
  const [error, setError] = useState(() => (OAUTH_ERRORS[params.get("error")] ? { text: OAUTH_ERRORS[params.get("error")] } : null));
  const [message, setMessage] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);
  const [resendIn, setResendIn] = useState(0);
  const [form, setForm] = useState({ name: "", username: "", identifier: "", email: "", password: "", newPassword: "", code: "" });

  // The art wall: the homepage's featured games.
  const [covers, setCovers] = useState([]);
  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/api/hero`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => !cancelled && setCovers(list.map((g) => g.cover).filter(Boolean).slice(0, WALL)))
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Already signed in (any kind of account): straight on.
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API}/auth/user`, { credentials: "include", signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((user) => {
        if (user?._id) navigate("/dashboard", { replace: true });
        else setCheckingSession(false);
      })
      .catch((err) => err.name !== "AbortError" && setCheckingSession(false));
    return () => controller.abort();
  }, [navigate]);

  // Countdowns: a rate limit's wait, and the resend button's.
  const ticking = retryAfter > 0 || resendIn > 0;
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => {
      setRetryAfter((s) => Math.max(0, s - 1));
      setResendIn((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [ticking]);

  const change = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  const go = (next, keep = {}) => {
    setStep(next);
    setError(null);
    setMessage(keep.message ?? "");
  };

  // POST a step's data; the server's own words on failure (and, for an
  // existing email, a way over to sign-in).
  const post = async (path, body) => {
    setLoading(true);
    setError(null);
    setMessage("");
    try {
      const res = await fetch(`${API}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 429) setRetryAfter(parseInt(res.headers.get("Retry-After") || "0", 10) || 0);
        setError({
          text: data.message || data.error || "Something went wrong. Try again.",
          action: data.code === "EMAIL_EXISTS" ? "signin" : null,
        });
        return null;
      }
      return data;
    } catch {
      setError({ text: "Couldn't reach the server. Check your connection and try again." });
      return null;
    } finally {
      setLoading(false);
    }
  };

  const signIn = async (e) => {
    e.preventDefault();
    if (await post("/auth/login", { identifier: form.identifier, password: form.password })) {
      navigate("/dashboard", { replace: true });
    }
  };

  const sendSignupCode = async (e) => {
    e?.preventDefault();
    if (form.password.length < MIN_PASSWORD) {
      setError({ text: `Use at least ${MIN_PASSWORD} characters for your password.` });
      return;
    }
    const data = await post("/auth/send-otp", { name: form.name, username: form.username, email: form.email, password: form.password });
    if (!data) return;
    setResendIn(RESEND_WAIT);
    if (step !== "signupCode") {
      setForm((f) => ({ ...f, code: "" }));
      go("signupCode");
    } else setMessage("We sent a new code.");
  };

  const verifySignup = async (e) => {
    e.preventDefault();
    if (await post("/auth/verify-otp", { email: form.email, otp: form.code })) {
      navigate("/dashboard", { replace: true });
    }
  };

  const sendResetCode = async (e) => {
    e?.preventDefault();
    const data = await post("/auth/forgot-password", { email: form.email });
    if (!data) return;
    setResendIn(RESEND_WAIT);
    if (step !== "resetCode") {
      setForm((f) => ({ ...f, code: "", newPassword: "" }));
      go("resetCode");
    } else setMessage("We sent a new code.");
  };

  const resetPassword = async (e) => {
    e.preventDefault();
    if (form.newPassword.length < MIN_PASSWORD) {
      setError({ text: `Use at least ${MIN_PASSWORD} characters for your password.` });
      return;
    }
    const data = await post("/auth/reset-password", { email: form.email, otp: form.code, newPassword: form.newPassword });
    if (!data) return;
    setForm((f) => ({ ...f, identifier: f.email, password: "", newPassword: "", code: "" }));
    go("signin", { message: data.message || "Password updated. Sign in with your new one." });
  };

  // "Sign in instead" after an existing email: that email, ready to sign in.
  const toSignIn = () => {
    setForm((f) => ({ ...f, identifier: f.email || f.identifier, password: "" }));
    go("signin");
  };

  const social = (provider) => { window.location.href = `${API}/auth/${provider}`; };

  const HEAD = {
    signin: ["Welcome back", "Sign in to your games, friends and voice rooms."],
    signup: ["Create your account", "Join GameSocial: your games, your friends, one place."],
    signupCode: ["Check your email", <>We sent a 6-digit code to <b>{form.email}</b>. Enter it to finish creating your account.</>],
    forgot: ["Forgot your password?", "Enter your account's email and we'll send you a code to set a new one."],
    resetCode: ["Set a new password", <>Enter the 6-digit code we sent to <b>{form.email}</b>, then choose a new password.</>],
  };
  const [heading, sub] = HEAD[step];
  const blocked = loading || retryAfter > 0;
  const onCodeStep = step === "signupCode" || step === "resetCode";

  const codeInput = (
    <input
      className={`${styles.input} ${styles.code}`}
      name="code"
      placeholder="6-digit code"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]{6}"
      maxLength={6}
      title="The 6 digits from the email"
      value={form.code}
      onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
      required
      autoFocus
    />
  );
  const resend = (
    <div className={styles.codeFoot}>
      <span>Didn't get it? Check spam, or</span>
      <button type="button" className={styles.link} disabled={resendIn > 0 || blocked} onClick={step === "signupCode" ? () => sendSignupCode() : () => sendResetCode()}>
        {resendIn > 0 ? `resend in ${resendIn}s` : "send a new code"}
      </button>
    </div>
  );

  return (
    <div className={styles.auth}>
      {covers.length > 0 && (
        <div className={styles.wall} aria-hidden="true">
          {columns(covers).map((col, c) => (
            <div key={c} className={styles.col}>
              <div className={styles.track} style={{ "--dur": `${110 + c * 14}s` }}>
                {[...col, ...col].map((src, i) => (
                  <img key={i} src={gameArt(src, 640)} alt="" draggable="false" />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className={styles.shade} aria-hidden="true" />

      <main className={styles.panel}>
        {checkingSession ? (
          <p className={styles.checking}>Checking if you're signed in…</p>
        ) : (
          <>
            {onCodeStep && (
              <button
                type="button"
                className={styles.back}
                onClick={() => go(step === "signupCode" ? "signup" : "forgot")}
              >
                <ArrowLeft size={15} /> Back
              </button>
            )}

            <header className={styles.head}>
              <h1 className={styles.title}>{heading}</h1>
              <p className={styles.sub}>{sub}</p>
            </header>

            {step === "signin" && (
              <form className={styles.form} onSubmit={signIn}>
                <input className={styles.input} name="identifier" placeholder="Email or username" autoComplete="username" value={form.identifier} onChange={change} required />
                <input className={styles.input} type="password" name="password" placeholder="Password" autoComplete="current-password" value={form.password} onChange={change} required />
                <button
                  type="button"
                  className={styles.forgot}
                  onClick={() => {
                    setForm((f) => ({ ...f, email: f.identifier.includes("@") ? f.identifier : f.email }));
                    go("forgot");
                  }}
                >
                  Forgot password?
                </button>
                <button className={styles.primary} type="submit" disabled={blocked}>
                  {loading ? "Signing in…" : "Sign in"}
                </button>
              </form>
            )}

            {step === "signup" && (
              <form className={styles.form} onSubmit={sendSignupCode}>
                <div className={styles.row}>
                  <input className={styles.input} name="name" placeholder="Your name" autoComplete="name" value={form.name} onChange={change} required />
                  <input className={styles.input} name="username" placeholder="Username" autoComplete="username" pattern="[A-Za-z0-9_\-]{3,20}" title="3–20 characters: letters, numbers, _ and -" value={form.username} onChange={change} required />
                </div>
                <input className={styles.input} type="email" name="email" placeholder="Email" autoComplete="email" value={form.email} onChange={change} required />
                <div>
                  <input className={styles.input} type="password" name="password" placeholder="Password" autoComplete="new-password" minLength={MIN_PASSWORD} value={form.password} onChange={change} required />
                  <p className={styles.hint}>At least {MIN_PASSWORD} characters.</p>
                </div>
                <button className={styles.primary} type="submit" disabled={blocked}>
                  {loading ? "Sending code…" : "Continue"}
                </button>
              </form>
            )}

            {step === "signupCode" && (
              <form className={styles.form} onSubmit={verifySignup}>
                {codeInput}
                <button className={styles.primary} type="submit" disabled={blocked || form.code.length !== 6}>
                  {loading ? "Creating your account…" : "Create account"}
                </button>
                {resend}
              </form>
            )}

            {step === "forgot" && (
              <form className={styles.form} onSubmit={sendResetCode}>
                <input className={styles.input} type="email" name="email" placeholder="Your email" autoComplete="email" value={form.email} onChange={change} required autoFocus />
                <button className={styles.primary} type="submit" disabled={blocked}>
                  {loading ? "Sending code…" : "Send code"}
                </button>
              </form>
            )}

            {step === "resetCode" && (
              <form className={styles.form} onSubmit={resetPassword}>
                {codeInput}
                <div>
                  <input className={styles.input} type="password" name="newPassword" placeholder="New password" autoComplete="new-password" minLength={MIN_PASSWORD} value={form.newPassword} onChange={change} required />
                  <p className={styles.hint}>At least {MIN_PASSWORD} characters.</p>
                </div>
                <button className={styles.primary} type="submit" disabled={blocked || form.code.length !== 6}>
                  {loading ? "Updating…" : "Update password"}
                </button>
                {resend}
              </form>
            )}

            {message && <p className={styles.success} role="status">{message}</p>}
            {error && (
              <p className={styles.error} role="alert">
                {error.text}
                {error.action === "signin" && (
                  <button type="button" className={styles.link} onClick={toSignIn}>Sign in instead</button>
                )}
                {retryAfter > 0 && (
                  <span className={styles.retry}>
                    Try again in {Math.floor(retryAfter / 60)}:{String(retryAfter % 60).padStart(2, "0")}
                  </span>
                )}
              </p>
            )}

            {(step === "signin" || step === "signup") && (
              <>
                <div className={styles.divider}><span>or continue with</span></div>
                <div className={styles.social}>
                  <button type="button" onClick={() => social("google")}>Google</button>
                  <button type="button" onClick={() => social("steam")}>Steam</button>
                  <button type="button" disabled title="Epic Games sign-in is coming soon">
                    Epic Games <span className={styles.soon}>Soon</span>
                  </button>
                </div>
              </>
            )}

            {step === "signin" && (
              <p className={styles.switch}>
                New to GameSocial?{" "}
                <button type="button" onClick={() => go("signup")}>Create an account</button>
              </p>
            )}
            {step === "signup" && (
              <p className={styles.switch}>
                Already have an account? <button type="button" onClick={() => go("signin")}>Sign in</button>
              </p>
            )}
            {step === "forgot" && (
              <p className={styles.switch}>
                Remembered it? <button type="button" onClick={() => go("signin")}>Sign in</button>
                <span className={styles.dot} aria-hidden="true">·</span>
                New here? <button type="button" onClick={() => go("signup")}>Create an account</button>
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
