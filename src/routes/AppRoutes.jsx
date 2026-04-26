import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import ProtectedRoute from "../auth/ProtectedRoute";
import RoleRoute from "../auth/RoleRoute";
import ConsoleLayout from "../layouts/ConsoleLayout";

import AccessDeniedPage from "../pages/AccessDeniedPage";
import ComingSoonPage from "../pages/ComingSoonPage";
import DashboardPage from "../pages/DashboardPage";
import LoginPage from "../pages/LoginPage";
import PendingApprovalPage from "../pages/PendingApprovalPage";

import RegistryLandingPage from "../pages/registries/RegistryLandingPage";
import WardsRegistryPage from "../pages/registries/WardsRegistryPage";
import ErfsRegistryPage from "../pages/registries/ErfsRegistryPage";
import PremisesRegistryPage from "../pages/registries/PremisesRegistryPage";
import MetersRegistryPage from "../pages/registries/MetersRegistryPage";

import ReportsLandingPage from "../pages/reports/ReportsLandingPage";
import NoAccessReportPage from "../pages/reports/NoAccessReportPage";
import UserActivityReportPage from "../pages/reports/UserActivityReportPage";
import AnomalyReportPage from "../pages/reports/AnomalyReportPage";
import NormalisationReportPage from "../pages/reports/NormalisationReportPage";
import MapPage from "../pages/maps/MapPage";
import ErfsPage from "@/pages/ward-scope/ErfsPage";
import PremisesPage from "@/pages/ward-scope/PremisesPage";
import MetersPage from "../pages/ward-scope/MetersPage";

const ALL_OPERATIONAL_ROLES = ["SPU", "ADM", "MNG", "SPV", "FWR"];
const MANAGEMENT_ROLES = ["SPU", "ADM", "MNG", "SPV"];
const ADMIN_ROLES = ["SPU", "ADM", "MNG"];

export default function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/pending-approval" element={<PendingApprovalPage />} />

        <Route
          element={
            <ProtectedRoute>
              <ConsoleLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<Navigate to="/dashboard" replace />} />

          <Route
            path="/dashboard"
            element={
              <RoleRoute allowedRoles={ALL_OPERATIONAL_ROLES}>
                <DashboardPage />
              </RoleRoute>
            }
          />

          <Route path="/access-denied" element={<AccessDeniedPage />} />

          {/* REGISTRIES */}

          <Route
            path="/registries"
            element={
              <RoleRoute allowedRoles={MANAGEMENT_ROLES}>
                <RegistryLandingPage />
              </RoleRoute>
            }
          />

          <Route
            path="/registries/wards"
            element={
              <RoleRoute allowedRoles={MANAGEMENT_ROLES}>
                <WardsRegistryPage />
              </RoleRoute>
            }
          />

          <Route
            path="/registries/erfs"
            element={
              <RoleRoute allowedRoles={MANAGEMENT_ROLES}>
                <ErfsRegistryPage />
              </RoleRoute>
            }
          />

          <Route
            path="/registries/premises"
            element={
              <RoleRoute allowedRoles={MANAGEMENT_ROLES}>
                <PremisesRegistryPage />
              </RoleRoute>
            }
          />

          <Route
            path="/registries/meters"
            element={
              <RoleRoute allowedRoles={MANAGEMENT_ROLES}>
                <MetersRegistryPage />
              </RoleRoute>
            }
          />

          {/* REPORTS */}

          <Route
            path="/reports"
            element={
              <RoleRoute allowedRoles={MANAGEMENT_ROLES}>
                <ReportsLandingPage />
              </RoleRoute>
            }
          />

          <Route
            path="/reports/no-access"
            element={
              <RoleRoute allowedRoles={MANAGEMENT_ROLES}>
                <NoAccessReportPage />
              </RoleRoute>
            }
          />

          <Route
            path="/reports/user-activity"
            element={
              <RoleRoute allowedRoles={MANAGEMENT_ROLES}>
                <UserActivityReportPage />
              </RoleRoute>
            }
          />

          <Route
            path="/reports/anomaly"
            element={
              <RoleRoute allowedRoles={MANAGEMENT_ROLES}>
                <AnomalyReportPage />
              </RoleRoute>
            }
          />

          <Route
            path="/reports/normalisation"
            element={
              <RoleRoute allowedRoles={MANAGEMENT_ROLES}>
                <NormalisationReportPage />
              </RoleRoute>
            }
          />

          {/* WARD SCOPE   */}
          <Route
            path="/ward-scope/map"
            element={
              <RoleRoute allowedRoles={MANAGEMENT_ROLES}>
                <MapPage />
              </RoleRoute>
            }
          />

          <Route
            path="/ward-scope/erfs"
            element={
              <RoleRoute allowedRoles={MANAGEMENT_ROLES}>
                <ErfsPage />
              </RoleRoute>
            }
          />

          <Route
            path="/ward-scope/premises"
            element={
              <RoleRoute allowedRoles={MANAGEMENT_ROLES}>
                <PremisesPage />
              </RoleRoute>
            }
          />

          <Route
            path="/ward-scope/meters"
            element={
              <RoleRoute allowedRoles={MANAGEMENT_ROLES}>
                <MetersPage />
              </RoleRoute>
            }
          />

          <Route
            path="/ward-scope/geofences"
            element={
              <RoleRoute allowedRoles={MANAGEMENT_ROLES}>
                <ComingSoonPage
                  title="Ward Scope Geofences"
                  description="View-only geofence grouping and spatial interrogation tools."
                />
              </RoleRoute>
            }
          />

          <Route
            path="/maps"
            element={<Navigate to="/ward-scope/maps" replace />}
          />

          {/* ADMIN */}

          <Route
            path="/admin/service-providers"
            element={
              <RoleRoute allowedRoles={MANAGEMENT_ROLES}>
                <ComingSoonPage
                  title="Service Providers"
                  description="LM-wide service provider oversight."
                />
              </RoleRoute>
            }
          />

          <Route
            path="/admin/users"
            element={
              <RoleRoute allowedRoles={MANAGEMENT_ROLES}>
                <ComingSoonPage
                  title="Users"
                  description="LM-wide user oversight."
                />
              </RoleRoute>
            }
          />

          <Route
            path="/admin/teams"
            element={
              <RoleRoute allowedRoles={MANAGEMENT_ROLES}>
                <ComingSoonPage
                  title="Teams"
                  description="LM-wide team visibility and management."
                />
              </RoleRoute>
            }
          />

          <Route
            path="/admin/settings"
            element={
              <RoleRoute allowedRoles={ADMIN_ROLES}>
                <ComingSoonPage
                  title="Settings"
                  description="LM scope settings and configuration."
                />
              </RoleRoute>
            }
          />

          <Route
            path="/admin"
            element={
              <RoleRoute allowedRoles={ADMIN_ROLES}>
                <ComingSoonPage
                  title="Admin"
                  description="Controlled administration tools for users, service providers, teams, and settings."
                  cards={[
                    {
                      title: "Users",
                      description:
                        "Review users, roles, onboarding, and authorisation.",
                    },
                    {
                      title: "Teams",
                      description:
                        "Manage operational teams for work allocation.",
                    },
                    {
                      title: "Settings",
                      description:
                        "Manage dropdown/select options and platform configuration.",
                    },
                  ]}
                />
              </RoleRoute>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
