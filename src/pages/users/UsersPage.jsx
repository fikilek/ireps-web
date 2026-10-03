/* eslint-disable no-unused-vars -- JSX components are consumed by React. */
import { useEffect, useMemo, useState } from "react";
import { collection, getDocsFromServer } from "firebase/firestore";
import IrepsTable from "../../components/table/IrepsTable";
import { filterIrepsTableRows } from "../../components/table/irepsTableModel.js";
import {
  NO_TEAM,
  USERS_DEFAULT_SORT,
  userStatusLabel as statusLabel,
  usersTableColumns,
  usersTableSearchValue,
} from "./usersTableModel.js";

import { useAuth } from "../../auth/useAuth";
import { db } from "../../firebase";
import { useGetAvailableTeamsQuery } from "../../redux/teamsApi";
import {
  useGetUsersDirectoryQuery,
  useUpdateUserRoleMutation,
} from "../../redux/usersApi";

// Shared IrepsTable owns the table controls, filtering, sorting and pagination.

// UI-R002 section 2: platform roles see every user; everyone else sees only their
// own lineage — their company and every subcontractor below it.
const PLATFORM_ROLES = ["SPU", "ADM"];

function getParentServiceProviderIds(serviceProvider = {}) {
  return (Array.isArray(serviceProvider.clients) ? serviceProvider.clients : [])
    .filter(
      (client) =>
        normalizeUpper(client?.clientType) === "SP" &&
        normalizeUpper(client?.relationshipType) === "SUBC",
    )
    .map((client) => normalize(client?.id))
    .filter(Boolean);
}

// The viewer's company, then every company that is a subcontractor of it, all
// the way down.
function getLineageServiceProviderIds(rootId, serviceProviders = []) {
  const root = normalize(rootId);
  if (!root) return new Set();

  const childrenByParent = new Map();
  for (const serviceProvider of serviceProviders) {
    for (const parentId of getParentServiceProviderIds(serviceProvider)) {
      const children = childrenByParent.get(parentId) || [];
      children.push(serviceProvider.id);
      childrenByParent.set(parentId, children);
    }
  }

  const lineage = new Set([root]);
  const queue = [root];
  while (queue.length) {
    const current = queue.shift();
    for (const childId of childrenByParent.get(current) || []) {
      if (!lineage.has(childId)) {
        lineage.add(childId);
        queue.push(childId);
      }
    }
  }

  return lineage;
}

const ROLE_OPTIONS = [
  { value: "SPU", label: "Super User" },
  { value: "ADM", label: "Administrator" },
  { value: "MNG", label: "Manager" },
  { value: "SPV", label: "Supervisor" },
  { value: "FWR", label: "Field Worker" },
];

const STATUS_OPTIONS = [
  { value: "ENABLED", label: "Enabled" },
  { value: "DISABLED", label: "Disabled" },
];

const ROLE_LEVEL = Object.freeze({
  FWR: 1,
  SPV: 2,
  MNG: 3,
  ADM: 4,
  SPU: 5,
});

