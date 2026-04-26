import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { signInWithEmailAndPassword } from "firebase/auth";

import { auth } from "../firebase";
import { useAuth } from "../auth/useAuth";

export default function LoginPage() {
  const location = useLocation();

  const { loading, isAuthenticated, isOnboardingComplete } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const fromPath = location.state?.from?.pathname || "/";

  async function handleLogin(event) {
    event.preventDefault();

    setBusy(true);
    setErrorMessage("");

    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (error) {
      console.error("Login failed:", error);
      setErrorMessage("Login failed. Please check your email and password.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="page-center">
        <div className="panel">
          <h2>Loading iREPS...</h2>
          <p>Checking your session.</p>
        </div>
      </div>
    );
  }

  if (isAuthenticated && isOnboardingComplete) {
    return <Navigate to={fromPath} replace />;
  }

  if (isAuthenticated && !isOnboardingComplete) {
    return <Navigate to="/pending-approval" replace />;
  }

  return (
    <div className="page-center">
      <div className="login-card">
        <div className="brand-block">
          <p className="eyebrow">iREPS Desktop</p>
          <h1>Sign in</h1>
          <p className="muted">
            Access the iREPS command centre for registries, reports, teams, and
            administration.
          </p>
        </div>

        <form onSubmit={handleLogin} className="form-stack">
          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
            />
          </label>

          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              required
            />
          </label>

          {errorMessage ? <p className="error-text">{errorMessage}</p> : null}

          <button type="submit" disabled={busy}>
            {busy ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
