/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";

import { db } from "../../firebase";
import { useGetAvailableTeamsQuery } from "../../redux/teamsApi";
import { useGetAvailableServiceProvidersQuery } from "../../redux/serviceProvidersApi";
import { useGetUsersDirectoryQuery } from "../../redux/usersApi";
import {
  formatDateTime,
  formatNumber,
} from "./targeted-batches/targetedBatchUtils";
import {
  Badge,
  InfoCard,
  SummaryDetailRow,
} from "./targeted-batches/allocation/TargetedBatchAllocationPrimitives";
import styles from "./targeted-batches/allocation/targetedBatchAllocationStyles";
import {
  asArray,
  buildTargetPayload,
  buildUsersById,
  enrichServiceProvidersWithMembers,
  enrichTeamsWithMembers,
  getProposedTrnType,
  getTargetLabel,
  getTargetOptionMicroText,
  getTargetOptionSubtitle,
  getTbRowId,
  getUserDisplayName,
  getUserRoleLabel,
  valueOrNav,
} from "./targeted-batches/allocation/targetedBatchAllocationUtils";

function timestampToIso(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  if (typeof value?.seconds === "number") {
    return new Date(value.seconds * 1000).toISOString();
  }
  return null;
}

function mapPermanentTbRow(rowDoc) {
  const data = rowDoc.data() || {};
  const meterId = data?.refs?.meterId || null;

  return {
    ...data,
    id: rowDoc.id,
    tbRowId: rowDoc.id,
    rowNo: data.rowNo,
    salesAllMeterId: data.salesAllMeterId,
    meterNo: data?.meter?.numberRaw || data?.meter?.numberNormalized || "",
    accountNumber: data?.customer?.accountNumber || "",
    customerName: data?.customer?.customerName || "",
    addressLine1: data?.location?.addressLine1 || "",
    town: data?.location?.town || "",
    wardNumberLabel: data?.location?.wardNumberLabel || "",
    wardNumbers: Array.isArray(data?.location?.wardNumbers)
      ? data.location.wardNumbers
      : [],
    astId: meterId,
    astMatchStatus: meterId ? "MATCHED" : "NOT_MATCHED",
    proposedTrnType: meterId ? "METER_INSPECTION" : "METER_DISCOVERY",
  };
}

function getTargetMembers(target = {}) {
  return asArray(target.members);
}

function MembersList({ target, maxItems = 4 }) {
  const members = getTargetMembers(target);

  if (members.length === 0) {
    return (
      <div style={styles.memberEmpty}>
        {target.type === "TEAM"
          ? "No team members resolved yet."
          : "No SP members resolved yet."}
      </div>
    );
  }

  const visibleMembers = members.slice(0, maxItems);
  const hiddenCount = Math.max(members.length - visibleMembers.length, 0);

  return (
    <div style={styles.memberList}>
      {visibleMembers.map((member) => (
        <span
          key={member.id || member.uid || getUserDisplayName(member)}
          style={{
            ...styles.memberChip,
            ...(member.missing ? styles.memberChipWarning : null),
          }}
          title={getUserRoleLabel(member)}
        >
          <strong>{getUserDisplayName(member)}</strong>
          <small>{getUserRoleLabel(member)}</small>
        </span>
      ))}

      {hiddenCount > 0 ? (
        <span style={styles.memberMore}>+{hiddenCount} more</span>
      ) : null}
    </div>
  );
}

function getBatchBackendTarget(batch = {}) {
  const allocation = batch?.allocation || {};
  const target = allocation?.target || {};
  const id = allocation?.targetId || target?.id || null;

  if (!id) return null;

  return {
    id,
    name:
      allocation?.targetName ||
      target?.name ||
      target?.label ||
      id,
    type:
      allocation?.targetType ||
      target?.type ||
      "TEAM",
    memberCount:
      Number(allocation?.memberCount || target?.memberCount || 0),
    source: "BACKEND",
  };
}

function getRowAddress(row = {}) {
  return [row.addressLine1, row.town].filter(Boolean).join(" • ") || "NAv";
}

function getRowWard(row = {}) {
  return row.wardNumberLabel || asArray(row.wardNumbers)[0] || "NAv";
}

function Th({ children }) {
  return <th style={styles.th}>{children}</th>;
}

function Td({ children, strong = false }) {
  return (
    <td style={{ ...styles.td, ...(strong ? styles.strongCell : null) }}>
      {children}
    </td>
  );
}