const styles = {
  page: {
    padding: "1.5rem",
    display: "grid",
    gap: "1rem",
  },
  intro: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: "1rem",
    flexWrap: "wrap",
  },
  title: {
    margin: 0,
    color: "#0f172a",
    fontSize: "1.5rem",
    fontWeight: 900,
  },
  subtitle: {
    margin: "0.35rem 0 0",
    color: "#64748b",
    fontSize: "0.92rem",
  },
  count: {
    color: "#475569",
    fontSize: "0.84rem",
    fontWeight: 800,
  },
  control: {
    minHeight: "2.6rem",
    border: "1px solid #cbd5e1",
    borderRadius: "0.75rem",
    background: "#ffffff",
    color: "#0f172a",
    padding: "0.55rem 0.75rem",
    fontSize: "0.9rem",
    outline: "none",
  },
  userName: {
    color: "#0f172a",
    fontWeight: 850,
  },
  muted: {
    color: "#64748b",
  },
  editableBadge: {
    border: "1px solid #cbd5e1",
    borderRadius: "999px",
    background: "#ffffff",
    color: "#0f172a",
    padding: "0.32rem 0.6rem",
    fontSize: "0.78rem",
    fontWeight: 900,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  roleCell: {
    display: "grid",
    justifyItems: "start",
    gap: "0.28rem",
  },
  roleFeedback: {
    fontSize: "0.7rem",
    fontWeight: 800,
    lineHeight: 1.25,
  },
  staticBadge: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: "999px",
    background: "#f1f5f9",
    color: "#475569",
    padding: "0.32rem 0.6rem",
    fontSize: "0.76rem",
    fontWeight: 850,
    whiteSpace: "nowrap",
  },
  empty: {
    padding: "3rem 1rem",
    color: "#64748b",
    textAlign: "center",
    fontSize: "0.92rem",
  },
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 1000,
    display: "grid",
    placeItems: "center",
    padding: "1rem",
    background: "rgba(15, 23, 42, 0.48)",
  },
  modal: {
    width: "min(460px, 100%)",
    borderRadius: "1rem",
    background: "#ffffff",
    boxShadow: "0 24px 60px rgba(15, 23, 42, 0.22)",
    overflow: "hidden",
  },
  modalHeader: {
    padding: "1rem 1.15rem",
    borderBottom: "1px solid #e2e8f0",
  },
  modalTitle: {
    margin: 0,
    color: "#0f172a",
    fontSize: "1.1rem",
    fontWeight: 900,
  },
  modalBody: {
    display: "grid",
    gap: "1rem",
    padding: "1.15rem",
  },
  field: {
    display: "grid",
    gap: "0.35rem",
  },
  label: {
    color: "#64748b",
    fontSize: "0.74rem",
    fontWeight: 900,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  },
  value: {
    color: "#0f172a",
    fontSize: "0.96rem",
    fontWeight: 800,
  },
  modalNote: {
    margin: 0,
    borderRadius: "0.75rem",
    background: "#f8fafc",
    color: "#64748b",
    padding: "0.7rem 0.8rem",
    fontSize: "0.78rem",
    lineHeight: 1.45,
  },
  modalFeedback: {
    margin: 0,
    borderRadius: "0.75rem",
    border: "1px solid transparent",
    padding: "0.7rem 0.8rem",
    fontSize: "0.82rem",
    fontWeight: 800,
    lineHeight: 1.4,
  },
  modalFooter: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "0.65rem",
    padding: "0.95rem 1.15rem",
    borderTop: "1px solid #e2e8f0",
    background: "#f8fafc",
  },
  secondaryButton: {
    minHeight: "2.45rem",
    border: "1px solid #cbd5e1",
    borderRadius: "0.75rem",
    background: "#ffffff",
    color: "#334155",
    padding: "0.5rem 0.9rem",
    fontWeight: 850,
    cursor: "pointer",
  },
  primaryButton: {
    minHeight: "2.45rem",
    border: 0,
    borderRadius: "0.75rem",
    background: "#0f172a",
    color: "#ffffff",
    padding: "0.5rem 0.95rem",
    fontWeight: 850,
  },
};

function normalize(value) {
  return String(value || "").trim();
}

function normalizeUpper(value) {
  return normalize(value).toUpperCase();
}

function roleLabel(role) {
  const code = normalizeUpper(role);
  return ROLE_OPTIONS.find((option) => option.value === code)?.label || code || "NAv";
}

function getAssignableRoleOptions(actorRole) {
  const normalizedActorRole = normalizeUpper(actorRole);

  if (normalizedActorRole === "SPU") return ROLE_OPTIONS;

  const actorLevel = ROLE_LEVEL[normalizedActorRole] || 0;

  return ROLE_OPTIONS.filter(
    (option) => (ROLE_LEVEL[option.value] || 0) < actorLevel,
  );
}

