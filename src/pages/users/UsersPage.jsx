import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";

import { useAuth } from "../../auth/useAuth";
import { db } from "../../firebase";
import { useGetAvailableTeamsQuery } from "../../redux/teamsApi";
import {
  useGetUsersDirectoryQuery,
  useUpdateUserRoleMutation,
} from "../../redux/usersApi";

// UI-R002: the Users page is a standard iREPS table (ireps-skills/ireps-standard-table.md,
// ireps-rules/ui-rules/registry-tables.md), with the Wards registry as its model.
const PAGE_SIZE_OPTIONS = [5, 10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 5;
const NO_TEAM = "None";

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

const EMPTY_COLUMN_FILTERS = Object.freeze({
  surname: "",
  name: "",
  email: "",
  role: "",
  serviceProviderName: "",
  teams: "",
  accountStatus: "",
  onboardingStatus: "",
});

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


const tableStyles = {
  sortButton: {
    width: "100%",
    border: 0,
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.4rem",
    padding: 0,
    fontWeight: 900,
    textAlign: "left",
  },
  headerInput: {
    width: "100%",
    minWidth: "7.5rem",
    marginTop: "0.4rem",
    border: "1px solid #cbd5e1",
    borderRadius: "0.45rem",
    padding: "0.36rem 0.45rem",
    fontSize: "0.72rem",
    background: "#ffffff",
  },
  paginationBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "1rem",
    padding: "0.75rem 0.9rem",
    flexWrap: "wrap",
  },
  paginationLeft: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    flexWrap: "wrap",
  },
  paginationControls: {
    display: "flex",
    alignItems: "center",
    gap: "0.45rem",
    flexWrap: "wrap",
  },
  pageSizeLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4rem",
    color: "#64748b",
    fontSize: "0.82rem",
    fontWeight: 700,
  },
  pageSizeSelect: {
    border: "1px solid rgba(148, 163, 184, 0.45)",
    borderRadius: "0.55rem",
    padding: "0.34rem 0.45rem",
    fontSize: "0.82rem",
  },
  paginationButton: {
    border: "1px solid rgba(148, 163, 184, 0.42)",
    background: "#fff",
    color: "#0f172a",
    borderRadius: "0.6rem",
    padding: "0.36rem 0.58rem",
    fontWeight: 800,
    cursor: "pointer",
  },
  clearButton: {
    border: "1px solid #fecaca",
    background: "#fef2f2",
    color: "#b91c1c",
    borderRadius: "0.6rem",
    padding: "0.36rem 0.62rem",
    fontWeight: 800,
    cursor: "pointer",
  },
  pageCountLabel: {
    color: "#334155",
    fontSize: "0.82rem",
    fontWeight: 800,
    padding: "0 0.2rem",
  },
  teamList: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.3rem",
  },
};

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-ZA");
}

function includesText(value, filterValue) {
  const filterText = normalize(filterValue).toLowerCase();
  if (!filterText) return true;
  return normalize(value).toLowerCase().includes(filterText);
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

function SortButton({ label, sortKey, sortConfig, onSort }) {
  const isActive = sortConfig.key === sortKey;
  const direction = isActive
    ? sortConfig.direction === "asc"
      ? "↑"
      : "↓"
    : "↕";

  return (
    <button
      type="button"
      style={tableStyles.sortButton}
      onClick={() => onSort(sortKey)}
    >
      <span>{label}</span>
      <span>{direction}</span>
    </button>
  );
}

function FilterInput({ value, onChange, placeholder }) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      style={tableStyles.headerInput}
    />
  );
}

