/* eslint-disable no-unused-vars -- JSX tags are used by React. */
import { useMemo, useState } from "react";
import { skipToken } from "@reduxjs/toolkit/query";
import { Link, useSearchParams } from "react-router-dom";

import { useAuth } from "../../auth/useAuth";
import {
  useGetTargetedBatchAllocationContextByIdQuery,
  useGetTargetedBatchAllocationRowsByLmQuery,
} from "../../redux/salesTargetedBatchApi";
import {
  buildUserExecutionMatrix,
  getCanonicalBatchState,
  getPendingAllocationProjectionMeters,
  splitHundredPercent,
} from "./targeted-batches/allocation/allocationMatrixModel";
import {
  AllocationMatrixTeamSpTable,
  Percent,
  Td,
  Th,
} from "./targeted-batches/allocation/allocation-matrix-table.jsx";
import { useAllocationMatrix } from "./targeted-batches/allocation/use-allocation-matrix.js";

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

// Rules TB-R045 (1.3.57): while the batch rows are being counted, a card says so rather than 0.
function SummaryCard({ label, value, helper, percent = null, pending = "" }) {
  return (
    <article style={styles.summaryCard}>
      <span style={styles.summaryLabel}>{label}</span>
      <strong style={pending ? styles.summaryPending : styles.summaryValue}>
        {pending || formatNumber(value, 1)}
        {pending || percent === null ? null : <span style={styles.summaryPercent}> · <Percent value={percent} /></span>}
      </strong>
      <span style={styles.summaryHelper}>{helper}</span>
    </article>
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
  const { activeWorkbase } = useAuth();
  const activeLmPcode = getActiveLmPcode(activeWorkbase);
  const activeWorkbaseName = getActiveWorkbaseName(activeWorkbase);
  const [searchParams] = useSearchParams();
  const contextTbId = cleanText(searchParams.get("tbId"));

  const [view, setView] = useState("ORG");
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

  // Rules TB-R045: the TEAM / SP numbers, shared with the Allocation Matrix on TB Register (1.3.51).
  const matrix = useAllocationMatrix(matrixLmPcode);
  const { actorMncServiceProviderId, batches, users, enrichedTeams, organisations, matrixRows } = matrix;
  const fieldWorkSummary = matrix.fieldWork.summary;
  const fieldWorkFailed = matrix.fieldWork.failed;

  const {
    data: userRowsStream,
    isError: userRowsQueryFailed,
    error: userRowsQueryError,
  } = useGetTargetedBatchAllocationRowsByLmQuery(
    view === "USER" && matrixLmPcode ? matrixLmPcode : skipToken,
  );
  const userRows = Array.isArray(userRowsStream?.rows)
    ? userRowsStream.rows
    : EMPTY_LIST;
  const contextRows = Array.isArray(contextStream?.rows)
    ? contextStream.rows
    : EMPTY_LIST;

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
  const totalWork = totalCompleted + matrixRows.reduce((sum, item) => sum + item.fieldWork.transactions, 0);

  const userRowsLoading =
    view === "USER" && userRowsStream?.sync?.status === "syncing";
  const usersViewLoading = matrix.loading || userRowsLoading;
  const usersViewError =
    matrix.error ||
    userRowsStream?.sync?.error ||
    (userRowsQueryFailed ? userRowsQueryError : null);
  const usersViewErrorMessage = getErrorMessage(usersViewError);
  const contextError =
    contextStream?.sync?.error ||
    (contextQueryFailed ? contextQueryError : null);
  const contextMissing = Boolean(contextTbId && contextReady && !contextBatch);
  // The cards show the same numbers as the table, so they wait for the same counts.
  const cardsPending = matrix.loading ? "Counting…" : matrix.error ? "Not available" : "";

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
            how far each is with them, and the field work each has done outside
            batches. Rest the pointer on the ? next to a heading to see what it
            means. iREPS supplies the picture; the allocator still chooses the
            TEAM or SP.
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
              {incomingMeters > 0 ? "ACTIVE" : "CURRENT POSITION ONLY"}
            </strong>
          </div>
        </section>
      ) : null}

      {contextError ? (
        <div style={styles.errorNotice}>
          Allocation context could not be loaded: {getErrorMessage(contextError)}
        </div>
      ) : null}

      <div style={styles.summaryGrid}>
        <SummaryCard
          pending={cardsPending}
          label="TEAMs / SPs"
          value={organisations.length}
          helper="Listed in the matrix below"
        />
        <SummaryCard
          pending={cardsPending}
          label="Meters Assigned"
          value={totalAssigned}
          helper="All meters in batches allocated to a TEAM or SP (rejected batches left out)"
        />
        <SummaryCard
          pending={cardsPending}
          label="Not Started"
          value={totalNotStarted}
          percent={notStartedPct}
          helper="No field work recorded yet"
        />
        <SummaryCard
          pending={cardsPending}
          label="In Progress"
          value={totalInProgress}
          percent={inProgressPct}
          helper="Premise captured or No Access recorded; meter not yet captured"
        />
        <SummaryCard
          pending={cardsPending}
          label="Completed"
          value={totalCompleted}
          percent={completedPct}
          helper="Meter found and captured in the field"
        />
        <SummaryCard
          pending={cardsPending}
          label="Total Work"
          value={totalWork}
          helper={
            fieldWorkSummary
              ? "Completed in batches + transactions outside batches"
              : fieldWorkFailed
                ? "Work outside batches could not be loaded"
                : "Loading work outside batches…"
          }
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
          <AllocationMatrixTeamSpTable matrix={matrix} searchText={searchText} incomingMeters={incomingMeters} />
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
                  {usersViewLoading ? (
                    <tr>
                      <Td colSpan={8}>Loading user execution matrix...</Td>
                    </tr>
                  ) : null}
                  {!usersViewLoading && usersViewError ? (
                    <tr>
                      <Td colSpan={8}>
                        <div style={styles.errorNotice}>
                          {usersViewErrorMessage ||
                            "The user execution matrix could not be loaded."}
                        </div>
                      </Td>
                    </tr>
                  ) : null}
                  {!usersViewLoading && !usersViewError && visibleUsers.length === 0 ? (
                    <tr>
                      <Td colSpan={8}>No users match the current search.</Td>
                    </tr>
                  ) : null}
                  {!usersViewLoading &&
                    !usersViewError &&
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
  summaryPercent: { color: "#475569", fontSize: 15, fontWeight: 800 },
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
  summaryPending: { color: "#64748b", fontSize: 16, fontWeight: 800 },
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
  aboveAverage: { color: "#b45309", fontWeight: 900 },
  belowAverage: { color: "#166534", fontWeight: 900 },
  onAverage: { color: "#475569", fontWeight: 900 },
};
