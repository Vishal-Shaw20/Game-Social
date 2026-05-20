import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./LoginPage.module.css";

function LoginPage() {
  const navigate = useNavigate();
  const [isSignup, setIsSignup] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpVerified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);
  const [message, setMessage] = useState("");

  const [formData, setFormData] = useState({
    name: "",
    username: "",
    identifier: "",
    email: "",
    password: "",
    newPassword: "",
  });


  const [otp, setOtp] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const checkSession = async () => {
      try {
        setCheckingSession(true);
        const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/user`, {
          method: "GET",
          credentials: "include",
          signal: controller.signal,
        });

        if (!res.ok) {
          setCheckingSession(false);
          return;
        }

        const data = await res.json();
        if (data && (data.user || data.email)) {
          navigate("/dashboard", { replace: true });
        } else {
          setCheckingSession(false);
        }
      } catch (err) {
        if (err.name !== "AbortError") {
          setCheckingSession(false);
        }
      }
    };

    checkSession();
    return () => controller.abort();
  }, [navigate]);

  useEffect(() => {
    if (retryAfter <= 0) return;
    const id = setInterval(() => {
      setRetryAfter((prev) => {
        if (prev <= 1) {
          clearInterval(id);
          setError("");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [retryAfter]);

  const checkRateLimit = (response) => {
    if (response.status === 429) {
      const secs = parseInt(response.headers.get("Retry-After") || "0");
      if (secs > 0) setRetryAfter(secs);
    }
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(formData),
      });

      const data = await response.json();
      if (!response.ok) {
        checkRateLimit(response);
        throw new Error(data.error || data.message || "Failed to send OTP");
      }

      setOtpSent(true);
      setMessage("OTP sent to your email. Please verify.");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: formData.email, otp }),
      });

      const data = await response.json();
      if (!response.ok) {
        checkRateLimit(response);
        throw new Error(data.error || data.message || "OTP verification failed");
      }

      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(formData),
      });

      const data = await response.json();
      if (!response.ok) {
        checkRateLimit(response);
        throw new Error(data.error || data.message || "Login failed");
      }

      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: formData.email }),
      });

      const data = await response.json();
      if (!response.ok) {
        checkRateLimit(response);
        throw new Error(data.error || data.message || "Failed to send OTP");
      }

      setOtpSent(true);
      setMessage("OTP sent to your email for password reset.");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: formData.email,
          otp,
          newPassword: formData.newPassword,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        checkRateLimit(response);
        throw new Error(data.error || data.message || "Password reset failed");
      }

      setMessage("Password reset successful. You can now login.");
      setIsForgotPassword(false);
      setOtpSent(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLogin = (provider) => {
    window.location.href = `${import.meta.env.VITE_API_URL}/auth/${provider}`;
  };

  if (checkingSession) {
    return (
      <div className={styles.authContainer}>
        <div className={styles.authCard}>
          <h2>Checking session...</h2>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.authContainer}>
      <div className={styles.authCard}>
        <h2>
          {isForgotPassword
            ? "Reset Password"
            : isSignup
            ? "Create Account"
            : "Welcome Back"}
        </h2>

        {!otpSent && isSignup && (
          <form onSubmit={handleSignup}>
            <input
              type="text"
              name="name"
              placeholder="Full Name"
              value={formData.name}
              onChange={handleChange}
              required
            />
            <input
              type="text"
              name="username"
              placeholder="Username"
              value={formData.username}
              onChange={handleChange}
              required
            />
            <input
              type="email"
              name="email"
              placeholder="Email"
              value={formData.email}
              onChange={handleChange}
              required
            />
            <input
              type="password"
              name="password"
              placeholder="Password"
              value={formData.password}
              onChange={handleChange}
              required
            />
            <button type="submit" disabled={loading || retryAfter > 0}>
              {loading ? "Sending OTP..." : "Send OTP"}
            </button>
          </form>
        )}

        {!otpSent && !isSignup && !isForgotPassword && (
          <form onSubmit={handleLogin}>
            <input
              type="text"
              name="identifier"
              placeholder="Email or Username"
              value={formData.identifier}
              onChange={handleChange}
              required
            />
            <input
              type="password"
              name="password"
              placeholder="Password"
              value={formData.password}
              onChange={handleChange}
              required
            />
            <button type="submit" disabled={loading || retryAfter > 0}>
              {loading ? "Logging in..." : "Login"}
            </button>

            <p
              className={styles.toggleText}
              onClick={() => {
                setIsForgotPassword(true);
                setError("");
                setMessage("");
              }}
            >
              Forgot Password?
            </p>
          </form>
        )}

        {isSignup && otpSent && (
          <form onSubmit={handleVerifyOtp}>
            <input
              type="text"
              name="otp"
              placeholder="Enter OTP"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              required
            />
            <button type="submit" disabled={loading || retryAfter > 0}>
              {loading ? "Verifying..." : "Verify OTP"}
            </button>
          </form>
        )}

        {isForgotPassword && !otpSent && (
          <form onSubmit={handleForgotPassword}>
            <input
              type="email"
              name="email"
              placeholder="Enter your email"
              value={formData.email}
              onChange={handleChange}
              required
            />
            <button type="submit" disabled={loading || retryAfter > 0}>
              {loading ? "Sending OTP..." : "Send OTP"}
            </button>
          </form>
        )}

        {isForgotPassword && otpSent && !otpVerified && (
          <form onSubmit={handleResetPassword}>
            <input
              type="text"
              name="otp"
              placeholder="Enter OTP"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              required
            />
            <input
              type="password"
              name="newPassword"
              placeholder="New Password"
              value={formData.newPassword}
              onChange={handleChange}
              required
            />
            <button type="submit" disabled={loading || retryAfter > 0}>
              {loading ? "Resetting..." : "Reset Password"}
            </button>
          </form>
        )}

        {message && <p className={styles.successText}>{message}</p>}
        {error && (
          <p className={styles.errorText}>
            {error}
            {retryAfter > 0 && (
              <span style={{ display: "block", marginTop: "4px", fontWeight: 600 }}>
                Try again in {Math.floor(retryAfter / 60)}:{String(retryAfter % 60).padStart(2, "0")}
              </span>
            )}
          </p>
        )}

        {!isForgotPassword && (
          <>
            <div className={styles.divider}>
              <span>OR</span>
            </div>
            <div className={styles.socialButtons}>
              <button onClick={() => handleSocialLogin("google")}>
                Login with Google
              </button>
              <button onClick={() => handleSocialLogin("steam")}>
                Login with Steam
              </button>
              <button onClick={() => handleSocialLogin("epic")}>
                Login with Epic Games
              </button>
            </div>
          </>
        )}

        <p
          onClick={() => {
            setIsSignup(!isSignup);
            setOtpSent(false);
            setError("");
            setMessage("");
            setIsForgotPassword(false);
          }}
          className={styles.toggleText}
        >
          {isSignup ? "Already have an account? Login here" : "Don't have an account? Sign up here"}
        </p>
      </div>
    </div>
  );
}

export default LoginPage;
