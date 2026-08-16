import { useMemo, useState } from "react";
import { skipToken } from "@reduxjs/toolkit/query";
import { Link, useSearchParams } from "react-router-dom";

import { useAuth } from "../../auth/useAuth";
import {
  useGetTargetedBatchAllocationContextByIdQuery,
  useGetTargetedBatchAllocationDirectoryQuery,
  useGetTargetedBatchAllocationMatrixByLmQuery,
  useGetTargetedBatchAllocationRowsByLmQuery,
} from "../../redux/salesTargetedBatchApi";
import { useGetUsersDirectoryQuery } from "../../redux/usersApi";
import {
  buildOrganisationAllocationMatrixResult,
  buildUserExecutionMatrix,
  getCanonicalBatchState,
  getPendingAllocationProjectionMeters,
  projectOrganisationAllocation,
} from "./targeted-batches/allocation/allocationMatrixModel";
import {
  buildUsersById,
  enrichServiceProvidersWithMembers,
  enrichTeamsWithMembers,
  getActorMncServiceProviderId,
} from "./targeted-batches/allocation/targetedBatchAllocationUtils";

const ALL = "ALL";
const EMPTY_LIST = Object.freeze([]);

function cleanText(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return cleanText(value).toUpperCase();
}

function getActiveLmPcode(activeWorkbase) {
  return cleanText(
    activeWorkbase?.lmPcode ||
      activeWorkbase?.pcode ||
      activeWorkbase?.id ||
      activeWorkbase?.localMunicipalityId,
  );
}

function getActiveWorkbaseName(activeWorkbase) {
  return cleanText(
    activeWorkbase?.name ||
      activeWorkbase?.lmName ||
      activeWorkbase?.id ||
      activeWorkbase?.pcode ||
      "NAv",
  );
}

function formatNumber(value, maximumFractionDigits = 0) {
  return Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits,
  });
}

function signedNumber(value) {
  if (value === null || value === undefined) return "NAv";
  const number = Number(value || 0);
  const formatted = formatNumber(Math.abs(number), 1);
  if (number > 0) return `+${formatted}`;
  if (number < 0) return `-${formatted}`;
  return "0";
}

function Percent({ value }) {
  return <>{formatNumber(value, 1)}%</>;
}

function SummaryCard({ label, value, helper }) {
  return (
    <article style={styles.summaryCard}>
      <span style={styles.summaryLabel}>{label}</span>
      <strong style={styles.summaryValue}>{formatNumber(value, 1)}</strong>
      <span style={styles.summaryHelper}>{helper}</span>
    </article>
  );
}

function Th({ children }) {
  return <th style={styles.th}>{children}</th>;
}

function Td({ children, strong = false, colSpan }) {
  return (
    <td
      style={{ ...styles.td, ...(strong ? styles.strongCell : null) }}
      colSpan={colSpan}
    >
      {children}
    </td>
  );
}

function StateBadge({ value }) {
  const state = upper(value) || "NAv";
  return (
    <span
      style={{
        ...styles.stateBadge,
        ...(state === "COMPLETED" ? styles.stateSuccess : null),
        ...(state === "ALLOCATED" || state === "ACCEPTED"
          ? styles.stateActive
          : null),
        ...(state === "REJECTED" ? styles.stateDanger : null),
      }}
    >
      {state.replaceAll("_", " ")}
    </span>
  );
}

function getErrorMessage(...errors) {
  for (const error of errors) {
    const message =
      cleanText(error?.message) ||
      cleanText(error?.error) ||
      cleanText(error?.data?.message);
    if (message) return message;
  }
  return "";
}