function canManageTargetRole({ actorUid, actorRole, targetUid, targetRole }) {
  if (!actorUid || !targetUid || actorUid === targetUid) return false;

  const normalizedActorRole = normalizeUpper(actorRole);
  const normalizedTargetRole = normalizeUpper(targetRole);

  if (normalizedActorRole === "SPU") return true;

  if (!["ADM", "MNG"].includes(normalizedActorRole)) return false;

  const actorLevel = ROLE_LEVEL[normalizedActorRole] || 0;
  const targetLevel = ROLE_LEVEL[normalizedTargetRole] || 0;

  return targetLevel > 0 && actorLevel > targetLevel;
}

function getRoleEditDisabledReason({
  actorUid,
  actorRole,
  targetUid,
  targetRole,
}) {
  if (actorUid === targetUid) return "You cannot change your own role.";

  if (canManageTargetRole({ actorUid, actorRole, targetUid, targetRole })) {
    return "";
  }

  return "You cannot change a user at your role level or above.";
}

function getMutationErrorMessage(error) {
  return (
    error?.data?.message ||
    error?.error ||
    error?.message ||
    "Could not update the user role."
  );
}

function isStatusDisabled(status) {
  const value = normalizeUpper(status);
  return value === "DISABLED" || value === "INACTIVE";
}

