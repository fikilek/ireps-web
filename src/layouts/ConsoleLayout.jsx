import { NavLink, Outlet, useLocation } from "react-router-dom";
import { signOut } from "firebase/auth";

import { useAuth } from "../auth/useAuth";
import { auth } from "../firebase";

const navItems = [
  {
    label: "Dashboard",
    path: "/dashboard",
    allowedRoles: ["SPU", "ADM", "MNG", "SPV", "FWR"],
  },
  {
    label: "Map",
    path: "/maps",
    allowedRoles: ["SPU", "ADM", "MNG", "SPV"],
  },
  {
    label: "Registries",
    path: "/registries",
    allowedRoles: ["SPU", "ADM", "MNG", "SPV"],
  },
  {
    label: "Reports",
    path: "/reports",
    allowedRoles: ["SPU", "ADM", "MNG", "SPV"],
  },
  {
    label: "Admin",
    path: "/admin",
    allowedRoles: ["SPU", "ADM", "MNG"],
  },
];

function getDisplayName(profile, email) {
  return (
    profile?.displayName ||
    profile?.name ||
    profile?.personal?.displayName ||
    profile?.personal?.fullName ||
    email ||
    "iREPS User"
  );
}

function getServiceProviderName(serviceProvider) {
  return serviceProvider?.name || serviceProvider?.id || "NAv";
}

function getActiveWorkbaseName(activeWorkbase) {
  return (
    activeWorkbase?.name ||
    activeWorkbase?.lmName ||
    activeWorkbase?.id ||
    activeWorkbase?.pcode ||
    "NAv"
  );
}

export default function ConsoleLayout() {
  const location = useLocation();

  const { email, profile, role, serviceProvider, activeWorkbase } = useAuth();

  const displayName = getDisplayName(profile, email);
  const serviceProviderName = getServiceProviderName(serviceProvider);
  const activeWorkbaseName = getActiveWorkbaseName(activeWorkbase);

  const visibleNavItems = navItems.filter((item) =>
    item.allowedRoles.includes(role),
  );

  const activeNavItem =
    visibleNavItems.find((item) => location.pathname.startsWith(item.path)) ||
    visibleNavItems[0];

  async function handleSignOut() {
    await signOut(auth);
  }

  return (
    <div className="console-shell">
      <aside className="sidebar">
        <div>
          <div className="sidebar-brand">
            <div className="brand-mark">iR</div>

            <div>
              <h2>iREPS</h2>
              <p>Desktop Command Centre</p>
            </div>
          </div>

          <nav>
            {visibleNavItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) => (isActive ? "active" : "")}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <strong>{displayName}</strong>
            <span>{email || "NAv"}</span>
            <span>{serviceProviderName}</span>
          </div>

          <button className="secondary-button" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="console-main">
        <header className="topbar">
          <div>
            <p className="eyebrow">iREPS Desktop</p>
            <h1>{activeNavItem?.label || "Dashboard"}</h1>
          </div>

          <div className="topbar-right">
            <div className="workbase-pill">{activeWorkbaseName}</div>
            <div className="role-pill">{role || "NAv"}</div>
          </div>
        </header>

        <Outlet />
      </main>
    </div>
  );
}
