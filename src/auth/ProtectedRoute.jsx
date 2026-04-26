import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "./useAuth";

export default function ProtectedRoute({ children }) {
  const location = useLocation();

  const { loading, isAuthenticated, profileMissing, isOnboardingComplete } =
    useAuth();

  if (loading) {
    return (
      <div className="page-center">
        <div className="panel">
          <h2>Loading iREPS...</h2>
          <p>Checking your session and profile.</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (profileMissing) {
    return <Navigate to="/pending-approval" replace />;
  }

  if (!isOnboardingComplete) {
    return <Navigate to="/pending-approval" replace />;
  }

  return children;
}
