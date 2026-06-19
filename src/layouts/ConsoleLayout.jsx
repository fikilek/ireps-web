import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { signOut } from "firebase/auth";

import { useAuth } from "../auth/useAuth";
import { auth } from "../firebase";

const ALL_OPERATIONAL_ROLES = ["SPU", "ADM", "MNG", "SPV", "FWR"];
const MANAGEMENT_ROLES = ["SPU", "ADM", "MNG", "SPV"];
const ADMIN_ROLES = ["SPU", "ADM", "MNG"];
const MREAD_STAGING_CONTROLLER_ROLES = ["SPU", "MNG", "SPV"];

const navSections = [
  {
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
          {
            label: "MREAD Registry",
            path: "/registries/mread",
            allowedRoles: MANAGEMENT_ROLES,
          },
          {
            label: "Account Registry",
            path: "/registries/accounts",
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
      {
        label: "Operations",
        items: [
          {
            label: "Operations Overview",
            path: "/operations",
            allowedRoles: MANAGEMENT_ROLES,
          },
          {
            label: "TC Uploads",
            path: "/operations/tc-uploads",
            allowedRoles: MANAGEMENT_ROLES,
          },
          {
            label: "MD BGO",
            path: "/operations/bgo",
            allowedRoles: MANAGEMENT_ROLES,
          },
          {
            label: "BGO Dashboard",
            path: "/operations/bgo-dashboard",
            allowedRoles: MANAGEMENT_ROLES,
          },
          {
            label: "Operational Teams",
            path: "/operations/teams",
            allowedRoles: MANAGEMENT_ROLES,
          },
          {
            label: "Geo-Fences",
            path: "/operations/geo-fences",
            allowedRoles: MANAGEMENT_ROLES,
          },
          {
            label: "WMS Dashboard",
            path: "/operations/wms-dashboard",
            allowedRoles: MANAGEMENT_ROLES,
          },
        ],
      },
      {
        label: "Admin",
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
            label: "MREAD Staging Controller",
            path: "/admin/mread-staging-controller",
            allowedRoles: MREAD_STAGING_CONTROLLER_ROLES,
          },
          {
            label: "Settings",
            path: "/admin/settings",
            allowedRoles: ADMIN_ROLES,
          },
        ],
      },
    ],
  },
];

const sidebarStyles = {
  mainLink: {
    fontSize: "0.98rem",
    fontWeight: 850,
    letterSpacing: "0.01em",
  },
  groupButton: {
    width: "100%",
    border: 0,
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0.66rem 0.75rem",
    borderRadius: "0.85rem",
    fontSize: "0.98rem",
    fontWeight: 850,
    letterSpacing: "0.01em",
    textAlign: "left",
  },
  groupButtonOpen: {
    background: "rgba(15, 23, 42, 0.06)",
  },
  groupArrow: {
    fontSize: "0.78rem",
    fontWeight: 900,
    opacity: 0.72,
  },
  groupItems: {
    marginTop: "0.25rem",
    paddingLeft: "0.45rem",
  },
  childLink: {
    fontSize: "0.88rem",
    fontWeight: 650,
  },
};

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
      items: getVisibleItems(section.items || [], role),
      groups: getVisibleGroups(section.groups || [], role),
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

function getActiveNavItem(items = [], pathname) {
  if (pathname.includes("/bgo-dashboard")) {
    const bgoDashboardItem = items.find(
      (item) => item.path === "/operations/bgo-dashboard",
    );

    if (bgoDashboardItem) {
      return bgoDashboardItem;
    }
  }

  const matchingItems = items.filter((item) => pathname.startsWith(item.path));

  if (matchingItems.length === 0) {
    return items[0];
  }

  return matchingItems.sort((a, b) => b.path.length - a.path.length)[0];
}

function isGroupActive(group, pathname) {
  return (group?.items || []).some((item) => pathname.startsWith(item.path));
}

function buildToggleKey(groupLabel) {
  return String(groupLabel || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

export default function ConsoleLayout() {
  const location = useLocation();
  const [openGroups, setOpenGroups] = useState({});

  const { email, profile, role, serviceProvider, activeWorkbase } = useAuth();

  const displayName = getDisplayName(profile, email);
  const serviceProviderName = getServiceProviderName(serviceProvider);
  const activeWorkbaseName = getActiveWorkbaseName(activeWorkbase);

  const visibleSections = getVisibleSections(role);
  const visibleNavItems = getFlatNavItems(visibleSections);

  const activeNavItem = getActiveNavItem(visibleNavItems, location.pathname);
  const hideTopbarForRegistryRoutes =
    location.pathname === "/registries" ||
    location.pathname.startsWith("/registries/");

  function handleToggleGroup(groupLabel) {
    const key = buildToggleKey(groupLabel);

    setOpenGroups((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  function isOpenGroup(group) {
    const key = buildToggleKey(group.label);
    return openGroups[key] === true;
  }

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
                    style={sidebarStyles.mainLink}
                  >
                    {item.label}
                  </NavLink>
                ))}

                {(section.groups || []).map((group) => {
                  const groupOpen = isOpenGroup(group);
                  const groupActive = isGroupActive(group, location.pathname);

                  return (
                    <div key={group.label} className="sidebar-nav-group">
                      <button
                        type="button"
                        className={`sidebar-group-title-button${
                          groupActive ? " active" : ""
                        }`}
                        style={{
                          ...sidebarStyles.groupButton,
                          ...(groupOpen || groupActive
                            ? sidebarStyles.groupButtonOpen
                            : null),
                        }}
                        onClick={() => handleToggleGroup(group.label)}
                        aria-expanded={groupOpen}
                        aria-controls={`sidebar-group-${buildToggleKey(group.label)}`}
                      >
                        <span>{group.label}</span>
                        <span style={sidebarStyles.groupArrow}>
                          {groupOpen ? "▾" : "▸"}
                        </span>
                      </button>

                      {groupOpen ? (
                        <div
                          id={`sidebar-group-${buildToggleKey(group.label)}`}
                          style={sidebarStyles.groupItems}
                        >
                          {group.items.map((item) => (
                            <NavLink
                              key={item.path}
                              to={item.path}
                              className={({ isActive }) =>
                                isActive ? "active" : ""
                              }
                              style={sidebarStyles.childLink}
                            >
                              {item.label}
                            </NavLink>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
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

          <NavLink to="/profile" className="secondary-button">
            Profile
          </NavLink>

          <button className="secondary-button" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="console-main" style={{ paddingTop: 0 }}>
        {!hideTopbarForRegistryRoutes ? (
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
        ) : null}

        <Outlet />
      </main>
    </div>
  );
}