function EditRoleModal({ user, actorRole, onClose, onUpdateRole }) {
  const currentRole = normalizeUpper(user?.role);
  const allowedRoleOptions = getAssignableRoleOptions(actorRole);
  const [newRole, setNewRole] = useState(currentRole);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const updateDisabled =
    isSaving ||
    feedback?.type === "success" ||
    !newRole ||
    newRole === currentRole;

  async function handleUpdateRole() {
    if (updateDisabled) return;

    setIsSaving(true);
    setFeedback({
      type: "pending",
      message: "Updating role...",
    });

    try {
      const result = await onUpdateRole(user, newRole);

      setFeedback({
        type: "success",
        message: result?.message || "Role updated successfully.",
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message: getMutationErrorMessage(error),
      });
    } finally {
      setIsSaving(false);
    }
  }

  const feedbackStyle =
    feedback?.type === "success"
      ? { background: "#f0fdf4", borderColor: "#bbf7d0", color: "#166534" }
      : feedback?.type === "error"
        ? { background: "#fef2f2", borderColor: "#fecaca", color: "#b91c1c" }
        : { background: "#eff6ff", borderColor: "#bfdbfe", color: "#1d4ed8" };

  return (
    <div
      style={styles.overlay}
      role="presentation"
      onMouseDown={isSaving ? undefined : onClose}
    >
      <section
        style={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-user-role-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header style={styles.modalHeader}>
          <h2 id="edit-user-role-title" style={styles.modalTitle}>
            Edit User Role
          </h2>
        </header>

        <div style={styles.modalBody}>
          <div style={styles.field}>
            <span style={styles.label}>User</span>
            <span style={styles.value}>{user?.displayName || "NAv"}</span>
          </div>

          <div style={styles.field}>
            <span style={styles.label}>Current Role</span>
            <span style={styles.value}>
              {currentRole || "NAv"} · {roleLabel(currentRole)}
            </span>
          </div>

          <label style={styles.field}>
            <span style={styles.label}>New Role</span>
            <select
              style={styles.control}
              value={newRole}
              disabled={isSaving || feedback?.type === "success"}
              onChange={(event) => {
                setNewRole(event.target.value);
                setFeedback(null);
              }}
            >
              {allowedRoleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {feedback ? (
            <p style={{ ...styles.modalFeedback, ...feedbackStyle }}>
              {feedback.message}
            </p>
          ) : (
            <p style={styles.modalNote}>
              The role change is applied by the authorised Users backend. The table
              remains driven by the live Users stream.
            </p>
          )}
        </div>

        <footer style={styles.modalFooter}>
          <button
            type="button"
            style={{
              ...styles.secondaryButton,
              opacity: isSaving ? 0.55 : 1,
              cursor: isSaving ? "not-allowed" : "pointer",
            }}
            disabled={isSaving}
            onClick={onClose}
          >
            {feedback?.type === "success" ? "Done" : "Cancel"}
          </button>
          <button
            type="button"
            style={{
              ...styles.primaryButton,
              opacity: updateDisabled ? 0.5 : 1,
              cursor: updateDisabled ? "not-allowed" : "pointer",
            }}
            disabled={updateDisabled}
            onClick={handleUpdateRole}
          >
            {isSaving
              ? "Updating Role..."
              : feedback?.type === "success"
                ? "Role Updated"
                : "Update Role"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function EditStatusModal({ user, onClose }) {
  const currentStatus = normalizeUpper(user?.accountStatus);
  const [newStatus, setNewStatus] = useState(
    isStatusDisabled(currentStatus) ? "DISABLED" : "ENABLED",
  );

  return (
    <div style={styles.overlay} role="presentation" onMouseDown={onClose}>
      <section
        style={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-user-status-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header style={styles.modalHeader}>
          <h2 id="edit-user-status-title" style={styles.modalTitle}>
            Edit User Status
          </h2>
        </header>

        <div style={styles.modalBody}>
          <div style={styles.field}>
            <span style={styles.label}>User</span>
            <span style={styles.value}>{user?.displayName || "NAv"}</span>
          </div>

          <div style={styles.field}>
            <span style={styles.label}>Current Status</span>
            <span style={styles.value}>{statusLabel(currentStatus)}</span>
          </div>

          <label style={styles.field}>
            <span style={styles.label}>New Status</span>
            <select
              style={styles.control}
              value={newStatus}
              onChange={(event) => setNewStatus(event.target.value)}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <p style={styles.modalNote}>
            Status editing UI is ready. Enable/disable will be connected through the
            authorised Users API and backend callable in the next controlled step.
          </p>
        </div>

        <footer style={styles.modalFooter}>
          <button type="button" style={styles.secondaryButton} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            style={{
              ...styles.primaryButton,
              opacity: 0.65,
              cursor: "not-allowed",
            }}
            disabled
            title="Status write API is not connected yet."
          >
            Update Status
          </button>
        </footer>
      </section>
    </div>
  );
}


const tableStyles = {
  teamList: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.3rem",
  },
};

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-ZA");
}

function compareNatural(a, b) {
  return String(a || "").localeCompare(String(b || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort(compareNatural);
}

export default function UsersPage() {
  const {
    uid: actorUid,
    role: actorRole,
    serviceProvider: actorServiceProvider,
  } = useAuth();
  const [filters, setFilters] = useState({});
  const [serviceProviders, setServiceProviders] = useState(null);
  const [serviceProvidersFailed, setServiceProvidersFailed] = useState(false);
  const [roleUser, setRoleUser] = useState(null);
  const [statusUser, setStatusUser] = useState(null);
  const [roleFeedbackByUser, setRoleFeedbackByUser] = useState({});

  const [updateUserRole] = useUpdateUserRoleMutation();

  const {
    data: users = [],
    isLoading,
    isFetching,
    isError: usersFailed,
  } = useGetUsersDirectoryQuery({ limit: 1000 });

  // Current team membership: every active team a user is a member of.
  const {
    data: teams = [],
    isLoading: teamsLoading,
    isError: teamsFailed,
  } = useGetAvailableTeamsQuery({ limit: 500 });

  // The registered service providers: needed for the lineage and for the
  // Service Providers KPI. Smars, the platform owner, is not one of them.
  useEffect(() => {
    let cancelled = false;

    getDocsFromServer(collection(db, "serviceProviders"))
      .then((snapshot) => {
        if (cancelled) return;
        setServiceProviders(
          snapshot.docs.map((docSnapshot) => ({
            id: docSnapshot.id,
            clients: docSnapshot.data()?.clients || [],
          })),
        );
      })
      .catch((error) => {
        console.error("UsersPage: service providers could not be read", error);
        if (!cancelled) setServiceProvidersFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const isPlatformViewer = PLATFORM_ROLES.includes(normalizeUpper(actorRole));
  const actorServiceProviderId = normalize(actorServiceProvider?.id);
  const lineageReady = isPlatformViewer || serviceProviders !== null;
  const lineageFailed = !isPlatformViewer && serviceProvidersFailed;

  const lineageServiceProviderIds = useMemo(() => {
    if (isPlatformViewer || serviceProviders === null) return null;
    return getLineageServiceProviderIds(actorServiceProviderId, serviceProviders);
  }, [actorServiceProviderId, isPlatformViewer, serviceProviders]);

  // Everything below — KPIs, filters, the table — works on this population only.
  const lineageUsers = useMemo(() => {
    if (isPlatformViewer) return users;
    if (!lineageServiceProviderIds) return [];
    return users.filter((user) =>
      lineageServiceProviderIds.has(normalize(user.serviceProviderId)),
    );
  }, [isPlatformViewer, lineageServiceProviderIds, users]);

  const serviceProviderCount = serviceProvidersFailed
    ? "NAv"
    : serviceProviders === null
      ? null
      : isPlatformViewer
        ? serviceProviders.length
        : serviceProviders.filter((serviceProvider) =>
            lineageServiceProviderIds?.has(serviceProvider.id),
          ).length;

  const teamNamesByUid = useMemo(() => {
    const byUid = new Map();

    for (const team of teams) {
      for (const memberUid of team.memberUserIds || []) {
        const names = byUid.get(memberUid) || [];
        names.push(team.name);
        byUid.set(memberUid, names);
      }
    }

    for (const names of byUid.values()) names.sort(compareNatural);

    return byUid;
  }, [teams]);

  const userRows = useMemo(
    () =>
      lineageUsers.map((user) => ({
        ...user,
        teams: teamNamesByUid.get(normalize(user.uid || user.id)) || [],
      })),
    [lineageUsers, teamNamesByUid],
  );

  const selectedRoleUser = roleUser
    ? users.find((user) => (user.uid || user.id) === (roleUser.uid || roleUser.id)) ||
      roleUser
    : null;

  const columnOptions = useMemo(
    () => ({
      role: uniqueSorted(userRows.map((user) => normalizeUpper(user.role))).map(
        (value) => ({ value, label: value }),
      ),
      serviceProviderName: uniqueSorted(
        userRows.map((user) => normalize(user.serviceProviderName)),
      ).map((value) => ({ value, label: value })),
      teams: [
        ...uniqueSorted(
          teams
            .filter(
              (team) =>
                isPlatformViewer ||
                lineageServiceProviderIds?.has(
                  normalize(team.mncServiceProviderId),
                ) ||
                (team.serviceProviderIds || []).some((id) =>
                  lineageServiceProviderIds?.has(normalize(id)),
                ) ||
                userRows.some((user) => user.teams.includes(team.name)),
            )
            .map((team) => team.name),
        ).map((value) => ({ value, label: value })),
        ...(teamsLoading || teamsFailed ? [] : [{ value: NO_TEAM, label: NO_TEAM }]),
      ],
      accountStatus: uniqueSorted(
        userRows.map((user) => normalizeUpper(user.accountStatus)),
      ).map((value) => ({ value, label: statusLabel(value) })),
      onboardingStatus: uniqueSorted(
        userRows.map((user) => normalizeUpper(user.onboardingStatus)),
      ).map((value) => ({ value, label: value })),
    }),
    [
      isPlatformViewer,
      lineageServiceProviderIds,
      teams,
      teamsFailed,
      teamsLoading,
      userRows,
    ],
  );

  // KPIs describe every user, not only the rows a filter leaves on screen.
  const kpis = useMemo(
    () => ({
      users: userRows.length,
      enabled: userRows.filter(
        (user) => statusLabel(user.accountStatus) === "Enabled",
      ).length,
      disabled: userRows.filter((user) => isStatusDisabled(user.accountStatus))
        .length,
      onboardingCompleted: userRows.filter(
        (user) => normalizeUpper(user.onboardingStatus) === "COMPLETED",
      ).length,
    }),
    [userRows],
  );

  async function handleUpdateRole(user, newRole) {
    const userUid = normalize(user?.uid || user?.id);
    const normalizedNewRole = normalizeUpper(newRole);

    setRoleFeedbackByUser((current) => ({
      ...current,
      [userUid]: {
        type: "pending",
        expectedRole: normalizedNewRole,
        message: "Updating role...",
      },
    }));

    try {
      const result = await updateUserRole({
        userUid,
        newRole: normalizedNewRole,
      }).unwrap();

      setRoleFeedbackByUser((current) => ({
        ...current,
        [userUid]: {
          type: "success",
          expectedRole: normalizedNewRole,
          message: result?.message || "Role updated successfully.",
        },
      }));

      return result;
    } catch (error) {
      const message = getMutationErrorMessage(error);

      setRoleFeedbackByUser((current) => ({
        ...current,
        [userUid]: {
          type: "error",
          expectedRole: normalizedNewRole,
          message,
        },
      }));

      throw new Error(message);
    }
  }

  const kpisPending = isLoading || !lineageReady;
  const kpisUnknown = usersFailed || lineageFailed;

  function kpiValue(value) {
    if (kpisUnknown) return "NAv";
    if (kpisPending) return "…";
    return formatNumber(value);
  }

  function renderRole(user) {
    const userUid = normalize(user.uid || user.id);
    const roleEditable = canManageTargetRole({
      actorUid,
      actorRole,
      targetUid: userUid,
      targetRole: user.role,
    });
    const disabledReason = getRoleEditDisabledReason({
      actorUid,
      actorRole,
      targetUid: userUid,
      targetRole: user.role,
    });
    const roleFeedback = roleFeedbackByUser[userUid] || null;
    const roleHasStreamed = roleFeedback?.type === "success" &&
      normalizeUpper(user.role) === roleFeedback.expectedRole;
    const roleFeedbackMessage = roleFeedback?.type === "pending"
      ? "Updating role..."
      : roleFeedback?.type === "error" ? roleFeedback.message
        : roleFeedback?.type === "success" && roleHasStreamed ? "Role updated successfully."
          : roleFeedback?.type === "success" ? "Role saved. Syncing live row..." : "";
    const roleFeedbackColor = roleFeedback?.type === "error" ? "#b91c1c"
      : roleFeedback?.type === "success" && roleHasStreamed ? "#166534" : "#1d4ed8";

    return (
      <div style={styles.roleCell}>
        <button
          type="button"
          style={{
            ...styles.editableBadge,
            opacity: roleEditable ? 1 : 0.58,
            cursor: roleEditable ? "pointer" : "not-allowed",
          }}
          disabled={!roleEditable}
          onClick={() => setRoleUser(user)}
          title={roleEditable ? `Edit ${user.displayName || "user"} role` : disabledReason}
        >
          {normalizeUpper(user.role) || "NAv"}{roleEditable ? " ▾" : ""}
        </button>
        {roleFeedbackMessage ? (
          <span style={{ ...styles.roleFeedback, color: roleFeedbackColor }}>
            {roleFeedbackMessage}
          </span>
        ) : null}
      </div>
    );
  }
  const columns = usersTableColumns({
    options: columnOptions,
    teamsUnavailable: teamsLoading || teamsFailed,
  }).map(column => ({
    ...column,
    render: user => {
      if (column.key === "role") return renderRole(user);
      if (column.key === "teams") {
        if (teamsLoading) return <span style={styles.muted}>…</span>;
        if (teamsFailed) return <span style={styles.muted}>NAv</span>;
        return user.teams.length ? (
          <div style={tableStyles.teamList}>
            {user.teams.map(teamName => <span key={teamName} style={styles.staticBadge}>{teamName}</span>)}
          </div>
        ) : <span style={styles.muted}>{NO_TEAM}</span>;
      }
      if (column.key === "accountStatus") return <button type="button" style={styles.editableBadge} onClick={() => setStatusUser(user)} title={`Edit ${user.displayName || "user"} status`}>
          {statusLabel(user.accountStatus)} ▾
        </button>;
      if (column.key === "onboardingStatus") return <span style={styles.staticBadge}>{normalizeUpper(user.onboardingStatus) || "NAv"}</span>;
      if (column.key === "surname" || column.key === "name") return <span style={styles.userName}>{user[column.key] || "NAv"}</span>;
      return <span style={column.key === "email" ? styles.muted : undefined}>{user[column.key] || "NAv"}</span>;
    },
  }));
  const filteredUsers = filterIrepsTableRows(userRows, columns, { filters, searchValue: usersTableSearchValue });
  const emptyText = usersFailed ? "Unable to load users."
    : lineageFailed ? "The service providers could not be loaded, so your users cannot be shown. Refresh the page to try again."
    : !isPlatformViewer && !actorServiceProviderId ? "Your profile has no service provider, so no users can be shown."
    : userRows.length ? "No users match the current search or filters." : "No users found.";

  return (
    <section style={styles.page}>
      <div style={styles.intro}>
        <div>
          <h2 style={styles.title}>Users</h2>
          <p style={styles.subtitle}>
            Manage iREPS users and user roles. User data updates through the live
            Users API stream.
          </p>
        </div>

        <span style={styles.count}>
          {filteredUsers.length} of {lineageUsers.length} Users
          {isFetching && users.length > 0 ? " · Live update…" : ""}
        </span>
      </div>

      <section className="dashboard-grid">
        <div className="stat-card">
          <span>Users</span>
          <strong>{kpiValue(kpis.users)}</strong>
        </div>
        <div className="stat-card">
          <span>Service Providers</span>
          <strong>
            {serviceProviderCount === null
              ? "…"
              : serviceProviderCount === "NAv"
                ? "NAv"
                : formatNumber(serviceProviderCount)}
          </strong>
        </div>
        <div className="stat-card">
          <span>Enabled</span>
          <strong>{kpiValue(kpis.enabled)}</strong>
        </div>
        <div className="stat-card">
          <span>Disabled</span>
          <strong>{kpiValue(kpis.disabled)}</strong>
        </div>
        <div className="stat-card">
          <span>Onboarding Completed</span>
          <strong>{kpiValue(kpis.onboardingCompleted)}</strong>
        </div>
      </section>

      <IrepsTable
        key={`${actorUid}:${actorRole}:${actorServiceProviderId}`}
        title="Users"
        columns={columns}
        rows={userRows}
        rowKey={user => user.uid || user.id}
        defaultSort={USERS_DEFAULT_SORT}
        filters={filters}
        onFiltersChange={setFilters}
        searchValue={usersTableSearchValue}
        searchLabel="Search users"
        searchPlaceholder="Search name or email…"
        loading={!usersFailed && !lineageFailed && (isLoading || !lineageReady)}
        loadingText="Loading Users…"
        emptyText={emptyText}
        downloads={{
          registryName: "Users",
          fileBaseName: "users",
          scope: { label: isPlatformViewer ? "All users" : "Your service provider and subcontractors" },
        }}
      />
      {usersFailed && userRows.length > 0 ? <div style={styles.empty}>
        Unable to refresh users. Showing previously loaded users.
      </div> : null}
      {isPlatformViewer && serviceProvidersFailed ? <div style={styles.empty}>
        The service providers could not be loaded, so the Service Providers count is not shown. Refresh the page to try again.
      </div> : null}

      {selectedRoleUser ? (
        <EditRoleModal
          user={selectedRoleUser}
          actorRole={actorRole}
          onClose={() => setRoleUser(null)}
          onUpdateRole={handleUpdateRole}
        />
      ) : null}

      {statusUser ? (
        <EditStatusModal user={statusUser} onClose={() => setStatusUser(null)} />
      ) : null}
    </section>
  );
}
