/* eslint-disable no-unused-vars -- JSX tags are used by React. */
import { useEffect, useMemo, useRef, useState } from "react";
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
  projectMatrixAllocation,
  splitHundredPercent,
} from "./targeted-batches/allocation/allocationMatrixModel";
import { matrixColumnHelp } from "./targeted-batches/allocation/allocationMatrixHelp";
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

function Percent({ value }) {
  return <>{formatNumber(value, 1)}%</>;
}

// Rules TB-R045: the number and its percentage of Meters Assigned.
function CountPercent({ count, percent }) {
  return (
    <span style={styles.countPercent}>
      <strong style={styles.countValue}>{formatNumber(count)}</strong>
      <span style={styles.countPct}><Percent value={percent} /></span>
    </span>
  );
}

function SummaryCard({ label, value, helper, percent = null }) {
  return (
    <article style={styles.summaryCard}>
      <span style={styles.summaryLabel}>{label}</span>
      <strong style={styles.summaryValue}>
        {formatNumber(value, 1)}
        {percent === null ? null : <span style={styles.summaryPercent}> · <Percent value={percent} /></span>}
      </strong>
      <span style={styles.summaryHelper}>{helper}</span>
    </article>
  );
}

// Rules TB-R045: every heading has a "?". Resting the pointer on it (briefly) or tapping it opens
// the column's explanation window.
const HELP_HOVER_DELAY_MS = 350;
function HelpIcon({ label, onOpen }) {
  const timer = useRef(null);
  const cancel = () => { clearTimeout(timer.current); timer.current = null; };
  return (
    <button type="button" aria-label={`What ${label} means`} title={`What ${label} means`} style={styles.helpIcon}
      onMouseEnter={() => { cancel(); timer.current = setTimeout(onOpen, HELP_HOVER_DELAY_MS); }}
      onMouseLeave={cancel} onClick={() => { cancel(); onOpen(); }}>
      ?
    </button>
  );
}

function Th({ children, help = null, onHelp = null }) {
  return (
    <th style={styles.th}>
      <span style={styles.thContent}>
        {children}
        {help && onHelp ? <HelpIcon label={String(children)} onOpen={() => onHelp(help)} /> : null}
      </span>
    </th>
  );
}