function FilterSelect({ value, onChange, allLabel, options }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      style={tableStyles.headerInput}
    >
      <option value="">{allLabel}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function PaginationControls({
  currentPage,
  pageSize,
  totalPages,
  totalRows,
  onPageChange,
  onPageSizeChange,
  hasActiveFilters,
  onClearFilters,
}) {
  if (totalRows === 0) return null;

  const startRow = (currentPage - 1) * pageSize + 1;
  const endRow = Math.min(currentPage * pageSize, totalRows);

  return (
    <div style={tableStyles.paginationBar}>
      <div style={tableStyles.paginationLeft}>
        <span className="muted">
          Showing {formatNumber(startRow)}-{formatNumber(endRow)} of{" "}
          {formatNumber(totalRows)} rows
        </span>

        {hasActiveFilters ? (
          <button
            type="button"
            style={tableStyles.clearButton}
            onClick={onClearFilters}
          >
            Clear All Filters
          </button>
        ) : null}
      </div>

      <div style={tableStyles.paginationControls}>
        <label style={tableStyles.pageSizeLabel}>
          Rows per page
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            style={tableStyles.pageSizeSelect}
          >
            {PAGE_SIZE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          style={tableStyles.paginationButton}
          onClick={() => onPageChange(1)}
          disabled={currentPage <= 1}
        >
          First
        </button>
        <button
          type="button"
          style={tableStyles.paginationButton}
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
        >
          Previous
        </button>
        <span style={tableStyles.pageCountLabel}>
          Page {formatNumber(currentPage)} of {formatNumber(totalPages)}
        </span>
        <button
          type="button"
          style={tableStyles.paginationButton}
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
        >
          Next
        </button>
        <button
          type="button"
          style={tableStyles.paginationButton}
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage >= totalPages}
        >
          Last
        </button>
      </div>
    </div>
  );
}

function getSortValue(user, key) {
  if (key === "teams") return (user.teams || []).join(", ") || NO_TEAM;
  if (key === "accountStatus") return statusLabel(user.accountStatus);
  return normalize(user[key]);
}

export default function UsersPage() {
  const {
    uid: actorUid,
    role: actorRole,
    serviceProvider: actorServiceProvider,
  } = useAuth();
  const [searchText, setSearchText] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [columnFilters, setColumnFilters] = useState(EMPTY_COLUMN_FILTERS);
  const [sortConfig, setSortConfig] = useState({
    key: "surname",
    direction: "asc",
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [serviceProviders, setServiceProviders] = useState(null);
  const [roleUser, setRoleUser] = useState(null);
  const [statusUser, setStatusUser] = useState(null);
  const [roleFeedbackByUser, setRoleFeedbackByUser] = useState({});

  const [updateUserRole] = useUpdateUserRoleMutation();

  const {
    data: users = [],
    isLoading,
    isFetching,
  } = useGetUsersDirectoryQuery({ limit: 1000 });

  // Current team membership: every active team a user is a member of.
  const { data: teams = [] } = useGetAvailableTeamsQuery({ limit: 500 });

  // The registered service providers: needed for the lineage and for the
  // Service Providers KPI. Smars, the platform owner, is not one of them.
  useEffect(() => {
    let cancelled = false;

    getDocs(collection(db, "serviceProviders"))
      .then((snapshot) => {
        if (cancelled) return;
        setServiceProviders(
          snapshot.docs.map((docSnapshot) => ({
            id: docSnapshot.id,
            clients: docSnapshot.data()?.clients || [],
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setServiceProviders([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const isPlatformViewer = PLATFORM_ROLES.includes(normalizeUpper(actorRole));
  const actorServiceProviderId = normalize(actorServiceProvider?.id);
  const lineageReady = isPlatformViewer || serviceProviders !== null;

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

  const serviceProviderCount =
    serviceProviders === null
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

  const statusOptions = useMemo(() => {
    return [
      ...new Set(
        lineageUsers
          .map((user) => normalizeUpper(user.accountStatus))
          .filter(Boolean),
      ),
    ].sort();
  }, [lineageUsers]);

  const columnOptions = useMemo(
    () => ({
      role: uniqueSorted(userRows.map((user) => normalizeUpper(user.role))).map(
        (value) => ({ value, label: value }),
      ),
      serviceProviderName: uniqueSorted(
        userRows.map((user) => normalize(user.serviceProviderName)),
      ).map((value) => ({ value, label: value })),
      teams: [
        ...uniqueSorted(userRows.flatMap((user) => user.teams)).map((value) => ({
          value,
          label: value,
        })),
        { value: NO_TEAM, label: NO_TEAM },
      ],
      accountStatus: uniqueSorted(
        userRows.map((user) => normalizeUpper(user.accountStatus)),
      ).map((value) => ({ value, label: statusLabel(value) })),
      onboardingStatus: uniqueSorted(
        userRows.map((user) => normalizeUpper(user.onboardingStatus)),
      ).map((value) => ({ value, label: value })),
    }),
    [userRows],
  );

  // KPIs describe every user, not only the rows a filter leaves on screen.
  const kpis = useMemo(
    () => ({
      users: userRows.length,
      enabled: userRows.filter((user) => !isStatusDisabled(user.accountStatus))
        .length,
      disabled: userRows.filter((user) => isStatusDisabled(user.accountStatus))
        .length,
      onboardingCompleted: userRows.filter(
        (user) => normalizeUpper(user.onboardingStatus) === "COMPLETED",
      ).length,
    }),
    [userRows],
  );

  // Standard order: whole population → filter → sort → page.
  const filteredUsers = useMemo(() => {
    const search = normalize(searchText).toLowerCase();

    return userRows.filter((user) => {
      const matchesSearch =
        !search ||
        normalize(user.displayName).toLowerCase().includes(search) ||
        normalize(user.email).toLowerCase().includes(search);

      const matchesRole =
        !roleFilter || normalizeUpper(user.role) === roleFilter;

      const matchesStatus =
        !statusFilter || normalizeUpper(user.accountStatus) === statusFilter;

      const matchesTeam =
        !columnFilters.teams ||
        (columnFilters.teams === NO_TEAM
          ? user.teams.length === 0
          : user.teams.includes(columnFilters.teams));

      return (
        matchesSearch &&
        matchesRole &&
        matchesStatus &&
        includesText(user.surname, columnFilters.surname) &&
        includesText(user.name, columnFilters.name) &&
        includesText(user.email, columnFilters.email) &&
        (!columnFilters.role ||
          normalizeUpper(user.role) === columnFilters.role) &&
        (!columnFilters.serviceProviderName ||
          normalize(user.serviceProviderName) ===
            columnFilters.serviceProviderName) &&
        matchesTeam &&
        (!columnFilters.accountStatus ||
          normalizeUpper(user.accountStatus) === columnFilters.accountStatus) &&
        (!columnFilters.onboardingStatus ||
          normalizeUpper(user.onboardingStatus) ===
            columnFilters.onboardingStatus)
      );
    });
  }, [columnFilters, roleFilter, searchText, statusFilter, userRows]);

  const sortedUsers = useMemo(() => {
    const direction = sortConfig.direction === "asc" ? 1 : -1;

    return [...filteredUsers].sort(
      (a, b) =>
        direction *
        compareNatural(
          getSortValue(a, sortConfig.key),
          getSortValue(b, sortConfig.key),
        ),
    );
  }, [filteredUsers, sortConfig]);

  const totalRows = sortedUsers.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pagedUsers = sortedUsers.slice(
    (safeCurrentPage - 1) * pageSize,
    safeCurrentPage * pageSize,
  );

  const hasActiveFilters = Object.values(columnFilters).some(Boolean);

  function updateColumnFilter(key, value) {
    setCurrentPage(1);
    setColumnFilters((current) => ({ ...current, [key]: value }));
  }

  function clearColumnFilters() {
    setCurrentPage(1);
    setColumnFilters(EMPTY_COLUMN_FILTERS);
  }

  function handleSort(key) {
    setSortConfig((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" },
    );
  }

  function handlePageSizeChange(nextSize) {
    setCurrentPage(1);
    setPageSize(nextSize);
  }

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

  const pagination = (
    <PaginationControls
      currentPage={safeCurrentPage}
      pageSize={pageSize}
      totalPages={totalPages}
      totalRows={totalRows}
      onPageChange={setCurrentPage}
      onPageSizeChange={handlePageSizeChange}
      hasActiveFilters={hasActiveFilters}
      onClearFilters={clearColumnFilters}
    />
  );

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
          <strong>{formatNumber(kpis.users)}</strong>
        </div>
        <div className="stat-card">
          <span>Service Providers</span>
          <strong>
            {serviceProviderCount === null
              ? "…"
              : formatNumber(serviceProviderCount)}
          </strong>
        </div>
        <div className="stat-card">
          <span>Enabled</span>
          <strong>{formatNumber(kpis.enabled)}</strong>
        </div>
        <div className="stat-card">
          <span>Disabled</span>
          <strong>{formatNumber(kpis.disabled)}</strong>
        </div>
        <div className="stat-card">
          <span>Onboarding Completed</span>
          <strong>{formatNumber(kpis.onboardingCompleted)}</strong>
        </div>
      </section>

      <div style={styles.filters}>
        <input
          type="search"
          aria-label="Search users"
          placeholder="Search name or email..."
          value={searchText}
          onChange={(event) => {
            setCurrentPage(1);
            setSearchText(event.target.value);
          }}
          style={styles.control}
        />

        <select
          aria-label="Filter users by role"
          value={roleFilter}
          onChange={(event) => {
            setCurrentPage(1);
            setRoleFilter(event.target.value);
          }}
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
          onChange={(event) => {
            setCurrentPage(1);
            setStatusFilter(event.target.value);
          }}
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

      <section className="table-panel">
        {pagination}

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>
                  <SortButton
                    label="Surname"
                    sortKey="surname"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <FilterInput
                    value={columnFilters.surname}
                    onChange={(value) => updateColumnFilter("surname", value)}
                    placeholder="Surname"
                  />
                </th>
                <th>
                  <SortButton
                    label="Name"
                    sortKey="name"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <FilterInput
                    value={columnFilters.name}
                    onChange={(value) => updateColumnFilter("name", value)}
                    placeholder="Name"
                  />
                </th>
                <th>
                  <SortButton
                    label="Email"
                    sortKey="email"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <FilterInput
                    value={columnFilters.email}
                    onChange={(value) => updateColumnFilter("email", value)}
                    placeholder="Email"
                  />
                </th>
                <th>
                  <SortButton
                    label="Role"
                    sortKey="role"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <FilterSelect
                    value={columnFilters.role}
                    onChange={(value) => updateColumnFilter("role", value)}
                    allLabel="All roles"
                    options={columnOptions.role}
                  />
                </th>
                <th>
                  <SortButton
                    label="Service Provider"
                    sortKey="serviceProviderName"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <FilterSelect
                    value={columnFilters.serviceProviderName}
                    onChange={(value) =>
                      updateColumnFilter("serviceProviderName", value)
                    }
                    allLabel="All service providers"
                    options={columnOptions.serviceProviderName}
                  />
                </th>
                <th>
                  <SortButton
                    label="Team"
                    sortKey="teams"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <FilterSelect
                    value={columnFilters.teams}
                    onChange={(value) => updateColumnFilter("teams", value)}
                    allLabel="All teams"
                    options={columnOptions.teams}
                  />
                </th>
                <th>
                  <SortButton
                    label="Account Status"
                    sortKey="accountStatus"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <FilterSelect
                    value={columnFilters.accountStatus}
                    onChange={(value) =>
                      updateColumnFilter("accountStatus", value)
                    }
                    allLabel="All statuses"
                    options={columnOptions.accountStatus}
                  />
                </th>
                <th>
                  <SortButton
                    label="Onboarding Status"
                    sortKey="onboardingStatus"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <FilterSelect
                    value={columnFilters.onboardingStatus}
                    onChange={(value) =>
                      updateColumnFilter("onboardingStatus", value)
                    }
                    allLabel="All statuses"
                    options={columnOptions.onboardingStatus}
                  />
                </th>
              </tr>
            </thead>

            <tbody>
              {pagedUsers.map((user) => {
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
                    <td>
                      <span style={styles.userName}>
                        {user.surname || "NAv"}
                      </span>
                    </td>

                    <td>
                      <span style={styles.userName}>{user.name || "NAv"}</span>
                    </td>

                    <td style={styles.muted}>{user.email || "NAv"}</td>

                    <td>
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

                    <td>{user.serviceProviderName || "NAv"}</td>

                    <td>
                      {user.teams.length ? (
                        <div style={tableStyles.teamList}>
                          {user.teams.map((teamName) => (
                            <span key={teamName} style={styles.staticBadge}>
                              {teamName}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span style={styles.muted}>{NO_TEAM}</span>
                      )}
                    </td>

                    <td>
                      <button
                        type="button"
                        style={styles.editableBadge}
                        onClick={() => setStatusUser(user)}
                        title={`Edit ${user.displayName || "user"} status`}
                      >
                        {statusLabel(user.accountStatus)} ▾
                      </button>
                    </td>

                    <td>
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

        {isLoading || !lineageReady ? (
          <div style={styles.empty}>Loading Users...</div>
        ) : null}

        {!isLoading &&
        lineageReady &&
        !isPlatformViewer &&
        !actorServiceProviderId ? (
          <div style={styles.empty}>
            Your profile has no service provider, so no users can be shown.
          </div>
        ) : null}

        {!isLoading &&
        lineageReady &&
        (isPlatformViewer || actorServiceProviderId) &&
        lineageUsers.length === 0 ? (
          <div style={styles.empty}>No users found.</div>
        ) : null}

        {!isLoading && lineageUsers.length > 0 && filteredUsers.length === 0 ? (
          <div style={styles.empty}>
            No users match the current search or filters.
          </div>
        ) : null}

        {pagination}
      </section>

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