export default function TargetedBatchAllocationMatrixPage() {
  const authContext = useAuth();
  const { activeWorkbase } = authContext;
  const actorMncServiceProviderId = getActorMncServiceProviderId(authContext);
  const activeLmPcode = getActiveLmPcode(activeWorkbase);
  const activeWorkbaseName = getActiveWorkbaseName(activeWorkbase);
  const [searchParams] = useSearchParams();
  const contextTbId = cleanText(searchParams.get("tbId"));

  const [view, setView] = useState("ORG");
  const [targetTypeFilter, setTargetTypeFilter] = useState(ALL);
  const [searchText, setSearchText] = useState("");

  const {
    data: contextStream,
    isError: contextQueryFailed,
    error: contextQueryError,
  } = useGetTargetedBatchAllocationContextByIdQuery(
    contextTbId || skipToken,
  );
  const contextBatch = contextStream?.batch || null;
  const contextLmPcode = cleanText(contextBatch?.scope?.lmPcode);
  const matrixLmPcode = contextTbId ? contextLmPcode : activeLmPcode;
  const matrixWorkbaseName = contextTbId
    ? cleanText(contextBatch?.scope?.lmName) || contextLmPcode || "Targeted Batch LM"
    : activeWorkbaseName;

  const {
    data: matrixStream,
    isError: matrixQueryFailed,
    error: matrixQueryError,
  } = useGetTargetedBatchAllocationMatrixByLmQuery(
    matrixLmPcode || skipToken,
  );

  const {
    data: userRowsStream,
    isError: userRowsQueryFailed,
    error: userRowsQueryError,
  } = useGetTargetedBatchAllocationRowsByLmQuery(
    view === "USER" && matrixLmPcode ? matrixLmPcode : skipToken,
  );

  const {
    data: allocationDirectory,
    isError: directoryQueryFailed,
    error: directoryQueryError,
  } = useGetTargetedBatchAllocationDirectoryQuery(
    actorMncServiceProviderId || skipToken,
  );

  const { data: users = EMPTY_LIST, isLoading: usersLoading } =
    useGetUsersDirectoryQuery({ limit: 1000 });

  const teams = Array.isArray(allocationDirectory?.teams)
    ? allocationDirectory.teams
    : EMPTY_LIST;
  const serviceProviders = Array.isArray(allocationDirectory?.serviceProviders)
    ? allocationDirectory.serviceProviders
    : EMPTY_LIST;
  const batches = Array.isArray(matrixStream?.batches)
    ? matrixStream.batches
    : EMPTY_LIST;
  const integrityRows = Array.isArray(matrixStream?.rows)
    ? matrixStream.rows
    : EMPTY_LIST;
  const userRows = Array.isArray(userRowsStream?.rows)
    ? userRowsStream.rows
    : EMPTY_LIST;
  const contextRows = Array.isArray(contextStream?.rows)
    ? contextStream.rows
    : EMPTY_LIST;
  const usersById = useMemo(() => buildUsersById(users), [users]);
  const enrichedTeams = useMemo(
    () => enrichTeamsWithMembers(teams, usersById),
    [teams, usersById],
  );
  const enrichedServiceProviders = useMemo(
    () => enrichServiceProvidersWithMembers(serviceProviders, users),
    [serviceProviders, users],
  );

  const organisationMatrixResult = useMemo(
    () =>
      buildOrganisationAllocationMatrixResult({
        batches,
        rows: integrityRows,
        teams: enrichedTeams,
        serviceProviders: enrichedServiceProviders,
      }),
    [batches, integrityRows, enrichedTeams, enrichedServiceProviders],
  );
  const organisations = organisationMatrixResult.organisations;
  const allocationIntegrityIssues = organisationMatrixResult.integrityIssues;

  const usersMatrix = useMemo(
    () =>
      buildUserExecutionMatrix({
        users,
        teams: enrichedTeams,
        batches,
        rows: userRows,
      }),
    [users, enrichedTeams, batches, userRows],
  );

  const contextReady = contextStream?.sync?.status === "ready";
  const incomingMeters = getPendingAllocationProjectionMeters({
    batch: contextBatch,
    rows: contextRows,
    rowsReady: contextReady,
  });
  const projectionActive = incomingMeters > 0;

  const visibleOrganisations = useMemo(() => {
    const search = upper(searchText);
    return organisations.filter((organisation) => {
      if (
        targetTypeFilter !== ALL &&
        organisation.type !== targetTypeFilter
      ) {
        return false;
      }
      if (!search) return true;
      return [organisation.name, organisation.id, organisation.type].some(
        (value) => upper(value).includes(search),
      );
    });
  }, [organisations, searchText, targetTypeFilter]);

  const visibleUsers = useMemo(() => {
    const search = upper(searchText);
    if (!search) return usersMatrix;
    return usersMatrix.filter((user) =>
      [user.name, user.role, user.serviceProvider, user.teams.join(" ")].some(
        (value) => upper(value).includes(search),
      ),
    );
  }, [usersMatrix, searchText]);

  const eligibleTargets = organisations.filter((item) => item.eligible).length;
  const totalAssigned = organisations.reduce(
    (sum, item) => sum + item.assignedMeters,
    0,
  );
  const totalCompleted = organisations.reduce(
    (sum, item) => sum + item.completedMeters,
    0,
  );
  const totalRemaining = organisations.reduce(
    (sum, item) => sum + item.remainingMeters,
    0,
  );
  const totalRejectedUnresolved = organisations.reduce(
    (sum, item) => sum + item.rejectedUnresolvedMeters,
    0,
  );
  const integrityIssueBatches = allocationIntegrityIssues.length;

  const matrixLoading =
    Boolean(matrixLmPcode) && matrixStream?.sync?.status === "syncing";
  const directoryLoading =
    Boolean(actorMncServiceProviderId) &&
    allocationDirectory?.sync?.status === "syncing";
  const userRowsLoading =
    view === "USER" && userRowsStream?.sync?.status === "syncing";
  const loading =
    matrixLoading || directoryLoading || usersLoading || userRowsLoading;

  const matrixError =
    matrixStream?.sync?.error ||
    (matrixQueryFailed ? matrixQueryError : null) ||
    allocationDirectory?.sync?.error ||
    (directoryQueryFailed ? directoryQueryError : null) ||
    (view === "USER"
      ? userRowsStream?.sync?.error ||
        (userRowsQueryFailed ? userRowsQueryError : null)
      : null);
  const matrixErrorMessage = getErrorMessage(matrixError);
  const contextError =
    contextStream?.sync?.error ||
    (contextQueryFailed ? contextQueryError : null);
  const contextMissing = Boolean(contextTbId && contextReady && !contextBatch);

  return (
    <section style={styles.page}>
      <div style={styles.backRow}>
        {contextTbId ? (
          <Link
            to={`/operations/targeted-batches/${encodeURIComponent(contextTbId)}/allocation`}
            style={styles.backLink}
          >
            ← Back to Allocation
          </Link>
        ) : (
          <Link to="/sales/reporting" style={styles.backLink}>
            ← Back to Sales Reporting
          </Link>
        )}
      </div>

      <header style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Sales / Targeted Batches</p>
          <h1 style={styles.title}>Allocation Matrix</h1>
          <p style={styles.subtitle}>
            Compare cumulative project allocation, current active workload and
            field progress. Historical work remains visible so final project
            distribution can be assessed fairly. iREPS supplies decision
            intelligence; the allocator still chooses the TEAM or SP.
          </p>
        </div>
        <div style={styles.workbasePill}>
          <span>{matrixWorkbaseName}</span>
          <strong>
            {matrixLmPcode || (contextTbId && !contextReady ? "Loading..." : "No active LM")}
          </strong>
        </div>
      </header>

      {!matrixLmPcode ? (
        <div style={styles.warningNotice}>
          {contextTbId && !contextReady
            ? "Loading the Targeted Batch municipality context..."
            : "Activate a Local Municipality workbase before opening the Allocation Matrix."}
        </div>
      ) : null}

      {!actorMncServiceProviderId ? (
        <div style={styles.warningNotice}>
          The current user has no MNC Service Provider context. Current eligible
          allocation targets cannot be resolved.
        </div>
      ) : null}

      {contextTbId ? (
        <section style={styles.contextPanel}>
          <div>
            <span style={styles.contextLabel}>Allocation Context</span>
            <strong style={styles.contextValue}>{contextTbId}</strong>
          </div>
          <div>
            <span style={styles.contextLabel}>Source</span>
            <strong style={styles.contextValue}>
              {contextMissing
                ? "Not found"
                : contextBatch?.source?.label ||
                  contextBatch?.source?.type ||
                  "Loading..."}
            </strong>
          </div>
          <div>
            <span style={styles.contextLabel}>Batch State</span>
            {contextBatch ? (
              <StateBadge value={getCanonicalBatchState(contextBatch)} />
            ) : (
              <strong style={styles.contextValue}>
                {contextMissing ? "NOT FOUND" : "Loading..."}
              </strong>
            )}
          </div>
          <div>
            <span style={styles.contextLabel}>Incoming Meters</span>
            <strong style={styles.contextValue}>
              {contextReady ? formatNumber(incomingMeters) : "Loading..."}
            </strong>
          </div>
          <div>
            <span style={styles.contextLabel}>Projection</span>
            <strong style={styles.contextValue}>
              {projectionActive ? "ACTIVE" : "CURRENT POSITION ONLY"}
            </strong>
          </div>
        </section>
      ) : null}

      {contextError ? (
        <div style={styles.errorNotice}>
          Allocation context could not be loaded: {getErrorMessage(contextError)}
        </div>
      ) : null}

      {integrityIssueBatches > 0 ? (
        <div style={styles.integrityNotice}>
          <strong>Allocation integrity warning:</strong> {integrityIssueBatches}{" "}
          batch(es) are quarantined from allocation totals until corrected.
          <div style={styles.integrityIssueList}>
            {allocationIntegrityIssues.slice(0, 8).map((issue) => (
              <span key={`${issue.batchId}:${issue.issues.join("|")}`}>
                <strong>{issue.batchId}</strong>: {issue.issues.join(", ")}
              </span>
            ))}
            {allocationIntegrityIssues.length > 8 ? (
              <span>
                +{allocationIntegrityIssues.length - 8} additional integrity issue
                batch(es)
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div style={styles.summaryGrid}>
        <SummaryCard
          label="Eligible TEAM/SP Targets"
          value={eligibleTargets}
          helper="Current MNC-scoped allocation candidates"
        />
        <SummaryCard
          label="Historically Assigned"
          value={totalAssigned}
          helper="Completed work remains in cumulative allocation"
        />
        <SummaryCard
          label="Completed"
          value={totalCompleted}
          helper="Rows completed in the field"
        />
        <SummaryCard
          label="Active Open"
          value={totalRemaining}
          helper="Open rows on ALLOCATED / ACCEPTED batches"
        />
        <SummaryCard
          label="Rejected / Unresolved"
          value={totalRejectedUnresolved}
          helper="Shown separately until common reallocation rules resolve ownership"
        />
      </div>

      <section style={styles.panel}>
        <div style={styles.toolbar}>
          <div style={styles.tabs}>
            <button
              type="button"
              style={{
                ...styles.tabButton,
                ...(view === "ORG" ? styles.tabButtonActive : null),
              }}
              onClick={() => setView("ORG")}
            >
              TEAM / SP
            </button>
            <button
              type="button"
              style={{
                ...styles.tabButton,
                ...(view === "USER" ? styles.tabButtonActive : null),
              }}
              onClick={() => setView("USER")}
            >
              Users
            </button>
          </div>

          <input
            type="search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder={
              view === "ORG" ? "Search TEAM/SP" : "Search user, TEAM or SP"
            }
            style={styles.searchInput}
          />
        </div>

        {view === "ORG" ? (
          <>
            <div style={styles.matrixExplanation}>
              <strong>Two truths are kept separate.</strong> Assigned Meters is
              cumulative project history and never disappears when work is
              completed. Active Open is current unfinished workload on
              ALLOCATED / ACCEPTED batches. Rejected work remains historical
              and is shown separately as unresolved until the common batch
              reallocation rule decides its operational ownership. Type averages
              compare only currently eligible TEAMs with TEAMs and SPs with SPs.
            </div>

            <div style={styles.typeFilterRow}>
              {[ALL, "TEAM", "SP"].map((type) => (
                <button
                  key={type}
                  type="button"
                  style={{
                    ...styles.filterButton,
                    ...(targetTypeFilter === type
                      ? styles.filterButtonActive
                      : null),
                  }}
                  onClick={() => setTargetTypeFilter(type)}
                >
                  {type === ALL ? "All TEAM / SP" : type}
                </button>
              ))}
            </div>

            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <Th>Type</Th>
                    <Th>TEAM / SP</Th>
                    <Th>Eligibility</Th>
                    <Th>Batches</Th>
                    <Th>Assigned</Th>
                    <Th>Completed</Th>
                    <Th>Active Open</Th>
                    <Th>Rejected / Unresolved</Th>
                    <Th>Progress</Th>
                    <Th>Project Share</Th>
                    <Th>Eligible Type Avg</Th>
                    <Th>Vs Type Avg</Th>
                    <Th>Integrity</Th>
                    {projectionActive ? <Th>Projected Assigned</Th> : null}
                    {projectionActive ? <Th>Projected Active Open</Th> : null}
                    {projectionActive ? <Th>Projected Vs Avg</Th> : null}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <Td colSpan={projectionActive ? 16 : 13}>
                        Loading live Allocation Matrix...
                      </Td>
                    </tr>
                  ) : null}
                  {!loading && matrixError ? (
                    <tr>
                      <Td colSpan={projectionActive ? 16 : 13}>
                        <div style={styles.errorNotice}>
                          {matrixErrorMessage ||
                            "The Allocation Matrix could not be loaded."}
                        </div>
                      </Td>
                    </tr>
                  ) : null}
                  {!loading && !matrixError && visibleOrganisations.length === 0 ? (
                    <tr>
                      <Td colSpan={projectionActive ? 16 : 13}>
                        No TEAM/SP targets match the current filters.
                      </Td>
                    </tr>
                  ) : null}
                  {!loading &&
                    !matrixError &&
                    visibleOrganisations.map((organisation) => {
                      const projection = projectionActive
                        ? projectOrganisationAllocation({
                            organisation,
                            allOrganisations: organisations,
                            incomingMeters,
                          })
                        : null;

                      return (
                        <tr key={organisation.key}>
                          <Td>
                            <span style={styles.typeBadge}>
                              {organisation.type}
                            </span>
                          </Td>
                          <Td strong>
                            <div style={styles.nameCell}>
                              <span>{organisation.name}</span>
                              <small>{organisation.memberCount} member(s)</small>
                            </div>
                          </Td>
                          <Td>
                            <span
                              style={
                                organisation.eligible
                                  ? styles.eligibleBadge
                                  : styles.historicalBadge
                              }
                            >
                              {organisation.eligible
                                ? "ELIGIBLE"
                                : "HISTORY ONLY"}
                            </span>
                          </Td>
                          <Td>{formatNumber(organisation.batches)}</Td>
                          <Td strong>{formatNumber(organisation.assignedMeters)}</Td>
                          <Td>{formatNumber(organisation.completedMeters)}</Td>
                          <Td strong>{formatNumber(organisation.remainingMeters)}</Td>
                          <Td>
                            {formatNumber(organisation.rejectedUnresolvedMeters)}
                          </Td>
                          <Td><Percent value={organisation.progressPct} /></Td>
                          <Td><Percent value={organisation.projectSharePct} /></Td>
                          <Td>
                            {organisation.eligible
                              ? formatNumber(organisation.typeAverageAssigned, 1)
                              : "NAv"}
                          </Td>
                          <Td>
                            <span
                              style={
                                organisation.varianceFromTypeAverage > 0
                                  ? styles.aboveAverage
                                  : organisation.varianceFromTypeAverage < 0
                                    ? styles.belowAverage
                                    : styles.onAverage
                              }
                            >
                              {signedNumber(organisation.varianceFromTypeAverage)}
                            </span>
                          </Td>
                          <Td>
                            {organisation.integrityIssueBatches > 0 ? (
                              <span style={styles.integrityBadge}>
                                {organisation.integrityIssueBatches} issue(s)
                              </span>
                            ) : (
                              <span style={styles.integrityOk}>OK</span>
                            )}
                          </Td>
                          {projectionActive ? (
                            <Td strong>
                              {projection
                                ? formatNumber(projection.projectedAssigned)
                                : "Not eligible"}
                            </Td>
                          ) : null}
                          {projectionActive ? (
                            <Td>
                              {projection
                                ? formatNumber(projection.projectedRemaining)
                                : "—"}
                            </Td>
                          ) : null}
                          {projectionActive ? (
                            <Td>
                              {projection
                                ? signedNumber(
                                    projection.projectedVarianceFromTypeAverage,
                                  )
                                : "—"}
                            </Td>
                          ) : null}
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            <div style={styles.userNotice}>
              <strong>User level = execution evidence, not allocation.</strong>{" "}
              Targeted Batches remain allocated only to TEAM/SP. The row stream
              is opened only while this Users view is active, and user metrics
              come from acceptance/execution audit evidence already written by
              the common Targeted Batch workflow.
            </div>
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <Th>User</Th>
                    <Th>Role</Th>
                    <Th>TEAM(s)</Th>
                    <Th>SP</Th>
                    <Th>TBs Accepted</Th>
                    <Th>Rows In Progress</Th>
                    <Th>Rows Completed</Th>
                    <Th>Execution Progress</Th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <Td colSpan={8}>Loading user execution matrix...</Td>
                    </tr>
                  ) : null}
                  {!loading && matrixError ? (
                    <tr>
                      <Td colSpan={8}>
                        <div style={styles.errorNotice}>
                          {matrixErrorMessage ||
                            "The user execution matrix could not be loaded."}
                        </div>
                      </Td>
                    </tr>
                  ) : null}
                  {!loading && !matrixError && visibleUsers.length === 0 ? (
                    <tr>
                      <Td colSpan={8}>No users match the current search.</Td>
                    </tr>
                  ) : null}
                  {!loading &&
                    !matrixError &&
                    visibleUsers.map((user) => (
                      <tr key={user.id}>
                        <Td strong>{user.name}</Td>
                        <Td>{user.role}</Td>
                        <Td>{user.teams.join(", ") || "NAv"}</Td>
                        <Td>{user.serviceProvider}</Td>
                        <Td>{formatNumber(user.acceptedBatches)}</Td>
                        <Td>{formatNumber(user.inProgressRows)}</Td>
                        <Td strong>{formatNumber(user.completedRows)}</Td>
                        <Td><Percent value={user.progressPct} /></Td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </section>
  );
}

const styles = {
  page: { display: "grid", gap: 18 },
  backRow: { display: "flex", alignItems: "center", gap: 12 },
  backLink: {
    color: "#2563eb",
    textDecoration: "none",
    fontSize: 13,
    fontWeight: 800,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 18,
    flexWrap: "wrap",
  },
  eyebrow: {
    margin: 0,
    color: "#2563eb",
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  title: { margin: "4px 0 0", color: "#0f172a", fontSize: 30 },
  subtitle: {
    maxWidth: 900,
    margin: "8px 0 0",
    color: "#64748b",
    fontSize: 14,
    fontWeight: 600,
    lineHeight: 1.6,
  },
  workbasePill: {
    display: "grid",
    gap: 2,
    border: "1px solid #dbeafe",
    background: "#eff6ff",
    color: "#1e3a8a",
    borderRadius: 14,
    padding: "10px 14px",
    fontSize: 12,
  },
  warningNotice: {
    border: "1px solid #fde68a",
    background: "#fffbeb",
    color: "#92400e",
    borderRadius: 14,
    padding: 14,
  },
  errorNotice: {
    border: "1px solid #fecaca",
    background: "#fef2f2",
    color: "#991b1b",
    borderRadius: 12,
    padding: 12,
  },
  integrityNotice: {
    border: "1px solid #fca5a5",
    background: "#fff1f2",
    color: "#9f1239",
    borderRadius: 14,
    padding: 14,
  },
  integrityIssueList: {
    display: "grid",
    gap: 4,
    marginTop: 8,
    fontSize: 11,
    lineHeight: 1.45,
  },
  contextPanel: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: 10,
    padding: 14,
    border: "1px solid #bfdbfe",
    borderRadius: 16,
    background: "#eff6ff",
  },
  contextLabel: {
    display: "block",
    color: "#64748b",
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
  },
  contextValue: {
    display: "block",
    marginTop: 4,
    color: "#0f172a",
    fontSize: 13,
  },
  stateBadge: {
    display: "inline-flex",
    marginTop: 4,
    borderRadius: 999,
    padding: "4px 8px",
    background: "#e2e8f0",
    color: "#475569",
    fontSize: 9,
    fontWeight: 900,
  },
  stateSuccess: { background: "#dcfce7", color: "#166534" },
  stateActive: { background: "#dbeafe", color: "#1d4ed8" },
  stateDanger: { background: "#fee2e2", color: "#b91c1c" },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))",
    gap: 10,
  },
  summaryCard: {
    display: "grid",
    gap: 4,
    padding: 14,
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    background: "#ffffff",
  },
  summaryLabel: {
    color: "#64748b",
    fontSize: 10,
    fontWeight: 900,
    textTransform: "uppercase",
  },
  summaryValue: { color: "#0f172a", fontSize: 24 },
  summaryHelper: { color: "#64748b", fontSize: 10, lineHeight: 1.4 },
  panel: {
    padding: 16,
    border: "1px solid #dbe4f0",
    borderRadius: 18,
    background: "#ffffff",
  },
  toolbar: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
    flexWrap: "wrap",
  },
  tabs: { display: "flex", gap: 8 },
  tabButton: {
    border: "1px solid #cbd5e1",
    borderRadius: 999,
    padding: "8px 12px",
    background: "#ffffff",
    color: "#475569",
    fontWeight: 900,
    cursor: "pointer",
  },
  tabButtonActive: {
    borderColor: "#2563eb",
    background: "#eff6ff",
    color: "#1d4ed8",
  },
  searchInput: {
    minWidth: 260,
    border: "1px solid #cbd5e1",
    borderRadius: 10,
    padding: "8px 10px",
    color: "#0f172a",
  },
  matrixExplanation: {
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    background: "#f8fafc",
    color: "#475569",
    fontSize: 11,
    lineHeight: 1.55,
  },
  userNotice: {
    marginBottom: 12,
    padding: 12,
    border: "1px solid #bfdbfe",
    borderRadius: 12,
    background: "#eff6ff",
    color: "#1e3a8a",
    fontSize: 11,
    lineHeight: 1.55,
  },
  typeFilterRow: { display: "flex", gap: 7, marginBottom: 12, flexWrap: "wrap" },
  filterButton: {
    border: "1px solid #cbd5e1",
    borderRadius: 999,
    padding: "7px 10px",
    background: "#ffffff",
    color: "#475569",
    fontWeight: 850,
    cursor: "pointer",
  },
  filterButtonActive: {
    borderColor: "#2563eb",
    background: "#eff6ff",
    color: "#1d4ed8",
  },
  tableWrap: {
    width: "100%",
    overflowX: "auto",
    border: "1px solid #e2e8f0",
    borderRadius: 14,
  },
  table: {
    width: "100%",
    minWidth: 1380,
    borderCollapse: "separate",
    borderSpacing: 0,
    fontSize: 11,
  },
  th: {
    position: "sticky",
    top: 0,
    zIndex: 2,
    padding: "9px 10px",
    borderRight: "1px solid #cbd5e1",
    borderBottom: "1px solid #cbd5e1",
    background: "#e2e8f0",
    color: "#0f172a",
    textAlign: "left",
    whiteSpace: "nowrap",
  },
  td: {
    padding: "9px 10px",
    borderRight: "1px solid #e2e8f0",
    borderBottom: "1px solid #e2e8f0",
    background: "#ffffff",
    color: "#334155",
    verticalAlign: "top",
  },
  strongCell: { color: "#0f172a", fontWeight: 850 },
  typeBadge: {
    borderRadius: 999,
    padding: "4px 7px",
    background: "#dbeafe",
    color: "#1d4ed8",
    fontSize: 9,
    fontWeight: 900,
  },
  eligibleBadge: {
    borderRadius: 999,
    padding: "4px 7px",
    background: "#dcfce7",
    color: "#166534",
    fontSize: 8,
    fontWeight: 900,
  },
  historicalBadge: {
    borderRadius: 999,
    padding: "4px 7px",
    background: "#f1f5f9",
    color: "#64748b",
    fontSize: 8,
    fontWeight: 900,
  },
  integrityBadge: {
    borderRadius: 999,
    padding: "4px 7px",
    background: "#fee2e2",
    color: "#b91c1c",
    fontSize: 8,
    fontWeight: 900,
  },
  integrityOk: { color: "#166534", fontWeight: 900, fontSize: 9 },
  nameCell: { display: "grid", gap: 2 },
  aboveAverage: { color: "#b45309", fontWeight: 900 },
  belowAverage: { color: "#166534", fontWeight: 900 },
  onAverage: { color: "#475569", fontWeight: 900 },
};
