import { Navigate } from "react-router-dom";

import { useAuth } from "../auth/useAuth";

export default function PendingApprovalPage() {
  const {
    loading,
    isAuthenticated,
    profileExists,
    profileMissing,
    isOnboardingComplete,
    email,
    role,
    onboardingStatus,
    serviceProvider,
  } = useAuth();

  if (loading) {
    return (
      <div className="page-center">
        <div className="panel">
          <h2>Loading iREPS...</h2>
          <p>Checking your account status.</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (profileExists && isOnboardingComplete) {
    return <Navigate to="/" replace />;
  }

  const serviceProviderName =
    serviceProvider?.name || serviceProvider?.id || "NAv";

  return (
    <div className="page-center">
      <div className="panel">
        <p className="eyebrow">Account status</p>

        <h1>Account not ready yet</h1>

        {profileMissing ? (
          <p>
            Your login exists, but your iREPS user profile was not found in the
            users collection.
          </p>
        ) : (
          <p>Your iREPS account exists, but onboarding is not complete yet.</p>
        )}

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
            <span>Onboarding</span>
            <strong>{onboardingStatus || "NAv"}</strong>
          </div>
        </div>

        <p className="muted">
          Please wait for an iREPS administrator or manager to complete your
          approval/onboarding process.
        </p>
      </div>
    </div>
  );
}
