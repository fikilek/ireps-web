/* eslint-disable no-unused-vars, react-hooks/set-state-in-effect -- subscription effects reset route-scoped loading state. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { skipToken } from "@reduxjs/toolkit/query";
import { Link, useParams } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";

import { db, functions } from "../../firebase";
import { useAuth } from "../../auth/useAuth";
import {
  useGetTargetedBatchAllocationDirectoryQuery,
  useGetTargetedBatchAllocationMatrixByLmQuery,
} from "../../redux/salesTargetedBatchApi";
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
  buildOrganisationAllocationMatrixResult,
  getCanonicalBatchState,
  getPendingAllocationProjectionMeters,
  projectOrganisationAllocation,
} from "./targeted-batches/allocation/allocationMatrixModel";
import {
  asArray,
  buildTargetPayload,
  buildUsersById,
  enrichServiceProvidersWithMembers,
  enrichTeamsWithMembers,
  getActorMncServiceProviderId,
  getProposedTrnType,
  getTargetLabel,
  getTargetOptionMicroText,
  getTargetOptionSubtitle,
  getTbRowId,
  getUserDisplayName,
  getUserRoleLabel,
  valueOrNav,
} from "./targeted-batches/allocation/targetedBatchAllocationUtils";

const EMPTY_LIST = Object.freeze([]);

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

function formatCompactMetricNumber(value) {
  const numeric = Number(value);
  const safeValue = Number.isFinite(numeric) ? numeric : 0;
  const rounded = Math.round((safeValue + Number.EPSILON) * 10) / 10;

  return Number.isInteger(rounded)
    ? rounded.toLocaleString("en-ZA")
    : rounded.toLocaleString("en-ZA", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      });
}

function formatSignedMetricNumber(value) {
  const numeric = Number(value);
  const safeValue = Number.isFinite(numeric) ? numeric : 0;
  const sign = safeValue > 0 ? "+" : "";
  return `${sign}${formatCompactMetricNumber(safeValue)}`;
}

function formatPercentMetric(value) {
  const numeric = Number(value);
  const safeValue = Number.isFinite(numeric) ? numeric : 0;
  return `${formatCompactMetricNumber(safeValue)}%`;
}

const METRIC_HELP = Object.freeze({
  batches: {
    title: "Batches",
    body: "The number of Targeted Batches historically allocated to this TEAM/SP in the current project scope. Completed batches remain part of this total.",
  },
  assigned: {
    title: "Assigned",
    body: "The total number of meter rows historically allocated to this TEAM/SP. Completed work remains included because this is the cumulative project allocation total.",
  },
  completed: {
    title: "Completed",
    body: "The number of historically assigned meter rows that have completed field execution.",
  },
  activeOpen: {
    title: "Active Open",
    body: "The number of currently assigned meter rows that are still active and unfinished. This is the TEAM/SP's current open workload.",
  },
  rejectedUnresolved: {
    title: "Rejected / Unresolved",
    body: "The number of meter rows in rejected batches whose release or reallocation has not yet been resolved by the common Targeted Batch lifecycle rules. They remain visible separately and are not assumed to be available again.",
  },
  progress: {
    title: "Progress",
    body: "Completed meter rows divided by all historically assigned meter rows. A new unfinished allocation can temporarily reduce this percentage because Assigned increases before Completed does.",
  },
  projectShare: {
    title: "Project Share",
    body: "This TEAM/SP's percentage share of all historical meter-row allocation in the current comparison scope. It helps show whether cumulative project work is being distributed evenly.",
  },
  versusAverage: {
    title: "Vs Average",
    body: "How many historically assigned meters this TEAM/SP sits above or below the current average for eligible targets of the same type. Positive means above average; negative means below average.",
  },
});

function MetricHelp({ help, targetType = "TEAM" }) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const anchorRef = useRef(null);
  const popoverRef = useRef(null);
  const closeTimerRef = useRef(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor || typeof window === "undefined") return;

    const rect = anchor.getBoundingClientRect();
    const popoverWidth = 285;
    const margin = 8;
    const left = Math.min(
      Math.max(margin, rect.right - popoverWidth),
      Math.max(margin, window.innerWidth - popoverWidth - margin),
    );
    const estimatedHeight = 190;
    const shouldOpenAbove =
      rect.bottom + estimatedHeight + margin > window.innerHeight &&
      rect.top > estimatedHeight + margin;

    setPosition({
      left,
      top: shouldOpenAbove ? rect.top - estimatedHeight - 6 : rect.bottom + 6,
    });
  }, []);

  const openHelp = useCallback(() => {
    clearCloseTimer();
    updatePosition();
    setIsOpen(true);
  }, [clearCloseTimer, updatePosition]);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => setIsOpen(false), 140);
  }, [clearCloseTimer]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleViewportChange = () => updatePosition();
    const handlePointerDown = (event) => {
      if (
        anchorRef.current?.contains(event.target) ||
        popoverRef.current?.contains(event.target)
      ) {
        return;
      }
      setIsOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, updatePosition]);

  useEffect(
    () => () => {
      clearCloseTimer();
    },
    [clearCloseTimer],
  );

  if (!help) return null;

  const body = help.body.replace(/TEAM\/SP/g, targetType === "SP" ? "SP" : "TEAM");
  const tooltip = isOpen && typeof document !== "undefined"
    ? createPortal(
        <span
          ref={popoverRef}
          style={{
            ...styles.metricHelpPopover,
            top: position.top,
            left: position.left,
          }}
          role="tooltip"
          onMouseEnter={clearCloseTimer}
          onMouseLeave={scheduleClose}
        >
          <strong style={styles.metricHelpTitle}>{help.title}</strong>
          <span style={styles.metricHelpText}>{body}</span>
          <span style={styles.metricHelpProjectionNote}>
            Plain value = current. Bracketed value = projected after allocating
            the currently selected Targeted Batch.
          </span>
        </span>,
        document.body,
      )
    : null;

  return (
    <span
      style={styles.metricHelpWrap}
      onMouseEnter={openHelp}
      onMouseLeave={scheduleClose}
    >
      <button
        ref={anchorRef}
        type="button"
        style={styles.metricHelpButton}
        aria-label={`Explain ${help.title}`}
        aria-expanded={isOpen}
        onFocus={openHelp}
        onClick={(event) => {
          event.stopPropagation();
          openHelp();
        }}
      >
        ?
      </button>
      {tooltip}
    </span>
  );
}

function WorkloadMetric({
  label,
  value,
  projectedValue = null,
  help = null,
  targetType = "TEAM",
}) {
  return (
    <span style={styles.workloadMetric}>
      <span style={styles.workloadMetricHeader}>
        <small style={styles.workloadMetricLabel}>{label}</small>
        <MetricHelp help={help} targetType={targetType} />
      </span>
      <span style={styles.workloadMetricValueRow}>
        <strong style={styles.workloadMetricValue}>{value}</strong>
        {projectedValue !== null && projectedValue !== undefined ? (
          <span style={styles.workloadProjectedValue}>({projectedValue})</span>
        ) : null}
      </span>
    </span>
  );
}

function WorkloadBalanceMetric({
  label,
  value,
  projectedValue = null,
  help = null,
  targetType = "TEAM",
}) {
  return (
    <span style={styles.workloadBalanceItem}>
      <span style={styles.workloadMetricHeader}>
        <small>{label}</small>
        <MetricHelp help={help} targetType={targetType} />
      </span>
      <span style={styles.workloadBalanceValueRow}>
        <strong>{value}</strong>
        {projectedValue !== null && projectedValue !== undefined ? (
          <span style={styles.workloadProjectedValueSecondary}>
            ({projectedValue})
          </span>
        ) : null}
      </span>
    </span>
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
  const authContext = useAuth();
  const actorMncServiceProviderId = getActorMncServiceProviderId(authContext);

  const [batch, setBatch] = useState(null);
  const [permanentRows, setPermanentRows] = useState([]);
  const [isBatchLoading, setIsBatchLoading] = useState(true);
  const [batchLoadError, setBatchLoadError] = useState("");

  const [targetType, setTargetType] = useState("TEAM");
  const [targetId, setTargetId] = useState("");
  const [dragTarget, setDragTarget] = useState(null);
  const [isBatchDropFocused, setIsBatchDropFocused] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [allocationError, setAllocationError] = useState("");
  const [isAllocating, setIsAllocating] = useState(false);

  const decodedTbId = decodeURIComponent(tbId || "");

  useEffect(() => {
    {
      setIsBatchLoading(true);
      setBatchLoadError("");
      setBatch(null);
      setPermanentRows([]);
      setTargetId("");
      setStatusMessage("");
      setAllocationError("");

      if (!decodedTbId) {
        setBatchLoadError("The Targeted Batch ID is missing from the route.");
        setIsBatchLoading(false);
        return undefined;
      }
      let parentReady = false;
      let rowsReady = false;
      const markReady = () => parentReady && rowsReady && setIsBatchLoading(false);
      const handleError = (error) => {
        setBatchLoadError(error?.message || "The permanent Targeted Batch could not be loaded from Firestore.");
        setIsBatchLoading(false);
      };
      const unsubscribeParent = onSnapshot(doc(db, "tb_uploads", decodedTbId), (parentSnapshot) => {
        if (!parentSnapshot.exists()) {
          setBatchLoadError(
            `Permanent Targeted Batch ${decodedTbId} was not found.`,
          );
          setBatch(null);
          parentReady = true;
          markReady();
          return;
        }

        const permanentBatch = {
          ...parentSnapshot.data(),
          id: parentSnapshot.id,
        };

        setBatch(permanentBatch);
        parentReady = true;
        markReady();
      }, handleError);
      const unsubscribeRows = onSnapshot(query(collection(db, "tb_rows"), where("tbId", "==", decodedTbId)), (rowsSnapshot) => {
        const loadedRows = rowsSnapshot.docs
          .map(mapPermanentTbRow)
          .sort((left, right) => Number(left.rowNo) - Number(right.rowNo));

        setPermanentRows(loadedRows);
        rowsReady = true;
        markReady();
      }, handleError);

    return () => {
      unsubscribeParent();
      unsubscribeRows();
    };
    }
  }, [decodedTbId]);

  const sourceType = batch?.source?.type || "";
  const isSalesSource = ["PREPAID_SALES", "PREPAID_SALES_NON_GPS"].includes(
    sourceType,
  );
  const isConfirmed = batch?.creation?.state === "READY";
  const backendTarget = useMemo(() => getBatchBackendTarget(batch), [batch]);
  const isPermanentlyAllocated = Boolean(backendTarget?.id);
  const isAllocationLocked = isPermanentlyAllocated || isAllocating;

  const {
    data: allocationDirectory,
    isError: isAllocationDirectoryError,
    error: allocationDirectoryQueryError,
  } = useGetTargetedBatchAllocationDirectoryQuery(
    actorMncServiceProviderId || skipToken,
  );

  const availableTeams = Array.isArray(allocationDirectory?.teams)
    ? allocationDirectory.teams
    : EMPTY_LIST;
  const availableServiceProviders = Array.isArray(
    allocationDirectory?.serviceProviders,
  )
    ? allocationDirectory.serviceProviders
    : EMPTY_LIST;

  const {
    data: usersDirectory = [],
    isLoading: areUsersLoading,
    isError: areUsersError,
    error: usersError,
  } = useGetUsersDirectoryQuery({ limit: 1000 });

  const batchLmPcode = String(batch?.scope?.lmPcode || "").trim();
  const {
    data: allocationMatrixStream,
    isError: isAllocationMatrixError,
    error: allocationMatrixQueryError,
  } = useGetTargetedBatchAllocationMatrixByLmQuery(
    batchLmPcode || skipToken,
  );

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

  const allocationMatrixBatches = Array.isArray(
    allocationMatrixStream?.batches,
  )
    ? allocationMatrixStream.batches
    : EMPTY_LIST;
  const allocationMatrixRows = Array.isArray(allocationMatrixStream?.rows)
    ? allocationMatrixStream.rows
    : EMPTY_LIST;
  const allocationMatrixResult = useMemo(
    () =>
      buildOrganisationAllocationMatrixResult({
        batches: allocationMatrixBatches,
        rows: allocationMatrixRows,
        teams: availableTeamsWithMembers,
        serviceProviders: availableServiceProvidersWithMembers,
      }),
    [
      allocationMatrixBatches,
      allocationMatrixRows,
      availableTeamsWithMembers,
      availableServiceProvidersWithMembers,
    ],
  );
  const organisationWorkloads = allocationMatrixResult.organisations;
  const allocationIntegrityIssues = allocationMatrixResult.integrityIssues;
  const workloadByTarget = useMemo(
    () =>
      new Map(
        organisationWorkloads.map((workload) => [workload.key, workload]),
      ),
    [organisationWorkloads],
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
    allocationDirectory?.sync?.status === "syncing" || areUsersLoading;

  const targetContextError =
    allocationDirectory?.sync?.status === "error" ||
    isAllocationDirectoryError ||
    areUsersError;

  const targetContextErrorMessage =
    allocationDirectory?.sync?.error?.message ||
    allocationDirectoryQueryError?.error ||
    allocationDirectoryQueryError?.data?.message ||
    usersError?.message ||
    usersError?.data?.message ||
    "Could not load the authority-scoped TEAM/SP allocation directory.";

  const allocationMatrixError =
    allocationMatrixStream?.sync?.error ||
    (isAllocationMatrixError
      ? {
          message:
            allocationMatrixQueryError?.error ||
            allocationMatrixQueryError?.data?.message ||
            "The live Allocation Matrix stream could not be opened.",
        }
      : null);
  const allocationMatrixReady =
    allocationMatrixStream?.sync?.status === "ready";
  const pendingProjectionMeters = getPendingAllocationProjectionMeters({
    batch,
    rows: permanentRows,
    rowsReady: !isBatchLoading,
  });

  function handleTargetTypeChange(nextType) {
    if (isAllocationLocked) return;

    setTargetType(nextType);
    setTargetId("");
    setStatusMessage("");
  }

  function handleSelectTarget(target) {
    if (isAllocationLocked) return;

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
    if (isAllocationLocked) {
      setStatusMessage(
        isPermanentlyAllocated
          ? "This Targeted Batch already has a permanent backend allocation."
          : "The permanent allocation is currently being written and verified.",
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
    if (isAllocationLocked) {
      setStatusMessage(
        isPermanentlyAllocated
          ? "The permanent Targeted Batch allocation cannot be cleared here."
          : "The allocation cannot be changed while it is being written and verified.",
      );
      return;
    }

    setTargetId("");
    setStatusMessage("The frontend Targeted Batch allocation was cleared.");
  }

  function handleTargetDragStart(event, target) {
    if (isAllocationLocked) return;

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
    if (isAllocationLocked) return;
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
    if (isAllocationLocked) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  async function handleAllocateTargetedBatch() {
    if (isAllocationLocked) return;

    const target = buildTargetPayload(selectedTargetPayload);

    if (!target) {
      setAllocationError("Select one TEAM or Service Provider first.");
      return;
    }

    const confirmed = window.confirm(
      `Allocate the complete Targeted Batch ${batch.id} (${permanentRows.length} row(s)) to ${getTargetLabel(target)}? This creates one permanent whole-batch allocation.`,
    );

    if (!confirmed) return;

    setIsAllocating(true);
    setAllocationError("");
    setStatusMessage(
      `Allocating ${batch.id} to ${getTargetLabel(target)}...`,
    );

    try {
      const allocateTargetedBatch = httpsCallable(
        functions,
        "onAllocateTargetedBatchCallable",
      );
      const response = await allocateTargetedBatch({
        tbId: batch.id,
        targetType: target.type,
        targetId: target.id,
      });
      const result = response?.data || {};

      if (result?.success !== true) {
        const error = new Error(
          result?.message || "Targeted Batch allocation failed.",
        );
        error.code = result?.code || "TARGETED_BATCH_ALLOCATION_FAILED";
        error.details = result?.details || null;
        throw error;
      }

      const backendTarget = result?.target || target;
      const completedAt = result?.completedAt || new Date().toISOString();
      const allocatedRows = Number(
        result?.allocatedRows || permanentRows.length,
      );

      setBatch((current) => ({
        ...current,
        status: result?.batchStatus || "ALLOCATED",
        allocation: {
          ...(current?.allocation || {}),
          status: result?.allocationStatus || "ALLOCATED",
          targetType: backendTarget.type,
          targetId: backendTarget.id,
          targetName: backendTarget.name,
          memberCount: Number(backendTarget.memberCount || 0),
          completedAt,
        },
        counts: {
          ...(current?.counts || {}),
          allocatedRows,
          unallocatedRows: Number(result?.unallocatedRows || 0),
        },
      }));

      setPermanentRows((currentRows) =>
        currentRows.map((row) => ({
          ...row,
          allocation: {
            ...(row?.allocation || {}),
            status: "ALLOCATED",
            targetType: backendTarget.type,
            targetId: backendTarget.id,
            targetName: backendTarget.name,
            allocatedAt: completedAt,
          },
        })),
      );

      setStatusMessage(
        `${batch.id} and ${formatNumber(allocatedRows)} TB Row(s) were permanently allocated to ${getTargetLabel(backendTarget)}.`,
      );
    } catch (error) {
      const code = String(
        error?.code || error?.details?.code || "TARGETED_BATCH_ALLOCATION_FAILED",
      )
        .replace(/^functions\//, "")
        .toUpperCase();
      const message =
        error?.message ||
        error?.details?.message ||
        "Targeted Batch allocation failed.";

      setAllocationError(`${code}: ${message}`);
      setStatusMessage("");
    } finally {
      setIsAllocating(false);
    }
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
  const canonicalBatchState = getCanonicalBatchState(batch);
  const sourceLabel =
    batch?.source?.label ||
    (sourceType === "PREPAID_SALES_NON_GPS"
      ? "Prepaid Sales Non-GPS"
      : "Prepaid Sales");
  const allocationStatus =
    batch?.allocation?.status || (currentTarget ? "PLANNED" : "NOT_STARTED");
  const allocateDisabled =
    isAllocationLocked ||
    targetContextLoading ||
    targetContextError ||
    !currentTarget;
  const createDisabledReason = isPermanentlyAllocated
    ? "This Targeted Batch already has a permanent backend allocation."
    : isAllocating
      ? "The permanent whole-batch allocation is being written and verified."
      : targetContextLoading
        ? "TEAM/SP allocation targets are still loading."
        : targetContextError
          ? "TEAM/SP allocation targets could not be loaded."
          : !currentTarget
            ? "Select one TEAM or Service Provider for the complete Targeted Batch."
            : "Allocate the complete permanent Targeted Batch to this TEAM/SP.";

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
          to={`/sales/allocation-matrix?tbId=${encodeURIComponent(batch.id)}`}
          style={styles.matrixPageLink}
        >
          Allocation Matrix
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
            value={sourceLabel}
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
          <InfoCard label="State" value={canonicalBatchState} />
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
        permanent allocation.
      </div>

      {targetContextLoading ? (
        <div style={styles.notice}>Loading TEAM/SP allocation targets...</div>
      ) : null}

      {targetContextError ? (
        <div style={styles.errorNotice}>{targetContextErrorMessage}</div>
      ) : null}

      {allocationMatrixError ? (
        <div style={styles.matrixNotice}>
          Allocation decision support is temporarily unavailable: {
            allocationMatrixError?.message || "Allocation Matrix stream error."
          }
          {" "}The allocation backend remains authoritative.
        </div>
      ) : null}

      {allocationIntegrityIssues.length > 0 ? (
        <div style={styles.integrityNotice}>
          <strong>Allocation integrity warning:</strong>{" "}
          {allocationIntegrityIssues.length} batch(es) are quarantined from
          workload totals. Review the Allocation Matrix for TB IDs and issue
          codes before relying on project balancing figures.
        </div>
      ) : null}

      {statusMessage ? (
        <div style={styles.statusMessage}>{statusMessage}</div>
      ) : null}

      {allocationError ? (
        <div style={styles.errorNotice}>{allocationError}</div>
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
                disabled={isAllocationLocked}
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
                disabled={isAllocationLocked}
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
                  const workload =
                    workloadByTarget.get(`${target.type}:${target.id}`) || null;
                  const projection = workload
                    ? projectOrganisationAllocation({
                        organisation: workload,
                        allOrganisations: organisationWorkloads,
                        incomingMeters: pendingProjectionMeters,
                      })
                    : null;

                  return (
                    <article
                      key={`${target.type}_${target.id}`}
                      style={{
                        ...styles.targetOptionCard,
                        ...(selected
                          ? styles.targetOptionCardActive
                          : null),
                        ...(isAllocationLocked
                          ? styles.targetOptionCardLocked
                          : null),
                      }}
                    >
                      <button
                        type="button"
                        draggable={!isAllocationLocked}
                        disabled={isAllocationLocked}
                        style={styles.targetOptionSelectSurface}
                        onClick={() => handleSelectTarget(target)}
                        onDragStart={(event) =>
                          handleTargetDragStart(event, target)
                        }
                        onDragEnd={handleTargetDragEnd}
                        aria-label={`Select or drag ${target.type} ${target.name} onto the complete Targeted Batch`}
                      />
                      <div style={styles.targetOptionCardContent}>
                      <div style={styles.targetOptionHeader}>
                        <span style={styles.targetType}>{target.type}</span>
                        <strong style={styles.targetTitle}>
                          {target.name}
                        </strong>
                      </div>
                      <p style={styles.targetSub}>
                        {getTargetOptionSubtitle(target)}
                      </p>

                      <div style={styles.workloadBox}>
                        {allocationMatrixReady ? (
                          <>
                            <div style={styles.workloadSectionHeader}>
                              <span>PROJECT ALLOCATION</span>
                              {Number(workload?.integrityIssueBatches || 0) > 0 ? (
                                <span style={styles.workloadIntegrityWarning}>
                                  {workload.integrityIssueBatches} integrity issue
                                </span>
                              ) : null}
                            </div>

                            <div style={styles.workloadGrid}>
                              <WorkloadMetric
                                label="Batches"
                                help={METRIC_HELP.batches}
                                targetType={target.type}
                                value={formatCompactMetricNumber(workload?.batches || 0)}
                                projectedValue={
                                  projection
                                    ? formatCompactMetricNumber(
                                        Number(workload?.batches || 0) + 1,
                                      )
                                    : null
                                }
                              />
                              <WorkloadMetric
                                label="Assigned"
                                help={METRIC_HELP.assigned}
                                targetType={target.type}
                                value={formatCompactMetricNumber(
                                  workload?.assignedMeters || 0,
                                )}
                                projectedValue={
                                  projection
                                    ? formatCompactMetricNumber(
                                        projection.projectedAssigned,
                                      )
                                    : null
                                }
                              />
                              <WorkloadMetric
                                label="Completed"
                                help={METRIC_HELP.completed}
                                targetType={target.type}
                                value={formatCompactMetricNumber(
                                  workload?.completedMeters || 0,
                                )}
                                projectedValue={
                                  projection
                                    ? formatCompactMetricNumber(
                                        workload?.completedMeters || 0,
                                      )
                                    : null
                                }
                              />
                              <WorkloadMetric
                                label="Active Open"
                                help={METRIC_HELP.activeOpen}
                                targetType={target.type}
                                value={formatCompactMetricNumber(
                                  workload?.remainingMeters || 0,
                                )}
                                projectedValue={
                                  projection
                                    ? formatCompactMetricNumber(
                                        projection.projectedRemaining,
                                      )
                                    : null
                                }
                              />
                              <WorkloadMetric
                                label="Rejected / Unresolved"
                                help={METRIC_HELP.rejectedUnresolved}
                                targetType={target.type}
                                value={formatCompactMetricNumber(
                                  workload?.rejectedUnresolvedMeters || 0,
                                )}
                                projectedValue={
                                  projection
                                    ? formatCompactMetricNumber(
                                        workload?.rejectedUnresolvedMeters || 0,
                                      )
                                    : null
                                }
                              />
                              <WorkloadMetric
                                label="Progress"
                                help={METRIC_HELP.progress}
                                targetType={target.type}
                                value={formatPercentMetric(
                                  workload?.progressPct || 0,
                                )}
                                projectedValue={
                                  projection
                                    ? formatPercentMetric(
                                        projection.projectedAssigned > 0
                                          ? (Number(workload?.completedMeters || 0) /
                                              Number(
                                                projection.projectedAssigned,
                                              )) *
                                              100
                                          : 0,
                                      )
                                    : null
                                }
                              />
                            </div>

                            <div style={styles.workloadBalanceRow}>
                              <WorkloadBalanceMetric
                                label="Project share"
                                help={METRIC_HELP.projectShare}
                                targetType={target.type}
                                value={formatPercentMetric(
                                  workload?.projectSharePct || 0,
                                )}
                                projectedValue={
                                  projection
                                    ? formatPercentMetric(
                                        projection.projectedProjectSharePct,
                                      )
                                    : null
                                }
                              />
                              <WorkloadBalanceMetric
                                label={`Vs ${target.type} avg`}
                                help={METRIC_HELP.versusAverage}
                                targetType={target.type}
                                value={formatSignedMetricNumber(
                                  workload?.varianceFromTypeAverage ?? 0,
                                )}
                                projectedValue={
                                  projection
                                    ? formatSignedMetricNumber(
                                        projection.projectedVarianceFromTypeAverage,
                                      )
                                    : null
                                }
                              />
                            </div>
                          </>
                        ) : (
                          <div style={styles.workloadLoading}>
                            {allocationMatrixError
                              ? "Allocation history unavailable."
                              : "Loading allocation history..."}
                          </div>
                        )}
                      </div>

                      <MembersList target={target} maxItems={4} />
                      <span style={styles.targetMicro}>
                        {getTargetOptionMicroText(target)}
                      </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <section style={{ ...styles.panel, ...styles.rightColumn }}>
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
                disabled={isAllocationLocked}
                title="Assign the selected TEAM/SP to the complete Targeted Batch"
              >
                <span style={styles.groupName}>{batch.id}</span>
                <div style={styles.groupMetricRow}>
                  <span>{formatNumber(permanentRows.length)} TB Rows</span>
                  <span>{sourceLabel}</span>
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
              {currentTarget && !isAllocationLocked ? (
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
              ...(allocateDisabled ? styles.disabledButton : null),
            }}
            disabled={allocateDisabled}
            title={createDisabledReason}
            onClick={handleAllocateTargetedBatch}
          >
            {isAllocating
              ? "Allocating and verifying..."
              : isPermanentlyAllocated
                ? "Targeted Batch Allocated"
                : "Allocate Targeted Batch"}
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
