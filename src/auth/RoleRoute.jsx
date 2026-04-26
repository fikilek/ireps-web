import { Navigate } from "react-router-dom";

import { useAuth } from "./useAuth";

export default function RoleRoute({ allowedRoles = [], children }) {
  const { role, loading, isAuthenticated } = useAuth();

  if (loading) {
    return (
      <div className="page-center">
        <div className="panel">
          <h2>Loading iREPS...</h2>
          <p>Checking your role permissions.</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!allowedRoles.includes(role)) {
    return <Navigate to="/access-denied" replace />;
  }

  return children;
}