function HelpWindow({ help, onClose }) {
  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  if (!help) return null;
  return (
    <div style={styles.helpBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={help.title} style={styles.helpCard}>
        <div style={styles.helpHeader}>
          <h2 style={styles.helpTitle}>{help.title}</h2>
          <button type="button" aria-label="Close" style={styles.helpClose} onClick={onClose}>×</button>
        </div>
        <div style={styles.helpBody}>
          {help.paragraphs.map((paragraph) => <p key={paragraph} style={styles.helpText}>{paragraph}</p>)}
          {help.formula ? <p style={styles.helpFormula}>{help.formula}</p> : null}
          {help.rows.length ? (
            <table style={styles.helpTable}>
              <tbody>
                {help.rows.map(([name, value]) => (
                  <tr key={name}><td style={styles.helpName}>{name}</td><td style={styles.helpValue}>{value}</td></tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {help.total ? <p style={styles.helpTotal}>{help.total}</p> : null}
        </div>
      </div>
    </div>
  );
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

  // Rules TB-R045: the cards match the table (matrix numbers; rejected batches left out).
  const matrixTotal = (key) => organisations.reduce((sum, item) => sum + item.matrix[key], 0);
  const totalAssigned = matrixTotal("assigned");
  const totalNotStarted = matrixTotal("notStarted");
  const totalInProgress = matrixTotal("inProgress");
  const totalCompleted = matrixTotal("completed");
  const [notStartedPct, inProgressPct, completedPct] = splitHundredPercent([totalNotStarted, totalInProgress, totalCompleted]);
  const [helpKey, setHelpKey] = useState("");
  const help = helpKey ? matrixColumnHelp(helpKey, { organisations: visibleOrganisations, allOrganisations: organisations, incomingMeters }) : null;
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
            How the project's meters have been allocated to each TEAM and SP,
            and how far each is with them. Rest the pointer on the ? next to a
            heading to see what it means. iREPS supplies the picture; the
            allocator still chooses the TEAM or SP.
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
          label="TEAMs / SPs"
          value={organisations.length}
          helper="Listed in the matrix below"
        />
        <SummaryCard
          label="Meters Assigned"
          value={totalAssigned}
          helper="All meters in batches allocated to a TEAM or SP (rejected batches left out)"
        />
        <SummaryCard
          label="Not Started"
          value={totalNotStarted}
          percent={notStartedPct}
          helper="No field work recorded yet"
        />
        <SummaryCard
          label="In Progress"
          value={totalInProgress}
          percent={inProgressPct}
          helper="Premise captured or No Access recorded; meter not yet captured"
        />
        <SummaryCard
          label="Completed"
          value={totalCompleted}
          percent={completedPct}
          helper="Meter found and captured in the field"
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
                    <Th help="type" onHelp={setHelpKey}>Type</Th>
                    <Th help="name" onHelp={setHelpKey}>TEAM / SP</Th>
                    <Th help="batches" onHelp={setHelpKey}>Batches</Th>
                    <Th help="assigned" onHelp={setHelpKey}>Meters Assigned</Th>
                    <Th help="notStarted" onHelp={setHelpKey}>Not Started</Th>
                    <Th help="inProgress" onHelp={setHelpKey}>In Progress</Th>
                    <Th help="completed" onHelp={setHelpKey}>Completed</Th>
                    <Th help="progress" onHelp={setHelpKey}>Progress</Th>
                    <Th help="projectShare" onHelp={setHelpKey}>Project Share</Th>
                    {projectionActive ? <Th help="projectedAssigned" onHelp={setHelpKey}>Projected Assigned</Th> : null}
                    {projectionActive ? <Th help="projectedShare" onHelp={setHelpKey}>Projected Project Share</Th> : null}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <Td colSpan={projectionActive ? 11 : 9}>
                        Loading live Allocation Matrix...
                      </Td>
                    </tr>
                  ) : null}
                  {!loading && matrixError ? (
                    <tr>
                      <Td colSpan={projectionActive ? 11 : 9}>
                        <div style={styles.errorNotice}>
                          {matrixErrorMessage ||
                            "The Allocation Matrix could not be loaded."}
                        </div>
                      </Td>
                    </tr>
                  ) : null}
                  {!loading && !matrixError && visibleOrganisations.length === 0 ? (
                    <tr>
                      <Td colSpan={projectionActive ? 11 : 9}>
                        No TEAM/SP targets match the current filters.
                      </Td>
                    </tr>
                  ) : null}
                  {!loading &&
                    !matrixError &&
                    visibleOrganisations.map((organisation) => {
                      const projection = projectionActive
                        ? projectMatrixAllocation({
                            organisation,
                            allOrganisations: organisations,
                            incomingMeters,
                          })
                        : null;
                      const matrix = organisation.matrix;

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
                          <Td>{formatNumber(matrix.batches)}</Td>
                          <Td strong>{formatNumber(matrix.assigned)}</Td>
                          <Td><CountPercent count={matrix.notStarted} percent={matrix.notStartedPct} /></Td>
                          <Td><CountPercent count={matrix.inProgress} percent={matrix.inProgressPct} /></Td>
                          <Td><CountPercent count={matrix.completed} percent={matrix.completedPct} /></Td>
                          <Td><Percent value={matrix.completedPct} /></Td>
                          <Td><Percent value={matrix.projectSharePct} /></Td>
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
                                ? <Percent value={projection.projectedProjectSharePct} />
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
      {help ? <HelpWindow help={help} onClose={() => setHelpKey("")} /> : null}
    </section>
  );
}

const styles = {
  // Rules TB-R045: numbers with percentages, "?" icons and the explanation window.
  summaryPercent: { color: "#475569", fontSize: 15, fontWeight: 800 },
  countPercent: { display: "grid", gap: 2 },
  countValue: { color: "#0f172a", fontSize: 12 },
  countPct: { color: "#64748b", fontSize: 10, fontWeight: 700 },
  thContent: { display: "inline-flex", alignItems: "center", gap: 6 },
  helpIcon: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: 999, border: "1px solid #2563eb", background: "#eff6ff", color: "#1d4ed8", fontSize: 11, fontWeight: 900, cursor: "help", padding: 0, lineHeight: 1 },
  helpBackdrop: { position: "fixed", inset: 0, zIndex: 10000, background: "rgba(15, 23, 42, 0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 },
  helpCard: { width: "min(94vw, 560px)", maxHeight: "86vh", display: "flex", flexDirection: "column", overflow: "hidden", borderRadius: 16, background: "#ffffff", boxShadow: "0 25px 80px rgba(15, 23, 42, 0.32)" },
  helpHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 18px", borderBottom: "1px solid #e2e8f0", flexShrink: 0 },
  helpTitle: { margin: 0, fontSize: 18, color: "#0f172a" },
  helpClose: { border: "none", background: "#f1f5f9", color: "#0f172a", width: 32, height: 32, borderRadius: 16, fontSize: 18, cursor: "pointer" },
  helpBody: { padding: "14px 18px 18px", overflowY: "auto", display: "grid", gap: 10 },
  helpText: { margin: 0, color: "#334155", fontSize: 14, lineHeight: 1.55 },
  helpFormula: { margin: 0, padding: "8px 10px", borderRadius: 10, background: "#eff6ff", color: "#1e3a8a", fontSize: 13, fontWeight: 800 },
  helpTable: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  helpName: { padding: "6px 8px", borderBottom: "1px solid #e2e8f0", color: "#0f172a", fontWeight: 800 },
  helpValue: { padding: "6px 8px", borderBottom: "1px solid #e2e8f0", color: "#334155", textAlign: "right", whiteSpace: "nowrap" },
  helpTotal: { margin: 0, padding: "8px 10px", borderRadius: 10, background: "#f1f5f9", color: "#0f172a", fontSize: 13, fontWeight: 900 },
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
