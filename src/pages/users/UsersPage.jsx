import { useMemo, useState } from "react";

import { useAuth } from "../../auth/useAuth";
import {
  useGetUsersDirectoryQuery,
  useUpdateUserRoleMutation,
} from "../../redux/usersApi";

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
  filters: {
    display: "grid",
    gridTemplateColumns: "minmax(240px, 1fr) 190px 190px",
    gap: "0.75rem",
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
  card: {
    overflow: "hidden",
    border: "1px solid #e2e8f0",
    borderRadius: "1rem",
    background: "#ffffff",
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
  },
  tableWrap: {
    width: "100%",
    overflowX: "auto",
  },
  table: {
    width: "100%",
    minWidth: "980px",
    borderCollapse: "collapse",
  },
  th: {
    padding: "0.8rem 0.9rem",
    borderBottom: "1px solid #e2e8f0",
    background: "#f8fafc",
    color: "#475569",
    fontSize: "0.76rem",
    fontWeight: 900,
    letterSpacing: "0.04em",
    textAlign: "left",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  },
  td: {
    padding: "0.85rem 0.9rem",
    borderBottom: "1px solid #f1f5f9",
    color: "#334155",
    fontSize: "0.88rem",
    verticalAlign: "middle",
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

function statusLabel(status) {
  const value = normalizeUpper(status);
  if (value === "ACTIVE" || value === "ENABLED") return "Enabled";
  if (value === "DISABLED" || value === "INACTIVE") return "Disabled";
  return value || "NAv";
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

export default function UsersPage() {
  const { uid: actorUid, role: actorRole } = useAuth();
  const [searchText, setSearchText] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [roleUser, setRoleUser] = useState(null);
  const [statusUser, setStatusUser] = useState(null);
  const [roleFeedbackByUser, setRoleFeedbackByUser] = useState({});

  const [updateUserRole] = useUpdateUserRoleMutation();

  const {
    data: users = [],
    isLoading,
    isFetching,
  } = useGetUsersDirectoryQuery({ limit: 1000 });

  const selectedRoleUser = roleUser
    ? users.find((user) => (user.uid || user.id) === (roleUser.uid || roleUser.id)) ||
      roleUser
    : null;

  const statusOptions = useMemo(() => {
    return [
      ...new Set(
        users
          .map((user) => normalizeUpper(user.accountStatus))
          .filter(Boolean),
      ),
    ].sort();
  }, [users]);

  const filteredUsers = useMemo(() => {
    const search = normalize(searchText).toLowerCase();

    return users.filter((user) => {
      const matchesSearch =
        !search ||
        normalize(user.displayName).toLowerCase().includes(search) ||
        normalize(user.email).toLowerCase().includes(search);

      const matchesRole =
        !roleFilter || normalizeUpper(user.role) === roleFilter;

      const matchesStatus =
        !statusFilter || normalizeUpper(user.accountStatus) === statusFilter;

      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [roleFilter, searchText, statusFilter, users]);

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
          {filteredUsers.length} of {users.length} Users
          {isFetching && users.length > 0 ? " · Live update…" : ""}
        </span>
      </div>

      <div style={styles.filters}>
        <input
          type="search"
          aria-label="Search users"
          placeholder="Search name or email..."
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          style={styles.control}
        />

        <select
          aria-label="Filter users by role"
          value={roleFilter}
          onChange={(event) => setRoleFilter(event.target.value)}
          style={styles.control}
        >
          <option value="">All Roles</option>
          {ROLE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter users by account status"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          style={styles.control}
        >
          <option value="">All Statuses</option>
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {statusLabel(status)}
            </option>
          ))}
        </select>
      </div>

      <div style={styles.card}>
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>User</th>
                <th style={styles.th}>Email</th>
                <th style={styles.th}>Role</th>
                <th style={styles.th}>Service Provider</th>
                <th style={styles.th}>Account Status</th>
                <th style={styles.th}>Onboarding Status</th>
              </tr>
            </thead>

            <tbody>
              {filteredUsers.map((user) => {
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
                const roleHasStreamed =
                  roleFeedback?.type === "success" &&
                  normalizeUpper(user.role) === roleFeedback.expectedRole;

                const roleFeedbackMessage =
                  roleFeedback?.type === "pending"
                    ? "Updating role..."
                    : roleFeedback?.type === "error"
                      ? roleFeedback.message
                      : roleFeedback?.type === "success" && roleHasStreamed
                        ? "Role updated successfully."
                        : roleFeedback?.type === "success"
                          ? "Role saved. Syncing live row..."
                          : "";

                const roleFeedbackColor =
                  roleFeedback?.type === "error"
                    ? "#b91c1c"
                    : roleFeedback?.type === "success" && roleHasStreamed
                      ? "#166534"
                      : "#1d4ed8";

                return (
                  <tr key={userUid}>
                    <td style={styles.td}>
                      <span style={styles.userName}>
                        {user.displayName || "NAv"}
                      </span>
                    </td>

                    <td style={{ ...styles.td, ...styles.muted }}>
                      {user.email || "NAv"}
                    </td>

                    <td style={styles.td}>
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
                          title={
                            roleEditable
                              ? `Edit ${user.displayName || "user"} role`
                              : disabledReason
                          }
                        >
                          {normalizeUpper(user.role) || "NAv"}
                          {roleEditable ? " ▾" : ""}
                        </button>

                        {roleFeedbackMessage ? (
                          <span
                            style={{
                              ...styles.roleFeedback,
                              color: roleFeedbackColor,
                            }}
                          >
                            {roleFeedbackMessage}
                          </span>
                        ) : null}
                      </div>
                    </td>

                    <td style={styles.td}>
                      {user.serviceProviderName || "NAv"}
                    </td>

                    <td style={styles.td}>
                      <button
                        type="button"
                        style={styles.editableBadge}
                        onClick={() => setStatusUser(user)}
                        title={`Edit ${user.displayName || "user"} status`}
                      >
                        {statusLabel(user.accountStatus)} ▾
                      </button>
                    </td>

                    <td style={styles.td}>
                      <span style={styles.staticBadge}>
                        {normalizeUpper(user.onboardingStatus) || "NAv"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {isLoading ? <div style={styles.empty}>Loading Users...</div> : null}

        {!isLoading && users.length === 0 ? (
          <div style={styles.empty}>No users found.</div>
        ) : null}

        {!isLoading && users.length > 0 && filteredUsers.length === 0 ? (
          <div style={styles.empty}>
            No users match the current search or filters.
          </div>
        ) : null}
      </div>

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
