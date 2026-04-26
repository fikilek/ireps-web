import { NavLink, Outlet, useLocation } from "react-router-dom";
import { signOut } from "firebase/auth";

import { useAuth } from "../auth/useAuth";
import { auth } from "../firebase";

const ALL_OPERATIONAL_ROLES = ["SPU", "ADM", "MNG", "SPV", "FWR"];
const MANAGEMENT_ROLES = ["SPU", "ADM", "MNG", "SPV"];
const ADMIN_ROLES = ["SPU", "ADM", "MNG"];

const navSections = [
  {
    // title: "Ward Scope",
    items: [
      {
        label: "Map",
        path: "/ward-scope/map",
        allowedRoles: MANAGEMENT_ROLES,
      },
      {
        label: "ERFs",
        path: "/ward-scope/erfs",
        allowedRoles: MANAGEMENT_ROLES,
      },
      {
        label: "Premises",
        path: "/ward-scope/premises",
        allowedRoles: MANAGEMENT_ROLES,
      },
      {
        label: "Meters",
        path: "/ward-scope/meters",
        allowedRoles: MANAGEMENT_ROLES,
      },
      {
        label: "Geofences",
        path: "/ward-scope/geofences",
        allowedRoles: MANAGEMENT_ROLES,
      },
    ],
  },
  {
    groups: [
      {
        label: "Registries",
        items: [
          {
            label: "Ward Registry",
            path: "/registries/wards",
            allowedRoles: MANAGEMENT_ROLES,
          },
          {
            label: "ERF Registry",
            path: "/registries/erfs",
            allowedRoles: MANAGEMENT_ROLES,
          },
          {
            label: "Premise Registry",
            path: "/registries/premises",
            allowedRoles: MANAGEMENT_ROLES,
          },
          {
            label: "Meter Registry",
            path: "/registries/meters",
            allowedRoles: MANAGEMENT_ROLES,
          },
        ],
      },
      {
        label: "Reports",
        items: [
          {
            label: "No Access",
            path: "/reports/no-access",
            allowedRoles: MANAGEMENT_ROLES,
          },
          {
            label: "Anomaly",
            path: "/reports/anomaly",
            allowedRoles: MANAGEMENT_ROLES,
          },
          {
            label: "Normalisation",
            path: "/reports/normalisation",
            allowedRoles: MANAGEMENT_ROLES,
          },
          {
            label: "User Activity",
            path: "/reports/user-activity",
            allowedRoles: MANAGEMENT_ROLES,
          },
        ],
      },
    ],
  },

  {
    title: "Admin",
    items: [
      {
        label: "Service Providers",
        path: "/admin/service-providers",
        allowedRoles: MANAGEMENT_ROLES,
      },
      {
        label: "Users",
        path: "/admin/users",
        allowedRoles: MANAGEMENT_ROLES,
      },
      {
        label: "Teams",
        path: "/admin/teams",
        allowedRoles: MANAGEMENT_ROLES,
      },
      {
        label: "Settings",
        path: "/admin/settings",
        allowedRoles: ADMIN_ROLES,
      },
    ],
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

function isItemAllowed(item, role) {
  return item.allowedRoles.includes(role);
}

function getVisibleItems(items = [], role) {
  return items.filter((item) => isItemAllowed(item, role));
}

function getVisibleGroups(groups = [], role) {
  return groups
    .map((group) => ({
      ...group,
      items: getVisibleItems(group.items, role),
    }))
    .filter((group) => group.items.length > 0);
}

function getVisibleSections(role) {
  return navSections
    .map((section) => ({
      ...section,
      items: getVisibleItems(section.items, role),
      groups: getVisibleGroups(section.groups, role),
    }))
    .filter(
      (section) =>
        (section.items && section.items.length > 0) ||
        (section.groups && section.groups.length > 0),
    );
}

function getFlatNavItems(sections = []) {
  return sections.flatMap((section) => {
    const directItems = section.items || [];
    const groupItems = (section.groups || []).flatMap((group) => group.items);

    return [...directItems, ...groupItems];
  });
}

export default function ConsoleLayout() {
  const location = useLocation();

  const { email, profile, role, serviceProvider, activeWorkbase } = useAuth();

  const displayName = getDisplayName(profile, email);
  const serviceProviderName = getServiceProviderName(serviceProvider);
  const activeWorkbaseName = getActiveWorkbaseName(activeWorkbase);

  const visibleSections = getVisibleSections(role);
  const visibleNavItems = getFlatNavItems(visibleSections);

  const activeNavItem =
    visibleNavItems.find((item) => location.pathname.startsWith(item.path)) ||
    visibleNavItems[0];

  async function handleSignOut() {
    await signOut(auth);
  }

  return (
    <div className="console-shell">
      <aside className="sidebar">
        <div className="sidebar-menu-shell">
          <div className="sidebar-brand">
            <div className="brand-mark">iR</div>

            <div>
              <h2>iREPS</h2>
            </div>
          </div>

          <nav>
            {visibleSections.map((section, sectionIndex) => (
              <div
                key={section.title || `section-${sectionIndex}`}
                className="sidebar-section"
              >
                {section.title ? (
                  <p className="sidebar-section-title">{section.title}</p>
                ) : null}

                {(section.items || []).map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    className={({ isActive }) => (isActive ? "active" : "")}
                  >
                    {item.label}
                  </NavLink>
                ))}

                {(section.groups || []).map((group) => (
                  <div key={group.label} className="sidebar-nav-group">
                    <p className="sidebar-group-title">{group.label}</p>

                    {group.items.map((item) => (
                      <NavLink
                        key={item.path}
                        to={item.path}
                        className={({ isActive }) => (isActive ? "active" : "")}
                      >
                        {item.label}
                      </NavLink>
                    ))}
                  </div>
                ))}
              </div>
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
