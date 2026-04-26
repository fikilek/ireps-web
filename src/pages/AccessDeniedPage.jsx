import { Link } from "react-router-dom";

import { useAuth } from "../auth/useAuth";

export default function AccessDeniedPage() {
  const { role, email, serviceProvider } = useAuth();

  const serviceProviderName =
    serviceProvider?.name || serviceProvider?.id || "NAv";

  return (
    <section className="panel">
      <p className="eyebrow">Access denied</p>

      <h1>You do not have access to this section</h1>

      <p className="muted">
        Your current iREPS role does not allow access to the page you tried to
        open.
      </p>

      <div className="info-grid">
        <div>
          <span>Email</span>
          <strong>{email || "NAv"}</strong>
        </div>

        <div>
          <span>Role</span>
          <strong>{role || "NAv"}</strong>
        </div>

        <div>
          <span>Service Provider</span>
          <strong>{serviceProviderName}</strong>
        </div>

        <div>
          <span>Action</span>
          <strong>Blocked</strong>
        </div>
      </div>

      <Link className="text-link" to="/dashboard">
        Return to dashboard
      </Link>
    </section>
  );
}