export default function TargetedBatchAllocationPage() {
  const { tbId } = useParams();

  const [batch, setBatch] = useState(null);
  const [permanentRows, setPermanentRows] = useState([]);
  const [isBatchLoading, setIsBatchLoading] = useState(true);
  const [batchLoadError, setBatchLoadError] = useState("");

  const [targetType, setTargetType] = useState("TEAM");
  const [targetId, setTargetId] = useState("");
  const [dragTarget, setDragTarget] = useState(null);
  const [isBatchDropFocused, setIsBatchDropFocused] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const decodedTbId = decodeURIComponent(tbId || "");

  useEffect(() => {
    let active = true;

    async function loadPermanentTargetedBatch() {
      setIsBatchLoading(true);
      setBatchLoadError("");
      setBatch(null);
      setPermanentRows([]);
      setTargetId("");
      setStatusMessage("");

      if (!decodedTbId) {
        setBatchLoadError("The Targeted Batch ID is missing from the route.");
        setIsBatchLoading(false);
        return;
      }

      try {
        const parentRef = doc(db, "tb_uploads", decodedTbId);
        const rowsQuery = query(
          collection(db, "tb_rows"),
          where("tbId", "==", decodedTbId),
        );

        const [parentSnapshot, rowsSnapshot] = await Promise.all([
          getDoc(parentRef),
          getDocs(rowsQuery),
        ]);

        if (!active) return;

        if (!parentSnapshot.exists()) {
          setBatchLoadError(
            `Permanent Targeted Batch ${decodedTbId} was not found.`,
          );
          return;
        }

        const permanentBatch = {
          ...parentSnapshot.data(),
          id: parentSnapshot.id,
        };

        const loadedRows = rowsSnapshot.docs
          .map(mapPermanentTbRow)
          .sort((left, right) => Number(left.rowNo) - Number(right.rowNo));

        setBatch(permanentBatch);
        setPermanentRows(loadedRows);
      } catch (error) {
        if (!active) return;

        setBatchLoadError(
          error?.message ||
            "The permanent Targeted Batch could not be loaded from Firestore.",
        );
      } finally {
        if (active) setIsBatchLoading(false);
      }
    }

    loadPermanentTargetedBatch();

    return () => {
      active = false;
    };
  }, [decodedTbId]);

  const sourceType = batch?.source?.type || "";
  const isSalesSource = sourceType === "PREPAID_SALES";
  const isConfirmed = batch?.creation?.state === "READY";
  const backendTarget = useMemo(() => getBatchBackendTarget(batch), [batch]);
  const isPermanentlyAllocated = Boolean(backendTarget?.id);

  const {
    data: availableTeams = [],
    isLoading: areTeamsLoading,
    isError: areTeamsError,
    error: teamsError,
  } = useGetAvailableTeamsQuery({ limit: 500 });

  const {
    data: availableServiceProviders = [],
    isLoading: areServiceProvidersLoading,
    isError: areServiceProvidersError,
    error: serviceProvidersError,
  } = useGetAvailableServiceProvidersQuery({ limit: 500 });

  const {
    data: usersDirectory = [],
    isLoading: areUsersLoading,
    isError: areUsersError,
    error: usersError,
  } = useGetUsersDirectoryQuery({ limit: 1000 });

  const usersById = useMemo(
    () => buildUsersById(usersDirectory),
    [usersDirectory],
  );

  const availableTeamsWithMembers = useMemo(
    () => enrichTeamsWithMembers(availableTeams, usersById),
    [availableTeams, usersById],
  );

  const availableServiceProvidersWithMembers = useMemo(
    () =>
      enrichServiceProvidersWithMembers(
        availableServiceProviders,
        usersDirectory,
      ),
    [availableServiceProviders, usersDirectory],
  );

  const targetOptions =
    targetType === "SP"
      ? availableServiceProvidersWithMembers
      : availableTeamsWithMembers;

  const selectedTargetOption =
    targetOptions.find((item) => item.id === targetId) || null;

  const selectedTargetPayload = useMemo(
    () => buildTargetPayload(selectedTargetOption),
    [selectedTargetOption],
  );

  const currentTarget = backendTarget || selectedTargetPayload;

  const targetContextLoading =
    areTeamsLoading || areServiceProvidersLoading || areUsersLoading;

  const targetContextError =
    areTeamsError || areServiceProvidersError || areUsersError;

  const targetContextErrorMessage =
    teamsError?.message ||
    serviceProvidersError?.message ||
    usersError?.message ||
    teamsError?.data?.message ||
    serviceProvidersError?.data?.message ||
    usersError?.data?.message ||
    "Could not load TEAM/SP allocation targets.";

  function handleTargetTypeChange(nextType) {
    if (isPermanentlyAllocated) return;

    setTargetType(nextType);
    setTargetId("");
    setStatusMessage("");
  }

  function handleSelectTarget(target) {
    if (isPermanentlyAllocated) return;

    const cleanTarget = buildTargetPayload(target);

    if (!cleanTarget) {
      setTargetId("");
      return;
    }

    setTargetType(cleanTarget.type);
    setTargetId(cleanTarget.id);
    setStatusMessage(
      `${getTargetLabel(cleanTarget)} selected for the complete Targeted Batch.`,
    );
  }

  function assignTargetToWholeBatch(target = selectedTargetPayload) {
    if (isPermanentlyAllocated) {
      setStatusMessage(
        "This Targeted Batch already has a permanent backend allocation.",
      );
      return;
    }

    const cleanTarget = buildTargetPayload(target);

    if (!cleanTarget) {
      setStatusMessage("Select a TEAM or Service Provider first.");
      return;
    }

    setTargetType(cleanTarget.type);
    setTargetId(cleanTarget.id);
    setStatusMessage(
      `${getTargetLabel(cleanTarget)} assigned to the complete Targeted Batch frontend plan.`,
    );
  }

  function clearWholeBatchTarget() {
    if (isPermanentlyAllocated) {
      setStatusMessage(
        "The permanent Targeted Batch allocation cannot be cleared here.",
      );
      return;
    }

    setTargetId("");
    setStatusMessage("The frontend Targeted Batch allocation was cleared.");
  }

  function handleTargetDragStart(event, target) {
    if (isPermanentlyAllocated) return;

    const cleanTarget = buildTargetPayload(target);

    if (!cleanTarget) return;

    setDragTarget(cleanTarget);
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/json", JSON.stringify(cleanTarget));
    event.dataTransfer.setData("text/plain", getTargetLabel(cleanTarget));
  }

  function handleTargetDragEnd() {
    setDragTarget(null);
    setIsBatchDropFocused(false);
  }

  function readDroppedTarget(event) {
    const jsonPayload = event.dataTransfer.getData("application/json");

    if (jsonPayload) {
      try {
        return buildTargetPayload(JSON.parse(jsonPayload));
      } catch (error) {
        console.warn("Could not parse dropped Targeted Batch target", error);
      }
    }

    return buildTargetPayload(dragTarget || selectedTargetPayload);
  }

  function handleDropTargetOnBatch(event) {
    event.preventDefault();
    setIsBatchDropFocused(false);

    const droppedTarget = readDroppedTarget(event);

    if (!droppedTarget) return;

    assignTargetToWholeBatch(droppedTarget);
    setDragTarget(null);
  }

  function handleBatchDragEnter(event) {
    if (isPermanentlyAllocated) return;
    if (!dragTarget && !selectedTargetPayload) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsBatchDropFocused(true);
  }

  function handleBatchDragLeave(event) {
    const nextElement = event.relatedTarget;
    if (nextElement && event.currentTarget.contains(nextElement)) return;

    setIsBatchDropFocused(false);
  }

  function handleAllowBatchDrop(event) {
    if (isPermanentlyAllocated) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  if (isBatchLoading) {
    return (
      <section style={styles.page}>
        <Link to="/operations/targeted-batches" style={styles.backLink}>
          ← Back to TB Register
        </Link>
        <div style={styles.notice}>
          Loading permanent Targeted Batch and TB Rows...
        </div>
      </section>
    );
  }

  if (batchLoadError || !batch) {
    return (
      <section style={styles.page}>
        <Link to="/operations/targeted-batches" style={styles.backLink}>
          ← Back to TB Register
        </Link>
        <div style={styles.errorNotice}>
          <strong>Targeted Batch not available</strong>
          <p style={styles.noticeText}>
            {batchLoadError ||
              "The requested permanent Targeted Batch could not be loaded."}
          </p>
        </div>
      </section>
    );
  }

  if (!isSalesSource) {
    return (
      <section style={styles.page}>
        <Link to="/operations/targeted-batches" style={styles.backLink}>
          ← Back to TB Register
        </Link>
        <div style={styles.deferredPanel}>
          <Badge tone="warning">SALES ALLOCATION ONLY</Badge>
          <h2 style={styles.title}>Targeted Batch source not supported</h2>
          <p style={styles.subtitle}>
            The current release allocates permanent Targeted Batches created
            from the Sales table.
          </p>
        </div>
      </section>
    );
  }

  if (!isConfirmed) {
    return (
      <section style={styles.page}>
        <Link to="/operations/targeted-batches" style={styles.backLink}>
          ← Back to TB Register
        </Link>
        <div style={styles.deferredPanel}>
          <Badge tone="warning">BATCH NOT READY</Badge>
          <h2 style={styles.title}>Targeted Batch creation is not complete</h2>
          <p style={styles.subtitle}>
            Allocation is available only after permanent creation reaches
            READY.
          </p>
        </div>
      </section>
    );
  }

  if (permanentRows.length === 0) {
    return (
      <section style={styles.page}>
        <Link to="/operations/targeted-batches" style={styles.backLink}>
          ← Back to TB Register
        </Link>
        <div style={styles.errorNotice}>
          <strong>Permanent TB Rows not available</strong>
          <p style={styles.noticeText}>
            No permanent TB rows were found for this batch.
          </p>
        </div>
      </section>
    );
  }

  const finalReportStatus = batch?.finalReport?.status || "DRAFT";
  const allocationStatus =
    batch?.allocation?.status || (currentTarget ? "PLANNED" : "NOT_STARTED");
  const createDisabledReason = isPermanentlyAllocated
    ? "This Targeted Batch already has a permanent backend allocation."
    : !currentTarget
      ? "Select one TEAM or Service Provider for the complete Targeted Batch."
      : "Backend Targeted Batch allocation persistence is not connected yet.";

  return (
    <section style={styles.page}>
      <div style={styles.backRow}>
        <Link
          to={`/operations/targeted-batches/${encodeURIComponent(batch.id)}`}
          style={styles.backLink}
        >
          ← Back to TB Rows
        </Link>

        <Link
          to={`/operations/targeted-batches/${encodeURIComponent(
            batch.id,
          )}/final-report`}
          style={styles.backLink}
        >
          Final Report ({finalReportStatus})
        </Link>
      </div>

      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>
            Operations / Targeted Batch / Allocation
          </p>
          <h2 style={styles.title}>Allocate Targeted Batch</h2>
          <p style={styles.subtitle}>
            Allocate the complete permanent Targeted Batch to one TEAM or one
            Service Provider. The batch is not divided into groups or
            individual row allocations.
          </p>
        </div>

        <Badge tone={isPermanentlyAllocated ? "success" : "warning"}>
          {isPermanentlyAllocated
            ? "ALLOCATED"
            : "ALLOCATION BACKEND PENDING"}
        </Badge>
      </div>

      <div style={styles.summaryPanel}>
        <div style={styles.summaryMetaColumn}>
          <SummaryDetailRow label="TB ID" value={batch.id} />
          <SummaryDetailRow
            label="Confirmed"
            value={formatDateTime(
              timestampToIso(
                batch?.metadata?.confirmedAt ||
                  batch?.creation?.completedAt,
              ),
            )}
          />
          <SummaryDetailRow
            label="Source"
            value={batch?.source?.label || "Prepaid Sales"}
          />
        </div>

        <div style={styles.summaryMetricGrid}>
          <InfoCard
            label="LM"
            value={`${batch?.scope?.lmPcode || "NAv"} · ${
              batch?.scope?.lmName || "NAv"
            }`}
          />
          <InfoCard
            label="Batch Rows"
            value={formatNumber(permanentRows.length)}
          />
          <InfoCard label="Allocation" value={allocationStatus} />
          <InfoCard
            label="Target"
            value={currentTarget ? getTargetLabel(currentTarget) : "Not selected"}
          />
        </div>
      </div>

      <div style={styles.infoBanner}>
        <strong>Whole-batch allocation:</strong> this Targeted Batch remains one
        operational unit. Select or drag one TEAM/SP target onto the batch. All
        permanent TB Rows remain inside the same batch and inherit the same
        allocation when backend persistence is implemented.
      </div>

      {targetContextLoading ? (
        <div style={styles.notice}>Loading TEAM/SP allocation targets...</div>
      ) : null}

      {targetContextError ? (
        <div style={styles.errorNotice}>{targetContextErrorMessage}</div>
      ) : null}

      {statusMessage ? (
        <div style={styles.statusMessage}>{statusMessage}</div>
      ) : null}

      <section style={styles.boardGrid}>
        <div style={styles.leftColumn}>
          <section style={styles.panel}>
            <div style={styles.panelHeader}>
              <div>
                <h3 style={styles.panelTitle}>TB Target Setup</h3>
                <p style={styles.panelSubtitle}>
                  Select or drag the single TEAM or Service Provider that will
                  receive the complete Targeted Batch.
                </p>
              </div>

              <Badge tone={targetOptions.length > 0 ? "success" : "warning"}>
                {targetOptions.length} {targetType}(s)
              </Badge>
            </div>

            <div style={styles.targetToggleRow}>
              <button
                type="button"
                style={{
                  ...styles.targetToggleButton,
                  ...(targetType === "TEAM"
                    ? styles.targetToggleActive
                    : null),
                }}
                onClick={() => handleTargetTypeChange("TEAM")}
                disabled={isPermanentlyAllocated}
              >
                TEAM
              </button>

              <button
                type="button"
                style={{
                  ...styles.targetToggleButton,
                  ...(targetType === "SP"
                    ? styles.targetToggleActive
                    : null),
                }}
                onClick={() => handleTargetTypeChange("SP")}
                disabled={isPermanentlyAllocated}
              >
                SP
              </button>
            </div>

            {targetOptions.length === 0 ? (
              <div style={styles.emptyState}>
                No active{" "}
                {targetType === "TEAM"
                  ? "teams"
                  : "service providers"}{" "}
                found yet.
              </div>
            ) : (
              <div style={styles.targetOptionList}>
                {targetOptions.map((target) => {
                  const selected =
                    currentTarget?.id === target.id &&
                    currentTarget?.type === target.type;

                  return (
                    <button
                      key={`${target.type}_${target.id}`}
                      type="button"
                      draggable={!isPermanentlyAllocated}
                      disabled={isPermanentlyAllocated}
                      style={{
                        ...styles.targetOptionCard,
                        ...(selected
                          ? styles.targetOptionCardActive
                          : null),
                        ...(isPermanentlyAllocated
                          ? styles.disabledButton
                          : null),
                      }}
                      onClick={() => handleSelectTarget(target)}
                      onDragStart={(event) =>
                        handleTargetDragStart(event, target)
                      }
                      onDragEnd={handleTargetDragEnd}
                      title={`Select or drag ${target.type} ${target.name} onto the complete Targeted Batch`}
                    >
                      <div style={styles.targetOptionHeader}>
                        <span style={styles.targetType}>{target.type}</span>
                        <strong style={styles.targetTitle}>
                          {target.name}
                        </strong>
                      </div>
                      <p style={styles.targetSub}>
                        {getTargetOptionSubtitle(target)}
                      </p>
                      <MembersList target={target} maxItems={4} />
                      <span style={styles.targetMicro}>
                        {getTargetOptionMicroText(target)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <section style={styles.panel}>
          <div style={styles.panelHeader}>
            <div>
              <h3 style={styles.panelTitle}>Ready Targeted Batch</h3>
              <p style={styles.panelSubtitle}>
                The complete batch is the allocation unit. Its rows are not
                split or allocated separately.
              </p>
            </div>

            <Badge tone="success">
              {formatNumber(permanentRows.length)} row(s)
            </Badge>
          </div>

          <div
            style={{
              ...styles.groupCard,
              ...(currentTarget ? styles.groupCardAllocated : null),
              ...(isBatchDropFocused
                ? styles.groupCardDragFocused
                : null),
            }}
            onDragEnter={handleBatchDragEnter}
            onDragLeave={handleBatchDragLeave}
            onDragOver={handleAllowBatchDrop}
            onDrop={handleDropTargetOnBatch}
          >
            <div style={styles.groupMain}>
              <button
                type="button"
                style={styles.groupSelectButton}
                onClick={() => assignTargetToWholeBatch()}
                disabled={isPermanentlyAllocated}
                title="Assign the selected TEAM/SP to the complete Targeted Batch"
              >
                <span style={styles.groupName}>{batch.id}</span>
                <div style={styles.groupMetricRow}>
                  <span>{formatNumber(permanentRows.length)} TB Rows</span>
                  <span>{batch?.source?.label || "Prepaid Sales"}</span>
                  <span>{allocationStatus}</span>
                </div>
              </button>

              <div
                style={{
                  ...styles.groupAllocationBox,
                  ...(currentTarget
                    ? styles.groupAllocationBoxAssigned
                    : null),
                  ...(isBatchDropFocused
                    ? styles.groupAllocationBoxDragFocused
                    : null),
                }}
              >
                <span style={styles.groupAllocationLabel}>
                  Whole-batch target
                </span>
                <strong style={styles.groupAllocationTarget}>
                  {currentTarget
                    ? getTargetLabel(currentTarget)
                    : "No TEAM/SP assigned"}
                </strong>
                <span style={styles.groupAllocationMembers}>
                  {currentTarget
                    ? `${currentTarget.memberCount || 0} member(s)`
                    : isBatchDropFocused
                      ? "Release to assign this TEAM/SP to the whole batch."
                      : "Drop a TEAM/SP here, or select one and click the batch."}
                </span>
                <Badge tone={currentTarget ? "success" : "warning"}>
                  {isPermanentlyAllocated
                    ? "ALLOCATED"
                    : currentTarget
                      ? "READY TO CREATE"
                      : "WAITING"}
                </Badge>
              </div>
            </div>

            <div style={styles.groupActions}>
              {currentTarget && !isPermanentlyAllocated ? (
                <button
                  type="button"
                  style={styles.clearAssignmentButton}
                  onClick={clearWholeBatchTarget}
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>
        </section>
      </section>

      <section style={styles.panel}>
        <div style={styles.panelHeader}>
          <div>
            <h3 style={styles.panelTitle}>Allocation Review</h3>
            <p style={styles.panelSubtitle}>
              Review the one TEAM/SP allocation for the complete Targeted Batch.
            </p>
          </div>

          <button
            type="button"
            style={{
              ...styles.createButton,
              ...styles.disabledButton,
            }}
            disabled
            title={createDisabledReason}
          >
            Allocate Targeted Batch
          </button>
        </div>

        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <Th>TB ID</Th>
                <Th>Batch Rows</Th>
                <Th>Allocation Target</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Td strong>{batch.id}</Td>
                <Td>{formatNumber(permanentRows.length)}</Td>
                <Td>
                  {currentTarget ? (
                    <span
                      style={{
                        ...styles.allocationTargetPill,
                        ...(currentTarget.type === "TEAM"
                          ? styles.allocationTargetPillTeam
                          : styles.allocationTargetPillSp),
                      }}
                    >
                      {getTargetLabel(currentTarget)}
                    </span>
                  ) : (
                    "Not selected"
                  )}
                </Td>
                <Td>
                  <Badge tone={currentTarget ? "success" : "warning"}>
                    {isPermanentlyAllocated
                      ? "ALLOCATED"
                      : currentTarget
                        ? "READY TO CREATE"
                        : "WAITING"}
                  </Badge>
                </Td>
              </tr>
            </tbody>
          </table>
        </div>

        <p style={styles.noticeText}>
          {createDisabledReason} The current selection changes frontend state
          only; it does not yet update Firestore.
        </p>
      </section>

      <section style={styles.panel}>
        <div style={styles.panelHeader}>
          <div>
            <h3 style={styles.panelTitle}>TB Rows — Read Only</h3>
            <p style={styles.panelSubtitle}>
              These rows remain inside the Targeted Batch. They are shown for
              review and are not individual allocation units.
            </p>
          </div>

          <Badge tone="neutral">
            {formatNumber(permanentRows.length)} row(s)
          </Badge>
        </div>

        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <Th>TB Row</Th>
                <Th>Meter</Th>
                <Th>Account / Customer</Th>
                <Th>Address</Th>
                <Th>Ward</Th>
                <Th>Proposed TRN</Th>
              </tr>
            </thead>

            <tbody>
              {permanentRows.map((row) => (
                <tr key={row.id}>
                  <Td strong>{getTbRowId(row)}</Td>
                  <Td>
                    <strong>{row.meterNo || "NAv"}</strong>
                    <div style={styles.rowSourceIdentity}>
                      {row.salesAllMeterId || "NAv"}
                    </div>
                  </Td>
                  <Td>
                    {valueOrNav(row.accountNumber)} ·{" "}
                    {valueOrNav(row.customerName)}
                  </Td>
                  <Td>{getRowAddress(row)}</Td>
                  <Td>{getRowWard(row)}</Td>
                  <Td>
                    <Badge tone="info">{getProposedTrnType(row)}</Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
