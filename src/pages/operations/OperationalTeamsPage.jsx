import { useMemo, useState } from "react";

import { useAuth } from "../../auth/useAuth";
import { useGetAvailableServiceProvidersQuery } from "../../redux/serviceProvidersApi";
import {
  useAddTeamMemberMutation,
  useCreateTeamMutation,
  useDeleteTeamMutation,
  useGetAvailableTeamsQuery,
  useRemoveTeamMemberMutation,
  useRenameTeamMutation,
} from "../../redux/teamsApi";
import { useGetRegistryTrnsByLmPcodeQuery } from "../../redux/trnsApi";
import { useGetUsersDirectoryQuery } from "../../redux/usersApi";

const DRAG_MIME = "application/x-ireps-team-user";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeUpper(value) {
  return cleanText(value).toUpperCase();
}

function resolveAuthProfile(authContext = {}) {
  return (
    authContext?.profile ||
    authContext?.userProfile ||
    authContext?.currentUserProfile ||
    authContext?.user?.profile ||
    authContext?.user ||
    {}
  );
}

function resolveAuthRole(authContext = {}) {
  const profile = resolveAuthProfile(authContext);
  return normalizeUpper(
    authContext?.role ||
      authContext?.userRole ||
      authContext?.employmentRole ||
      profile?.employment?.role ||
      profile?.role,
  );
}

function resolveActorServiceProvider(authContext = {}) {
  const profile = resolveAuthProfile(authContext);

  return (
    authContext?.serviceProvider ||
    profile?.employment?.serviceProvider ||
    profile?.serviceProvider ||
    null
  );
}

function resolveActiveLmPcode(authContext = {}) {
  const profile = resolveAuthProfile(authContext);
  const activeWorkbase =
    authContext?.activeWorkbase ||
    authContext?.activeLm ||
    profile?.access?.activeWorkbase ||
    profile?.activeWorkbase ||
    null;

  const lmPcode = cleanText(
    authContext?.activeLmPcode || activeWorkbase?.pcode || activeWorkbase?.id,
  );

  return lmPcode && lmPcode !== "NAv" ? lmPcode : "";
}

function getUserDisplayName(user = {}) {
  return cleanText(user.displayName || user?.raw?.profile?.displayName) || "NAv";
}

function getUserRole(user = {}) {
  return normalizeUpper(user.role || user?.raw?.employment?.role) || "NAv";
}

function getUserServiceProviderId(user = {}) {
  const id = cleanText(
    user.serviceProviderId || user?.raw?.employment?.serviceProvider?.id,
  );
  return id === "NAv" ? "" : id;
}

function getUserServiceProviderName(user = {}) {
  const name = cleanText(
    user.serviceProviderName || user?.raw?.employment?.serviceProvider?.name,
  );
  return name && name !== "NAv" ? name : "Unknown SP";
}

function getTeamMembers(team, usersByUid) {
  return asArray(team?.memberUserIds)
    .map((uid) => usersByUid.get(uid))
    .filter(Boolean);
}

function getTeamUpdatedAt(team = {}) {
  return cleanText(team?.metadata?.updatedAt || team?.metadata?.createdAt);
}

function sortTeamsByUpdatedAt(left, right) {
  return getTeamUpdatedAt(right).localeCompare(getTeamUpdatedAt(left));
}

function buildHierarchyContext({ authContext, serviceProviders }) {
  const role = resolveAuthRole(authContext);
  const actorServiceProvider = resolveActorServiceProvider(authContext);
  const actorServiceProviderId = cleanText(actorServiceProvider?.id);

  const actorSubcontractor = serviceProviders.find(
    (serviceProvider) => serviceProvider?.id === actorServiceProviderId,
  );

  const mncServiceProviderId = cleanText(
    actorSubcontractor?.parentServiceProviderId || actorServiceProviderId,
  );

  const subcontractorIds = serviceProviders
    .filter(
      (serviceProvider) =>
        cleanText(serviceProvider?.parentServiceProviderId) ===
        mncServiceProviderId,
    )
    .map((serviceProvider) => serviceProvider.id)
    .filter(Boolean);

  return {
    role,
    actorServiceProviderId,
    mncServiceProviderId,
    allowedServiceProviderIds: [
      mncServiceProviderId,
      ...subcontractorIds,
    ].filter(Boolean),
    canSeeAll: role === "SPU" || role === "ADM",
  };
}

function getErrorMessage(error, fallback) {
  return error?.data?.message || error?.message || fallback;
}

export default function OperationalTeamsPage() {
  const authContext = useAuth();
  const activeLmPcode = resolveActiveLmPcode(authContext);

  const { data: trns = [], isLoading: trnsLoading } =
    useGetRegistryTrnsByLmPcodeQuery(activeLmPcode, {
      skip: !activeLmPcode,
    });
  const { data: users = [], isLoading: usersLoading } =
    useGetUsersDirectoryQuery({ limit: 1000 });
  const { data: teams = [], isLoading: teamsLoading } =
    useGetAvailableTeamsQuery({ limit: 500 });
  const { data: serviceProviders = [], isLoading: serviceProvidersLoading } =
    useGetAvailableServiceProvidersQuery({ limit: 500 });

  const [createTeam] = useCreateTeamMutation();
  const [renameTeam] = useRenameTeamMutation();
  const [addTeamMember] = useAddTeamMemberMutation();
  const [removeTeamMember] = useRemoveTeamMemberMutation();
  const [deleteTeam] = useDeleteTeamMutation();

  const [modalMode, setModalMode] = useState(null);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [teamName, setTeamName] = useState("");
  const [isSavingTeam, setIsSavingTeam] = useState(false);
  const [draggedUserUid, setDraggedUserUid] = useState(null);
  const [dragOverTeamId, setDragOverTeamId] = useState(null);
  const [pendingMembershipKey, setPendingMembershipKey] = useState(null);
  const [message, setMessage] = useState(null);

  const hierarchy = useMemo(
    () => buildHierarchyContext({ authContext, serviceProviders }),
    [authContext, serviceProviders],
  );

  const operationalUsers = useMemo(
    () =>
      users.filter((user) => {
        const role = getUserRole(user);
        const accountStatus = normalizeUpper(user.accountStatus);
        const onboardingStatus = normalizeUpper(user.onboardingStatus);

        return (
          ["FWR", "SPV"].includes(role) &&
          accountStatus === "ACTIVE" &&
          onboardingStatus === "COMPLETED"
        );
      }),
    [users],
  );

  const visibleOperationalUsers = useMemo(() => {
    if (hierarchy.canSeeAll) return operationalUsers;

    return operationalUsers.filter((user) =>
      hierarchy.allowedServiceProviderIds.includes(
        getUserServiceProviderId(user),
      ),
    );
  }, [hierarchy, operationalUsers]);

  const usersByUid = useMemo(() => {
    const map = new Map();
    users.forEach((user) => {
      const uid = cleanText(user.uid || user.id);
      if (uid) map.set(uid, user);
    });
    return map;
  }, [users]);

  const trnCountsByUserUid = useMemo(() => {
    const counts = new Map();

    trns.forEach((trn) => {
      const userUid = cleanText(trn?.updatedByUid);
      if (!userUid || userUid === "NAv") return;

      counts.set(userUid, (counts.get(userUid) || 0) + 1);
    });

    return counts;
  }, [trns]);

  const usersByServiceProvider = useMemo(() => {
    const map = new Map();

    visibleOperationalUsers.forEach((user) => {
      const serviceProviderId = getUserServiceProviderId(user) || "unknown";
      const serviceProviderName = getUserServiceProviderName(user);

      if (!map.has(serviceProviderId)) {
        map.set(serviceProviderId, {
          serviceProviderId,
          serviceProviderName,
          users: [],
        });
      }

      map.get(serviceProviderId).users.push(user);
    });

    return Array.from(map.values())
      .map((group) => ({
        ...group,
        users: [...group.users].sort((left, right) =>
          getUserDisplayName(left).localeCompare(getUserDisplayName(right)),
        ),
      }))
      .sort((left, right) =>
        left.serviceProviderName.localeCompare(right.serviceProviderName),
      );
  }, [visibleOperationalUsers]);

  const visibleTeams = useMemo(() => {
    const filtered = hierarchy.canSeeAll
      ? teams
      : teams.filter((team) => {
          const teamSpIds = asArray(team.serviceProviderIds);
          const matchesMemberScope = teamSpIds.some((spId) =>
            hierarchy.allowedServiceProviderIds.includes(spId),
          );
          const matchesOwnership =
            cleanText(team.mncServiceProviderId) ===
            hierarchy.mncServiceProviderId;

          return matchesMemberScope || matchesOwnership;
        });

    return [...filtered].sort(sortTeamsByUpdatedAt);
  }, [hierarchy, teams]);

  const isLoading =
    usersLoading || teamsLoading || serviceProvidersLoading;

  function showMessage(type, text) {
    setMessage({ type, text });
  }

  function openCreateModal() {
    setSelectedTeam(null);
    setTeamName("");
    setModalMode("create");
    setMessage(null);
  }

  function openRenameModal(team) {
    setSelectedTeam(team);
    setTeamName(cleanText(team?.name));
    setModalMode("rename");
    setMessage(null);
  }

  function closeModal() {
    if (isSavingTeam) return;
    setModalMode(null);
    setSelectedTeam(null);
    setTeamName("");
  }

  async function handleSaveTeam(event) {
    event.preventDefault();

    const name = cleanText(teamName);
    if (!name) {
      showMessage("error", "Team name is required.");
      return;
    }

    try {
      setIsSavingTeam(true);
      setMessage(null);

      if (modalMode === "rename" && selectedTeam?.id) {
        await renameTeam({ teamId: selectedTeam.id, name }).unwrap();
        showMessage("success", "Team renamed successfully.");
      } else {
        await createTeam({ name, description: "NAv" }).unwrap();
        showMessage("success", "Team created successfully.");
      }

      setModalMode(null);
      setSelectedTeam(null);
      setTeamName("");
    } catch (error) {
      showMessage(
        "error",
        getErrorMessage(
          error,
          modalMode === "rename"
            ? "Team rename failed."
            : "Team creation failed.",
        ),
      );
    } finally {
      setIsSavingTeam(false);
    }
  }

  async function handleDeleteTeam(team) {
    const members = getTeamMembers(team, usersByUid);

    if (members.length > 0) {
      showMessage(
        "error",
        "Team cannot be deleted if it has members. First remove all members.",
      );
      return;
    }

    const confirmed = window.confirm(
      `Delete ${team?.name || "this team"}?`,
    );
    if (!confirmed) return;

    try {
      setMessage(null);
      await deleteTeam({ teamId: team.id }).unwrap();
      showMessage("success", "Team deleted successfully.");
    } catch (error) {
      showMessage("error", getErrorMessage(error, "Team deletion failed."));
    }
  }

  function handleDragStart(event, user) {
    const userUid = cleanText(user?.uid || user?.id);
    if (!userUid) return;

    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(DRAG_MIME, userUid);
    event.dataTransfer.setData("text/plain", userUid);
    setDraggedUserUid(userUid);
    setMessage(null);
  }

  function handleDragEnd() {
    setDraggedUserUid(null);
    setDragOverTeamId(null);
  }

  function handleTeamDragOver(event, team) {
    const userUid = draggedUserUid;
    if (!userUid) return;

    const alreadyAssigned = asArray(team.memberUserIds).includes(userUid);
    event.preventDefault();
    event.dataTransfer.dropEffect = alreadyAssigned ? "none" : "copy";
    setDragOverTeamId(team.id);
  }

  async function handleTeamDrop(event, team) {
    event.preventDefault();

    const userUid = cleanText(
      event.dataTransfer.getData(DRAG_MIME) ||
        event.dataTransfer.getData("text/plain") ||
        draggedUserUid,
    );

    setDragOverTeamId(null);
    setDraggedUserUid(null);

    if (!userUid) return;

    if (asArray(team.memberUserIds).includes(userUid)) {
      showMessage("info", `User is already a member of ${team.name}.`);
      return;
    }

    const membershipKey = `${team.id}:${userUid}`;

    try {
      setPendingMembershipKey(membershipKey);
      setMessage(null);
      await addTeamMember({ teamId: team.id, userUid }).unwrap();
      showMessage("success", `Member added to ${team.name}.`);
    } catch (error) {
      showMessage(
        "error",
        getErrorMessage(error, "Could not add user to team."),
      );
    } finally {
      setPendingMembershipKey(null);
    }
  }

  async function handleRemoveMember(team, userUid) {
    const membershipKey = `${team.id}:${userUid}`;

    try {
      setPendingMembershipKey(membershipKey);
      setMessage(null);
      await removeTeamMember({ teamId: team.id, userUid }).unwrap();
      showMessage("success", `Member removed from ${team.name}.`);
    } catch (error) {
      showMessage(
        "error",
        getErrorMessage(error, "Could not remove user from team."),
      );
    } finally {
      setPendingMembershipKey(null);
    }
  }

  return (
    <section style={styles.page}>
      <header style={styles.pageHeader}>
        <div>
          <p style={styles.eyebrow}>Operations</p>
          <h2 style={styles.title}>Operational Teams</h2>
          <p style={styles.subtitle}>
            Create teams and drag operational personnel onto a team to assign
            them.
          </p>
        </div>

        <button type="button" style={styles.createButton} onClick={openCreateModal}>
          <span aria-hidden="true">＋</span>
          Create Team
        </button>
      </header>

      {message ? (
        <div
          role="status"
          style={{
            ...styles.message,
            ...(message.type === "error"
              ? styles.errorMessage
              : message.type === "success"
                ? styles.successMessage
                : styles.infoMessage),
          }}
        >
          <span>{message.text}</span>
          <button
            type="button"
            aria-label="Dismiss message"
            style={styles.messageClose}
            onClick={() => setMessage(null)}
          >
            ×
          </button>
        </div>
      ) : null}

      <div style={styles.workspace}>
        <section style={styles.column}>
          <div style={styles.columnHeader}>Personnel Registry</div>
          <div style={styles.scrollArea}>
            {isLoading ? (
              <p style={styles.empty}>Loading personnel...</p>
            ) : usersByServiceProvider.length === 0 ? (
              <p style={styles.empty}>No operational users found.</p>
            ) : (
              usersByServiceProvider.map((group) => (
                <div key={group.serviceProviderId} style={styles.spGroup}>
                  <div style={styles.spHeadingRow}>
                    <span style={styles.spHeading}>
                      {group.serviceProviderName}
                    </span>
                    <span style={styles.spClassification}>
                      [
                      {serviceProviders.some(
                        (item) => item.id === group.serviceProviderId,
                      )
                        ? "SUBC"
                        : "MNC"}
                      ]
                    </span>
                  </div>

                  {group.users.map((user) => {
                    const userUid = cleanText(user.uid || user.id);
                    const isDragging = draggedUserUid === userUid;

                    return (
                      <article
                        key={userUid}
                        draggable
                        onDragStart={(event) => handleDragStart(event, user)}
                        onDragEnd={handleDragEnd}
                        style={{
                          ...styles.userCard,
                          ...(isDragging ? styles.userCardDragging : null),
                        }}
                        title="Drag this person onto an operational team"
                      >
                        <span style={styles.dragHandle} aria-hidden="true">
                          ⠿
                        </span>
                        <div style={styles.userCardBody}>
                          <strong style={styles.userName}>
                            {getUserDisplayName(user)}
                          </strong>
                          <span style={styles.userMeta}>
                            Role: {getUserRole(user)} • TRNs:{" "}
                            {trnsLoading
                              ? "…"
                              : trnCountsByUserUid.get(userUid) || 0}
                          </span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </section>

        <section style={{ ...styles.column, ...styles.teamsColumn }}>
          <div style={styles.columnHeader}>Operational Teams</div>
          <div style={styles.scrollArea}>
            {isLoading ? (
              <p style={styles.empty}>Loading teams...</p>
            ) : visibleTeams.length === 0 ? (
              <p style={styles.empty}>No teams found.</p>
            ) : (
              visibleTeams.map((team) => {
                const members = getTeamMembers(team, usersByUid);
                const isDragOver = dragOverTeamId === team.id;
                const alreadyAssigned =
                  draggedUserUid &&
                  asArray(team.memberUserIds).includes(draggedUserUid);

                return (
                  <article
                    key={team.id}
                    onDragOver={(event) => handleTeamDragOver(event, team)}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget)) {
                        setDragOverTeamId(null);
                      }
                    }}
                    onDrop={(event) => handleTeamDrop(event, team)}
                    style={{
                      ...styles.teamCard,
                      ...(isDragOver
                        ? alreadyAssigned
                          ? styles.teamCardAlreadyAssigned
                          : styles.teamCardDropTarget
                        : null),
                    }}
                  >
                    <div style={styles.teamHeader}>
                      <strong style={styles.teamName}>{team.name}</strong>
                      <div style={styles.teamActions}>
                        <button
                          type="button"
                          style={styles.iconButton}
                          onClick={() => openRenameModal(team)}
                          title="Rename team"
                          aria-label={`Rename ${team.name}`}
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          style={{ ...styles.iconButton, ...styles.deleteButton }}
                          onClick={() => handleDeleteTeam(team)}
                          title="Delete team"
                          aria-label={`Delete ${team.name}`}
                        >
                          🗑
                        </button>
                      </div>
                    </div>

                    {isDragOver ? (
                      <div
                        style={{
                          ...styles.dropHint,
                          ...(alreadyAssigned
                            ? styles.dropHintAssigned
                            : styles.dropHintReady),
                        }}
                      >
                        {alreadyAssigned ? "Already Assigned" : "Assign"}
                      </div>
                    ) : null}

                    {members.length === 0 ? (
                      <div style={styles.emptyTeam}>No members yet</div>
                    ) : (
                      <div style={styles.memberList}>
                        {members.map((member) => {
                          const memberUid = cleanText(member.uid || member.id);
                          const membershipKey = `${team.id}:${memberUid}`;
                          const isPending = pendingMembershipKey === membershipKey;

                          return (
                            <div key={memberUid} style={styles.memberRow}>
                              <span style={styles.memberName}>
                                {getUserDisplayName(member)} [{getUserRole(member)}]
                              </span>
                              <button
                                type="button"
                                style={styles.removeButton}
                                disabled={isPending}
                                onClick={() =>
                                  handleRemoveMember(team, memberUid)
                                }
                                title="Remove member"
                                aria-label={`Remove ${getUserDisplayName(member)} from ${team.name}`}
                              >
                                {isPending ? "…" : "×"}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div style={styles.teamDropFooter}>
                      {pendingMembershipKey?.startsWith(`${team.id}:`)
                        ? "Saving membership..."
                        : "Drop personnel here"}
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>
      </div>

      {modalMode ? (
        <div style={styles.modalOverlay} role="presentation">
          <form style={styles.modalCard} onSubmit={handleSaveTeam}>
            <h3 style={styles.modalTitle}>
              {modalMode === "rename" ? "Rename Team" : "Create Team"}
            </h3>

            <label style={styles.label} htmlFor="operational-team-name">
              Team Name
            </label>
            <input
              id="operational-team-name"
              autoFocus
              value={teamName}
              onChange={(event) => setTeamName(event.target.value)}
              disabled={isSavingTeam}
              placeholder="Enter team name"
              style={styles.input}
            />

            <div style={styles.modalActions}>
              <button
                type="button"
                style={styles.secondaryButton}
                onClick={closeModal}
                disabled={isSavingTeam}
              >
                Cancel
              </button>
              <button
                type="submit"
                style={styles.primaryButton}
                disabled={isSavingTeam || !cleanText(teamName)}
              >
                {isSavingTeam
                  ? modalMode === "rename"
                    ? "Saving..."
                    : "Creating..."
                  : modalMode === "rename"
                    ? "Save"
                    : "Create"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}

const styles = {
  page: {
    padding: 24,
    minHeight: "calc(100vh - 80px)",
    background: "#f8fafc",
  },
  pageHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 18,
    marginBottom: 16,
    padding: 20,
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 22,
  },
  eyebrow: {
    margin: 0,
    color: "#2563eb",
    fontSize: 12,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  title: {
    margin: "6px 0 6px",
    color: "#0f172a",
    fontSize: 28,
  },
  subtitle: {
    margin: 0,
    color: "#64748b",
    fontSize: 14,
  },
  createButton: {
    border: 0,
    borderRadius: 12,
    padding: "11px 15px",
    background: "#2563eb",
    color: "#ffffff",
    fontWeight: 900,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
  },
  message: {
    marginBottom: 14,
    padding: "12px 14px",
    borderRadius: 12,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    fontSize: 13,
    fontWeight: 700,
  },
  errorMessage: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#991b1b",
  },
  successMessage: {
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
    color: "#166534",
  },
  infoMessage: {
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    color: "#1e40af",
  },
  messageClose: {
    border: 0,
    background: "transparent",
    color: "inherit",
    fontSize: 20,
    cursor: "pointer",
  },
  workspace: {
    display: "grid",
    gridTemplateColumns: "minmax(300px, 0.9fr) minmax(420px, 1.1fr)",
    minHeight: 620,
    overflow: "hidden",
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: 18,
  },
  column: {
    minWidth: 0,
    borderRight: "1px solid #e2e8f0",
  },
  teamsColumn: {
    borderRight: 0,
    background: "#f8fafc",
  },
  columnHeader: {
    height: 48,
    boxSizing: "border-box",
    padding: "15px 16px",
    background: "#1e293b",
    color: "#ffffff",
    fontSize: 12,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  scrollArea: {
    height: 572,
    overflowY: "auto",
    padding: 14,
  },
  empty: {
    color: "#94a3b8",
    fontSize: 12,
  },
  spGroup: {
    marginBottom: 18,
  },
  spHeadingRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 7,
    margin: "4px 0 7px",
  },
  spHeading: {
    color: "#2563eb",
    fontSize: 11,
    fontWeight: 900,
    textTransform: "uppercase",
  },
  spClassification: {
    color: "#64748b",
    fontSize: 9,
  },
  userCard: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    marginBottom: 7,
    padding: "10px 11px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 9,
    cursor: "grab",
    boxShadow: "0 3px 9px rgba(15, 23, 42, 0.04)",
  },
  userCardDragging: {
    opacity: 0.55,
    borderColor: "#2563eb",
  },
  dragHandle: {
    color: "#94a3b8",
    fontSize: 18,
    lineHeight: 1,
  },
  userCardBody: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },
  userName: {
    color: "#1e293b",
    fontSize: 13,
  },
  userMeta: {
    color: "#64748b",
    fontSize: 11,
  },
  teamCard: {
    marginBottom: 12,
    padding: 8,
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: 11,
    transition: "border-color 120ms ease, background 120ms ease",
  },
  teamCardDropTarget: {
    border: "2px solid #2563eb",
    background: "#eff6ff",
  },
  teamCardAlreadyAssigned: {
    border: "2px solid #16a34a",
    background: "#f0fdf4",
  },
  teamHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "6px 7px",
    background: "#f1f5f9",
    borderRadius: 7,
  },
  teamName: {
    color: "#1e293b",
    fontSize: 14,
  },
  teamActions: {
    display: "flex",
    alignItems: "center",
    gap: 2,
  },
  iconButton: {
    width: 29,
    height: 29,
    border: 0,
    borderRadius: 7,
    background: "transparent",
    color: "#2563eb",
    cursor: "pointer",
    fontSize: 16,
  },
  deleteButton: {
    color: "#ef4444",
  },
  dropHint: {
    margin: "7px 3px 3px",
    fontSize: 9,
    fontWeight: 900,
    textTransform: "uppercase",
  },
  dropHintReady: {
    color: "#2563eb",
  },
  dropHintAssigned: {
    color: "#16a34a",
  },
  emptyTeam: {
    padding: "9px 6px",
    color: "#94a3b8",
    fontSize: 11,
  },
  memberList: {
    padding: "7px 4px 3px",
  },
  memberRow: {
    minHeight: 29,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "3px 4px",
  },
  memberName: {
    color: "#334155",
    fontSize: 12,
  },
  removeButton: {
    width: 25,
    height: 25,
    border: 0,
    borderRadius: 7,
    background: "transparent",
    color: "#ef4444",
    cursor: "pointer",
    fontSize: 17,
  },
  teamDropFooter: {
    marginTop: 6,
    padding: "7px 6px 2px",
    borderTop: "1px dashed #cbd5e1",
    color: "#94a3b8",
    fontSize: 10,
    textAlign: "center",
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    zIndex: 1000,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    background: "rgba(15, 23, 42, 0.48)",
  },
  modalCard: {
    width: "min(430px, 100%)",
    padding: 20,
    background: "#ffffff",
    borderRadius: 16,
    boxShadow: "0 24px 70px rgba(15, 23, 42, 0.25)",
  },
  modalTitle: {
    margin: "0 0 16px",
    color: "#1e293b",
    fontSize: 18,
  },
  label: {
    display: "block",
    marginBottom: 6,
    color: "#334155",
    fontSize: 12,
    fontWeight: 800,
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "11px 12px",
    border: "1px solid #cbd5e1",
    borderRadius: 10,
    color: "#1e293b",
    fontSize: 14,
    outline: "none",
  },
  modalActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 9,
    marginTop: 17,
  },
  primaryButton: {
    border: 0,
    borderRadius: 10,
    padding: "10px 14px",
    background: "#2563eb",
    color: "#ffffff",
    fontWeight: 800,
    cursor: "pointer",
  },
  secondaryButton: {
    border: 0,
    borderRadius: 10,
    padding: "10px 14px",
    background: "#e2e8f0",
    color: "#1e293b",
    fontWeight: 800,
    cursor: "pointer",
  },
};
