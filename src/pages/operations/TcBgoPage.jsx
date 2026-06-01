import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { useAuth } from "../../auth/useAuth";

import {
  useGetTcRowsByTcIdQuery,
  useGetTcUploadByIdQuery,
} from "../../redux/tcApi";
import {
  useCreateBgoMutation,
  useDeleteUnacceptedBgoMutation,
  useGetBgoBatchesByTcIdQuery,
  useGetBgoRowsByTcIdQuery,
} from "../../redux/bgoApi";
import { useGetAvailableTeamsQuery } from "../../redux/teamsApi";
import { useGetAvailableServiceProvidersQuery } from "../../redux/serviceProvidersApi";
import { useGetUsersDirectoryQuery } from "../../redux/usersApi";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function valueOrNav(value) {
  if (value === null || value === undefined || value === "") return "NAv";
  return value;
}

function safeNumber(value, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function hasMeaningfulValue(value) {
  if (value === null || value === undefined) return false;

  const text = String(value).trim().toUpperCase();

  return (
    text !== "" &&
    text !== "NAV" &&
    text !== "N/A" &&
    text !== "NA" &&
    text !== "NULL" &&
    text !== "UNDEFINED"
  );
}

function getReportStatus(upload = {}) {
  return String(
    upload?.report?.status ||
      upload?.finalReport?.status ||
      upload?.reportStatus ||
      "DRAFT",
  )
    .trim()
    .toUpperCase();
}

function getGeofenceRefs(row) {
  return asArray(row?.geofenceRefs);
}

function getGeofenceId(ref = {}) {
  return String(ref?.id || ref?.name || "").trim();
}

function getGeofenceName(ref = {}) {
  return String(ref?.name || ref?.id || "NAv").trim();
}

function getMeterNo(row = {}) {
  return valueOrNav(row?.input?.meterNo || row?.ast?.astNo);
}

function getAddress(row = {}) {
  return valueOrNav(row?.premise?.address);
}

function getErfNo(row = {}) {
  return valueOrNav(row?.ast?.erfNo);
}

function getRowLmPcode(row, upload) {
  return (
    row?.ast?.lmPcode ||
    row?.ast?.parents?.lmPcode ||
    row?.ast?.accessData?.parents?.lmPcode ||
    row?.backend?.parents?.lmPcode ||
    row?.upload?.lmPcode ||
    upload?.lmPcode ||
    ""
  );
}

function getRowWardPcode(row, upload) {
  return (
    row?.ast?.wardPcode ||
    row?.ast?.parents?.wardPcode ||
    row?.ast?.accessData?.parents?.wardPcode ||
    row?.backend?.parents?.wardPcode ||
    row?.upload?.wardPcode ||
    upload?.wardPcode ||
    ""
  );
}

function getRowFocusAstId(row) {
  return (
    row?.astId ||
    row?.ast?.id ||
    row?.ast?.astId ||
    row?.ast?.trnId ||
    row?.backend?.astId ||
    row?.backend?.matchedAstId ||
    row?.backend?.matchedAst?.id ||
    row?.id ||
    ""
  );
}

function getRowPremiseId(row) {
  return (
    row?.premise?.id ||
    row?.premise?.premiseId ||
    row?.ast?.premiseId ||
    row?.backend?.premiseId ||
    ""
  );
}

function getGpsCoordinates(gps) {
  const latitude = Number(gps?.latitude ?? gps?.lat);
  const longitude = Number(gps?.longitude ?? gps?.lng);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
}

function addBaseGeoFenceParams({ params, row, upload, tcId }) {
  const lmPcode = getRowLmPcode(row, upload);
  const wardPcode = getRowWardPcode(row, upload);

  if (lmPcode) params.set("lmPcode", lmPcode);
  if (wardPcode) params.set("wardPcode", wardPcode);
  if (tcId) params.set("tcId", tcId);
}

function addGpsParams({ params, gps }) {
  const coordinates = getGpsCoordinates(gps);

  if (!coordinates) return;

  params.set("focusLat", String(coordinates.latitude));
  params.set("focusLng", String(coordinates.longitude));
}

function buildMeterGeoFenceUrl({ row, upload, tcId }) {
  const params = new URLSearchParams();

  addBaseGeoFenceParams({ params, row, upload, tcId });

  const focusAstId = getRowFocusAstId(row);

  params.set("focusType", "METER");

  if (focusAstId) {
    params.set("focusAstId", focusAstId);
  }

  addGpsParams({
    params,
    gps: row?.ast?.gps,
  });

  params.set("focusLabel", getMeterNo(row));

  return `/operations/geo-fences?${params.toString()}`;
}

function buildPremiseGeoFenceUrl({ row, upload, tcId }) {
  const params = new URLSearchParams();

  addBaseGeoFenceParams({ params, row, upload, tcId });

  const focusPremiseId = getRowPremiseId(row);

  params.set("focusType", "PREMISE");

  if (focusPremiseId) {
    params.set("focusPremiseId", focusPremiseId);
  }

  addGpsParams({
    params,
    gps: row?.premise?.gps,
  });

  params.set("focusLabel", getAddress(row));

  return `/operations/geo-fences?${params.toString()}`;
}

function buildGeofenceGeoFenceUrl({ geofenceRef, row, upload, tcId }) {
  const params = new URLSearchParams();

  addBaseGeoFenceParams({ params, row, upload, tcId });

  const geofenceId = getGeofenceId(geofenceRef);
  const geofenceName = getGeofenceName(geofenceRef);

  params.set("focusType", "GEOFENCE");
  params.set("fitGeofence", "true");

  if (geofenceId) {
    params.set("focusGeofenceId", geofenceId);
  }

  if (geofenceName) {
    params.set("focusGeofenceName", geofenceName);
    params.set("focusLabel", geofenceName);
  }

  return `/operations/geo-fences?${params.toString()}`;
}

function hasBgoBatchId(row) {
  return hasMeaningfulValue(row?.bgo?.batchId);
}

function isBgoUsed(row) {
  return row?.bgo?.used === true || hasBgoBatchId(row);
}

function isBgoReady(row) {
  return (
    row?.bgo?.ready === true &&
    row?.bgo?.readinessState === "READY_FOR_BGO" &&
    isBgoUsed(row) !== true
  );
}

function getPrimaryReason(row) {
  const reasonCodes = asArray(row?.backend?.reasonCodes);

  if (isBgoUsed(row)) return "USED_BY_BGO";
  if (isBgoReady(row)) return "READY_FOR_BGO";
  if (row?.backend?.notFound === true || row?.backend?.matched === false) {
    return "NOT_FOUND";
  }
  if (row?.backend?.notEligible === true || row?.backend?.eligible === false) {
    return "NOT_ELIGIBLE";
  }
  if (row?.backend?.alreadyHasActiveSameOperationTrn === true) {
    return "BLOCKED_ACTIVE_SAME_OPERATION_TRN";
  }
  if (getGeofenceRefs(row).length === 0) return "NEEDS_GEOFENCE";
  if (reasonCodes.length > 0) return reasonCodes[0];

  return valueOrNav(row?.bgo?.readinessState);
}

function buildRowSummary(rows = []) {
  return {
    totalRows: rows.length,
    readyRows: rows.filter(isBgoReady).length,
    usedRows: rows.filter(isBgoUsed).length,
    foundRows: rows.filter((row) => row?.backend?.matched === true).length,
    notFoundRows: rows.filter((row) => row?.backend?.notFound === true).length,
    noGeofenceRows: rows.filter(
      (row) =>
        row?.backend?.matched === true && getGeofenceRefs(row).length === 0,
    ).length,
  };
}

function buildExistingBgoSummaries({
  bgoBatches = [],
  bgoRows = [],
  tcRows = [],
}) {
  if (bgoBatches.length > 0 || bgoRows.length > 0) {
    const grouped = new Map();

    bgoBatches.forEach((batch) => {
      const batchId = valueOrNav(
        batch?.bgoBatchId || batch?.batchId || batch?.id,
      );

      if (!hasMeaningfulValue(batchId)) return;

      const targetType = valueOrNav(batch?.targetType || batch?.target?.type);
      const targetId = valueOrNav(batch?.targetId || batch?.target?.id);
      const targetName = valueOrNav(batch?.targetName || batch?.target?.name);
      const targetText =
        targetType !== "NAv" || targetName !== "NAv"
          ? `${targetType} • ${targetName}`
          : "NAv";

      grouped.set(batchId, {
        source: "bgo_batches",
        batchId,
        geofenceText: valueOrNav(
          batch?.geofenceName || batch?.geofenceRef?.name,
        ),
        targetType,
        targetId,
        targetName,
        targetText,
        rowCount: safeNumber(batch?.summary?.totalRows),
        trnCount: safeNumber(batch?.summary?.totalTrnsCreated),
        workflowState: valueOrNav(batch?.workflowState),
        rows: [],
      });
    });

    bgoRows.forEach((row) => {
      const batchId = valueOrNav(row?.bgoBatchId || row?.batchId);

      if (!hasMeaningfulValue(batchId)) return;

      if (!grouped.has(batchId)) {
        const targetType = valueOrNav(row?.targetType || row?.target?.type);
        const targetId = valueOrNav(row?.targetId || row?.target?.id);
        const targetName = valueOrNav(row?.targetName || row?.target?.name);

        grouped.set(batchId, {
          source: "bgo_rows",
          batchId,
          geofenceText: valueOrNav(row?.geofenceName || row?.geofenceRef?.name),
          targetType,
          targetId,
          targetName,
          targetText:
            targetType !== "NAv" || targetName !== "NAv"
              ? `${targetType} • ${targetName}`
              : valueOrNav(row?.targetName || row?.target?.name || row?.targetType),
          rowCount: 0,
          trnCount: 0,
          workflowState: valueOrNav(row?.workflowState),
          rows: [],
        });
      }

      const item = grouped.get(batchId);
      item.rows.push(row);

      if (item.geofenceText === "NAv") {
        item.geofenceText = valueOrNav(
          row?.geofenceName || row?.geofenceRef?.name,
        );
      }

      if (item.targetText === "NAv") {
        const targetType = valueOrNav(row?.targetType || row?.target?.type);
        const targetId = valueOrNav(row?.targetId || row?.target?.id);
        const targetName = valueOrNav(row?.targetName || row?.target?.name);

        item.targetType = targetType;
        item.targetId = targetId;
        item.targetName = targetName;
        item.targetText =
          targetType !== "NAv" || targetName !== "NAv"
            ? `${targetType} • ${targetName}`
            : "NAv";
      }

      if (item.workflowState === "NAv") {
        item.workflowState = valueOrNav(row?.workflowState);
      }
    });

    return Array.from(grouped.values())
      .map((item) => {
        const trnCountFromRows = item.rows.filter((row) =>
          hasMeaningfulValue(row?.trnId || row?.trn?.id),
        ).length;

        return {
          ...item,
          rowCount: item.rowCount || item.rows.length,
          trnCount: item.trnCount || trnCountFromRows,
          workflowState: item.workflowState || "NAv",
        };
      })
      .sort((left, right) => left.batchId.localeCompare(right.batchId));
  }

  const grouped = new Map();

  tcRows.filter(isBgoUsed).forEach((row) => {
    const batchId = valueOrNav(row?.bgo?.batchId);

    if (!grouped.has(batchId)) {
      grouped.set(batchId, {
        source: "tc_rows.bgo",
        batchId,
        geofenceNames: new Set(),
        targetType: valueOrNav(row?.bgo?.target?.type),
        targetId: valueOrNav(row?.bgo?.target?.id),
        targetName: valueOrNav(row?.bgo?.target?.name),
        targetText:
          hasMeaningfulValue(row?.bgo?.target?.type) ||
          hasMeaningfulValue(row?.bgo?.target?.name)
            ? `${valueOrNav(row?.bgo?.target?.type)} • ${valueOrNav(row?.bgo?.target?.name)}`
            : "NAv",
        workflowState: "TC_ROW_USED / UNKNOWN",
        rows: [],
      });
    }

    const item = grouped.get(batchId);
    item.rows.push(row);

    getGeofenceRefs(row).forEach((ref) => {
      item.geofenceNames.add(getGeofenceName(ref));
    });
  });

  return Array.from(grouped.values())
    .map((item) => ({
      ...item,
      geofenceText:
        Array.from(item.geofenceNames).filter(Boolean).join(", ") || "NAv",
      rowCount: item.rows.length,
      trnCount: item.rows.filter((row) => hasMeaningfulValue(row?.bgo?.trnId))
        .length,
    }))
    .sort((left, right) => left.batchId.localeCompare(right.batchId));
}

function resolveSelectedBgoGeofence(row, selectedGeofencesByRowId) {
  const refs = getGeofenceRefs(row);

  if (refs.length === 0) return null;
  if (refs.length === 1) return refs[0];

  const selectedId = selectedGeofencesByRowId[row.id];

  return refs.find((ref) => getGeofenceId(ref) === selectedId) || null;
}

function buildReadyGeofenceGroups(rows = [], selectedGeofencesByRowId = {}) {
  const grouped = new Map();

  rows.filter(isBgoReady).forEach((row) => {
    const selectedRef = resolveSelectedBgoGeofence(
      row,
      selectedGeofencesByRowId,
    );

    if (!selectedRef) return;

    const geofenceId = getGeofenceId(selectedRef);
    const geofenceName = getGeofenceName(selectedRef);

    if (!grouped.has(geofenceId)) {
      grouped.set(geofenceId, {
        geofenceId,
        geofenceName,
        geofenceRef: selectedRef,
        rows: [],
      });
    }

    grouped.get(geofenceId).rows.push(row);
  });

  return Array.from(grouped.values())
    .map((group) => ({
      ...group,
      rowCount: group.rows.length,
    }))
    .sort((left, right) => left.geofenceName.localeCompare(right.geofenceName));
}

function getRowsRequiringGeofenceChoice(
  rows = [],
  selectedGeofencesByRowId = {},
) {
  return rows.filter((row) => {
    if (!isBgoReady(row)) return false;

    const refs = getGeofenceRefs(row);

    return refs.length > 1 && !selectedGeofencesByRowId[row.id];
  });
}

function getRowsWithMultipleGeofences(rows = []) {
  return rows.filter(
    (row) => isBgoReady(row) && getGeofenceRefs(row).length > 1,
  );
}

function getOperationType(upload = {}) {
  return String(
    upload?.trnType || upload?.trnCode || upload?.operationType || "",
  )
    .trim()
    .toUpperCase();
}

function getTargetOptionSubtitle(target = {}) {
  if (target.type === "TEAM") {
    return `${target.memberCount || 0} member(s) • ${target.serviceProviderCount || 0} SP link(s)`;
  }

  const parentText =
    target.parentServiceProviderName &&
    target.parentServiceProviderName !== "NAv"
      ? `SUBC under ${target.parentServiceProviderName}`
      : "SUBC service provider";

  return `${target.memberCount || 0} member(s) • ${parentText}`;
}

function getTargetOptionMicroText(target = {}) {
  if (target.type === "TEAM") {
    return `Owner: ${target.mncServiceProviderName || "NAv"}`;
  }

  return `SP ID: ${target.id || "NAv"}`;
}

function getUserDisplayName(user = {}) {
  return (
    user.displayName ||
    [user.name, user.surname].filter(Boolean).join(" ") ||
    user.email ||
    user.id ||
    "Unknown user"
  );
}

function getUserRoleLabel(user = {}) {
  const role = valueOrNav(user.role);
  const accountStatus = valueOrNav(user.accountStatus);
  const onboardingStatus = valueOrNav(user.onboardingStatus);

  return `${role} • ${accountStatus} • ${onboardingStatus}`;
}

function buildUsersById(users = []) {
  const map = new Map();

  asArray(users).forEach((user) => {
    if (!user?.id) return;

    map.set(user.id, user);
    if (user.uid) map.set(user.uid, user);
  });

  return map;
}

function buildUnknownMember(userId) {
  return {
    id: userId,
    uid: userId,
    displayName: `Unknown user ${userId}`,
    name: "Unknown",
    surname: "",
    email: "",
    role: "NAv",
    accountStatus: "NAv",
    onboardingStatus: "NAv",
    serviceProviderId: "NAv",
    serviceProviderName: "NAv",
    missing: true,
  };
}

function enrichTeamsWithMembers(teams = [], usersById = new Map()) {
  return asArray(teams).map((team) => {
    const memberUserIds = asArray(team.memberUserIds)
      .map((id) => String(id || "").trim())
      .filter(Boolean);

    const members = memberUserIds.map((userId) => {
      const user = usersById.get(userId) || buildUnknownMember(userId);

      return {
        ...user,
        id: user.id || userId,
        uid: user.uid || userId,
        displayName: getUserDisplayName(user),
      };
    });

    return {
      ...team,
      members,
      memberCount: members.length,
      memberNames: members.map(getUserDisplayName),
    };
  });
}

function enrichServiceProvidersWithMembers(serviceProviders = [], users = []) {
  return asArray(serviceProviders).map((serviceProvider) => {
    const members = asArray(users)
      .filter((user) => user.serviceProviderId === serviceProvider.id)
      .sort((left, right) =>
        getUserDisplayName(left).localeCompare(getUserDisplayName(right)),
      );

    return {
      ...serviceProvider,
      members,
      memberCount: members.length,
      memberNames: members.map(getUserDisplayName),
    };
  });
}

function getTargetMembers(target = {}) {
  return asArray(target.members);
}

function getTargetMembersPreviewText(target = {}) {
  const members = getTargetMembers(target);

  if (members.length === 0) {
    return target.type === "TEAM"
      ? "No team members found in user directory."
      : "No SP members found in user directory.";
  }

  const previewNames = members.slice(0, 4).map(getUserDisplayName);
  const hiddenCount = Math.max(members.length - previewNames.length, 0);

  return `${previewNames.join(", ")}${hiddenCount > 0 ? ` +${hiddenCount} more` : ""}`;
}

function MembersList({ target, maxItems = 6 }) {
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

function readFirstString(...values) {
  for (const value of values) {
    const clean = String(value || "").trim();
    if (clean) return clean;
  }

  return "";
}

function normalizeAuthorityText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function resolveBgoCreateUiAuthority(authContext = {}) {
  const profile =
    authContext?.profile ||
    authContext?.userProfile ||
    authContext?.currentUserProfile ||
    authContext?.user?.profile ||
    authContext?.user ||
    {};

  const role = normalizeAuthorityText(
    readFirstString(
      authContext?.role,
      authContext?.userRole,
      authContext?.employmentRole,
      profile?.employment?.role,
      profile?.role,
      profile?.userRole,
    ),
  );

  const relationshipType = normalizeAuthorityText(
    readFirstString(
      authContext?.serviceProviderRelationshipType,
      authContext?.relationshipType,
      authContext?.spRelationshipType,
      authContext?.employmentServiceProviderRelationshipType,
      profile?.employment?.serviceProvider?.relationshipType,
      profile?.employment?.serviceProvider?.clientRelationshipType,
      profile?.employment?.serviceProvider?.relationship,
      profile?.serviceProvider?.relationshipType,
    ),
  );

  const clientType = normalizeAuthorityText(
    readFirstString(
      authContext?.serviceProviderClientType,
      authContext?.clientType,
      authContext?.spClientType,
      profile?.employment?.serviceProvider?.clientType,
      profile?.serviceProvider?.clientType,
    ),
  );

  const classification = normalizeAuthorityText(
    readFirstString(
      authContext?.serviceProviderClassification,
      authContext?.spClassification,
      profile?.employment?.serviceProvider?.classification,
      profile?.employment?.serviceProvider?.profile?.classification,
      profile?.serviceProvider?.classification,
    ),
  );

  const isMnc =
    authContext?.isMNC === true ||
    authContext?.isMnc === true ||
    authContext?.isSPVMNC === true ||
    relationshipType === "MNC" ||
    clientType === "MNC" ||
    classification === "MNC";

  const isMng = authContext?.isMNG === true || role === "MNG";
  const isSpv = authContext?.isSPV === true || role === "SPV";
  const isMncSpv = isSpv && isMnc;

  return {
    ok: isMng || isMncSpv,
    label: isMng ? "MNG" : isMncSpv ? "SPV(MNC)" : role || "UNKNOWN",
    message: "Create BGO is only available to MNG or SPV(MNC).",
  };
}

function buildTargetPayload(target = null) {
  if (!target || typeof target !== "object") return null;

  const type = String(target.type || "")
    .trim()
    .toUpperCase();
  const id = String(target.id || "").trim();
  const name = String(target.name || target.displayName || id || "").trim();

  if (!["TEAM", "SP"].includes(type) || !id) return null;

  return {
    type,
    id,
    name: name || id,
    memberCount: safeNumber(target.memberCount),
    members: asArray(target.members),
  };
}

function getTargetLabel(target = {}) {
  if (!target?.type || !target?.id) return "NAv";

  return `${target.type} • ${target.name || target.id}`;
}

function buildFutureBgoBatchId(tcId, index) {
  return `${tcId}_BGO_GF${String(index + 1).padStart(3, "0")}`;
}

function buildDisplayBgoBatchId({ tcId, batchId, index }) {
  const cleanBatchId = String(batchId || "").trim();

  if (cleanBatchId.startsWith(`${tcId}_BGO_GF`)) {
    return cleanBatchId;
  }

  return buildFutureBgoBatchId(tcId, index);
}

function normalizeTargetType(value) {
  return String(value || "").trim().toUpperCase();
}

function getAllocationTargetRoute(row = {}) {
  const targetType = normalizeTargetType(row.targetType);
  const targetId = String(row.targetId || "").trim();

  if (!targetId || targetId === "NAv") return "";

  if (targetType === "TEAM") {
    return `/operations/teams?teamId=${encodeURIComponent(targetId)}`;
  }

  if (targetType === "SP") {
    return `/operations/service-providers?serviceProviderId=${encodeURIComponent(
      targetId,
    )}`;
  }

  return "";
}

function AllocationTargetPill({ row }) {
  const targetText = valueOrNav(row?.targetText);
  const targetType = normalizeTargetType(row?.targetType);
  const route = getAllocationTargetRoute(row);

  if (targetText === "NAv") {
    return <span style={styles.allocationTargetEmpty}>NAv</span>;
  }

  const pillStyle = {
    ...styles.allocationTargetPill,
    ...(targetType === "TEAM" ? styles.allocationTargetPillTeam : null),
    ...(targetType === "SP" ? styles.allocationTargetPillSp : null),
  };

  if (!route) {
    return <span style={pillStyle}>{targetText}</span>;
  }

  return (
    <Link
      to={route}
      style={pillStyle}
      title={`${targetText} page will open when the target page is available`}
    >
      {targetText}
    </Link>
  );
}

function AllocationCell({ row }) {
  return (
    <div style={styles.allocationCell}>
      <Badge tone={row.allocation === "NOT_ALLOCATED" ? "warning" : "success"}>
        {row.allocation}
      </Badge>
      <AllocationTargetPill row={row} />
    </div>
  );
}

function getAllocatedTargetForGroup(group = {}, allocationsByGeofenceId = {}) {
  return allocationsByGeofenceId[group.geofenceId] || null;
}

function buildAllocatedReadyGroups(
  readyGroups = [],
  allocationsByGeofenceId = {},
) {
  return readyGroups
    .map((group) => ({
      ...group,
      allocationTarget: getAllocatedTargetForGroup(
        group,
        allocationsByGeofenceId,
      ),
    }))
    .filter((group) => Boolean(group.allocationTarget?.id));
}

function buildAllocationReviewRows({
  tcId,
  readyGroups = [],
  allocationsByGeofenceId = {},
  existingBgoSummaries = [],
}) {
  const existingRows = asArray(existingBgoSummaries).map((batch, index) => ({
    id: `existing-${batch.batchId}`,
    sortName: valueOrNav(batch.geofenceText),
    batchId: buildDisplayBgoBatchId({
      tcId,
      batchId: batch.batchId,
      index,
    }),
    actualBatchId: valueOrNav(batch.batchId),
    tcId,
    geofenceName: valueOrNav(batch.geofenceText),
    rowCount: safeNumber(batch.rowCount),
    trnCount: safeNumber(batch.trnCount),
    allocation: "ALLOCATED",
    targetType: valueOrNav(batch.targetType),
    targetId: valueOrNav(batch.targetId),
    targetName: valueOrNav(batch.targetName),
    targetText: valueOrNav(batch.targetText),
    status: valueOrNav(batch.workflowState) || "BGO_CREATED",
    tone: "success",
    source: valueOrNav(batch.source),
  }));

  const futureRows = asArray(readyGroups).map((group, index) => {
    const assignedTarget = getAllocatedTargetForGroup(
      group,
      allocationsByGeofenceId,
    );
    const assigned = Boolean(assignedTarget?.id);

    return {
      id: `future-${group.geofenceId}`,
      sortName: valueOrNav(group.geofenceName),
      batchId: group.bgoBatchId || buildFutureBgoBatchId(tcId, index),
      tcId,
      geofenceName: valueOrNav(group.geofenceName),
      rowCount: safeNumber(group.rowCount),
      trnCount: 0,
      allocation: assigned ? "ASSIGNED_NOT_CREATED" : "NOT_ALLOCATED",
      targetType: assigned ? valueOrNav(assignedTarget.type) : "NAv",
      targetId: assigned ? valueOrNav(assignedTarget.id) : "NAv",
      targetName: assigned ? valueOrNav(assignedTarget.name) : "NAv",
      targetText: assigned ? getTargetLabel(assignedTarget) : "NAv",
      status: assigned ? "READY_TO_CREATE" : "WAITING_FOR_TARGET",
      tone: assigned ? "success" : "warning",
      source: "ready_tc_rows",
    };
  });

  return [...existingRows, ...futureRows].sort((left, right) =>
    left.sortName.localeCompare(right.sortName),
  );
}

function buildCreateBgoPayload({ tcId, upload, allocatedGroups }) {
  return {
    tcId,
    trnType: getOperationType(upload),
    allocations: allocatedGroups.map((group) => ({
      bgoBatchId: group.bgoBatchId,
      geofenceId: group.geofenceId,
      geofenceName: group.geofenceName,
      targetType: group.allocationTarget.type,
      targetId: group.allocationTarget.id,
      targetName: group.allocationTarget.name,
      tcRowIds: group.rows.map((row) => row.id).filter(Boolean),
    })),
  };
}

function canDeleteAllocationRow(row = {}, authority = {}) {
  return (
    authority?.ok === true &&
    row?.allocation === "ALLOCATED" &&
    String(row?.status || "").trim().toUpperCase() === "ISSUED" &&
    hasMeaningfulValue(row?.actualBatchId || row?.batchId)
  );
}

function buildDeleteBgoPayload(row = {}) {
  return {
    bgoBatchId: row.actualBatchId || row.batchId,
    displayBatchId: row.batchId,
    tcId: row.tcId,
  };
}

export default function TcBgoPage() {
  const { tcId } = useParams();
  const authContext = useAuth();

  const [selectedGeofencesByRowId, setSelectedGeofencesByRowId] = useState({});
  const [selectedGeofenceGroupId, setSelectedGeofenceGroupId] = useState(null);
  const [targetType, setTargetType] = useState("TEAM");
  const [targetId, setTargetId] = useState("");
  const [targetName, setTargetName] = useState("");
  const [allocationsByGeofenceId, setAllocationsByGeofenceId] = useState({});
  const [dragTarget, setDragTarget] = useState(null);
  const [dragOverGeofenceGroupId, setDragOverGeofenceGroupId] = useState(null);
  const [createResult, setCreateResult] = useState(null);
  const [isCreateConfirmOpen, setIsCreateConfirmOpen] = useState(false);
  const [isCreateFeedbackOpen, setIsCreateFeedbackOpen] = useState(false);
  const [deleteResult, setDeleteResult] = useState(null);
  const [deleteTargetRow, setDeleteTargetRow] = useState(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

  const {
    data: upload,
    isLoading: isUploadLoading,
    isError: isUploadError,
    error: uploadError,
  } = useGetTcUploadByIdQuery(tcId);

  const {
    data: rows = [],
    isLoading: areRowsLoading,
    isError: areRowsError,
    error: rowsError,
  } = useGetTcRowsByTcIdQuery(tcId);

  const {
    data: bgoBatches = [],
    isLoading: areBgoBatchesLoading,
    isError: areBgoBatchesError,
    error: bgoBatchesError,
  } = useGetBgoBatchesByTcIdQuery({ tcId, limit: 300 }, { skip: !tcId });

  const {
    data: bgoRows = [],
    isLoading: areBgoRowsLoading,
    isError: areBgoRowsError,
    error: bgoRowsError,
  } = useGetBgoRowsByTcIdQuery({ tcId, limit: 1000 }, { skip: !tcId });

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

  const [createBgo, createBgoState] = useCreateBgoMutation();
  const [deleteUnacceptedBgo, deleteBgoState] =
    useDeleteUnacceptedBgoMutation();

  const summary = useMemo(() => buildRowSummary(rows), [rows]);

  const existingBgoSummaries = useMemo(
    () =>
      buildExistingBgoSummaries({
        bgoBatches,
        bgoRows,
        tcRows: rows,
      }),
    [bgoBatches, bgoRows, rows],
  );

  const readyGroups = useMemo(
    () =>
      buildReadyGeofenceGroups(rows, selectedGeofencesByRowId).map(
        (group, index) => ({
          ...group,
          bgoBatchId: buildFutureBgoBatchId(tcId, index),
        }),
      ),
    [tcId, rows, selectedGeofencesByRowId],
  );

  const allocationReviewRows = useMemo(
    () =>
      buildAllocationReviewRows({
        tcId,
        readyGroups,
        allocationsByGeofenceId,
        existingBgoSummaries,
      }),
    [tcId, readyGroups, allocationsByGeofenceId, existingBgoSummaries],
  );

  const rowsRequiringChoice = useMemo(
    () => getRowsRequiringGeofenceChoice(rows, selectedGeofencesByRowId),
    [rows, selectedGeofencesByRowId],
  );

  const rowsWithMultipleGeofences = useMemo(
    () => getRowsWithMultipleGeofences(rows),
    [rows],
  );

  const selectedGroup =
    readyGroups.find((group) => group.geofenceId === selectedGeofenceGroupId) ||
    readyGroups[0] ||
    null;

  const operationType = getOperationType(upload);
  const bgoCreateAuthority = resolveBgoCreateUiAuthority(authContext);
  const cleanTargetId = String(targetId || "").trim();
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
    targetOptions.find((item) => item.id === cleanTargetId) || null;

  const allocatedReadyGroups = useMemo(
    () => buildAllocatedReadyGroups(readyGroups, allocationsByGeofenceId),
    [readyGroups, allocationsByGeofenceId],
  );

  const unallocatedReadyGroupCount = Math.max(
    readyGroups.length - allocatedReadyGroups.length,
    0,
  );

  const allocatedRowCount = useMemo(
    () =>
      allocatedReadyGroups.reduce((sum, group) => sum + group.rows.length, 0),
    [allocatedReadyGroups],
  );

  const selectedTargetPayload = useMemo(
    () => buildTargetPayload(selectedTargetOption),
    [selectedTargetOption],
  );

  const canCreateBgo =
    bgoCreateAuthority.ok &&
    allocatedReadyGroups.length > 0 &&
    rowsRequiringChoice.length === 0 &&
    hasMeaningfulValue(operationType) &&
    !createBgoState.isLoading;

  const createDisabledReason = !bgoCreateAuthority.ok
    ? `${bgoCreateAuthority.message} Current authority resolved as ${bgoCreateAuthority.label}.`
    : readyGroups.length === 0
      ? "No READY_FOR_BGO geofence groups available."
      : rowsRequiringChoice.length > 0
        ? "Choose a BGO geofence for every multi-geofence row before assigning targets."
        : allocatedReadyGroups.length === 0
          ? "Assign a TEAM or SP to at least one geofence group before creating BGO."
          : !hasMeaningfulValue(operationType)
            ? "TC upload operation type is missing."
            : createBgoState.isLoading
              ? "Creating BGO..."
              : `Ready to create ${allocatedReadyGroups.length} assigned BGO batch(es).`;

  const createPayloadPreview = useMemo(
    () =>
      buildCreateBgoPayload({
        tcId,
        upload,
        allocatedGroups: allocatedReadyGroups,
      }),
    [tcId, upload, allocatedReadyGroups],
  );

  const isLoading =
    isUploadLoading ||
    areRowsLoading ||
    areBgoBatchesLoading ||
    areBgoRowsLoading ||
    areTeamsLoading ||
    areServiceProvidersLoading ||
    areUsersLoading;
  const isError =
    isUploadError ||
    areRowsError ||
    areBgoBatchesError ||
    areBgoRowsError ||
    areTeamsError ||
    areServiceProvidersError ||
    areUsersError;
  const errorMessage =
    uploadError?.message ||
    rowsError?.message ||
    bgoBatchesError?.message ||
    bgoRowsError?.message ||
    teamsError?.message ||
    serviceProvidersError?.message ||
    usersError?.message ||
    uploadError?.data?.message ||
    rowsError?.data?.message ||
    bgoBatchesError?.data?.message ||
    bgoRowsError?.data?.message ||
    teamsError?.data?.message ||
    serviceProvidersError?.data?.message ||
    usersError?.data?.message ||
    "Failed to load BGO context.";

  function selectRowGeofence(rowId, geofenceId) {
    setSelectedGeofencesByRowId((current) => ({
      ...current,
      [rowId]: geofenceId,
    }));
  }

  function handleTargetTypeChange(nextType) {
    setTargetType(nextType);
    setTargetId("");
    setTargetName("");
  }

  function handleSelectTarget(target) {
    setTargetType(target.type);
    setTargetId(target.id);
    setTargetName(target.name);
  }

  function assignTargetToGeofenceGroup(group, target = selectedTargetPayload) {
    const cleanTarget = buildTargetPayload(target);

    if (!group?.geofenceId || !cleanTarget) return;

    setSelectedGeofenceGroupId(group.geofenceId);
    setAllocationsByGeofenceId((current) => ({
      ...current,
      [group.geofenceId]: cleanTarget,
    }));
  }

  function clearTargetFromGeofenceGroup(geofenceId) {
    setAllocationsByGeofenceId((current) => {
      const next = { ...current };
      delete next[geofenceId];
      return next;
    });
  }

  function handleTargetDragStart(event, target) {
    const cleanTarget = buildTargetPayload(target);

    if (!cleanTarget) return;

    setDragTarget(cleanTarget);

    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/json", JSON.stringify(cleanTarget));
    event.dataTransfer.setData("text/plain", getTargetLabel(cleanTarget));
  }

  function handleTargetDragEnd() {
    setDragTarget(null);
    setDragOverGeofenceGroupId(null);
  }

  function readDroppedTarget(event) {
    const jsonPayload = event.dataTransfer.getData("application/json");

    if (jsonPayload) {
      try {
        return buildTargetPayload(JSON.parse(jsonPayload));
      } catch (error) {
        console.warn("Could not parse dropped BGO target", error);
      }
    }

    return buildTargetPayload(dragTarget || selectedTargetPayload);
  }

  function handleDropTargetOnGroup(event, group) {
    event.preventDefault();
    setDragOverGeofenceGroupId(null);

    const droppedTarget = readDroppedTarget(event);

    if (!droppedTarget) return;

    assignTargetToGeofenceGroup(group, droppedTarget);
    setDragTarget(null);
  }

  function handleTargetDragEnter(event, group) {
    event.preventDefault();

    if (!group?.geofenceId) return;

    const hasDragPayload = Boolean(dragTarget || selectedTargetPayload);

    if (!hasDragPayload) return;

    event.dataTransfer.dropEffect = "copy";
    setDragOverGeofenceGroupId(group.geofenceId);
  }

  function handleTargetDragLeave(event, group) {
    if (!group?.geofenceId) return;

    const nextElement = event.relatedTarget;

    if (nextElement && event.currentTarget?.contains(nextElement)) {
      return;
    }

    setDragOverGeofenceGroupId((currentId) =>
      currentId === group.geofenceId ? null : currentId,
    );
  }

  function handleAllowTargetDrop(event, group) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";

    if (group?.geofenceId && dragOverGeofenceGroupId !== group.geofenceId) {
      setDragOverGeofenceGroupId(group.geofenceId);
    }
  }

  function handleCreateBgo() {
    setCreateResult(null);

    if (!canCreateBgo) {
      setCreateResult({
        success: false,
        message: createDisabledReason,
      });
      return;
    }

    setIsCreateConfirmOpen(true);
  }

  function handleCancelCreateBgo() {
    if (createBgoState.isLoading) return;
    setIsCreateConfirmOpen(false);
  }

  async function handleConfirmCreateBgo() {
    setCreateResult(null);

    if (!canCreateBgo) {
      setCreateResult({
        success: false,
        message: createDisabledReason,
      });
      setIsCreateConfirmOpen(false);
      return;
    }

    try {
      const result = await createBgo(createPayloadPreview).unwrap();
      setCreateResult(result);
      setIsCreateConfirmOpen(false);
      setIsCreateFeedbackOpen(true);
    } catch (error) {
      setCreateResult({
        success: false,
        code: error?.status || error?.data?.code || "BGO_CREATE_FAILED",
        message:
          error?.data?.message || error?.message || "Failed to create BGO.",
        raw: error,
      });
      setIsCreateFeedbackOpen(true);
    }
  }

  function handleCloseCreateFeedback() {
    setIsCreateFeedbackOpen(false);
  }

  function handleOpenDeleteBgo(row) {
    setDeleteResult(null);

    if (!canDeleteAllocationRow(row, bgoCreateAuthority)) {
      setDeleteResult({
        success: false,
        message:
          "Delete BGO is only available for ISSUED BGO batches before acceptance/release.",
      });
      return;
    }

    setDeleteTargetRow(row);
    setIsDeleteConfirmOpen(true);
  }

  function handleCancelDeleteBgo() {
    if (deleteBgoState.isLoading) return;

    setIsDeleteConfirmOpen(false);
    setDeleteTargetRow(null);
  }

  async function handleConfirmDeleteBgo() {
    if (!deleteTargetRow || deleteBgoState.isLoading) return;

    try {
      const result = await deleteUnacceptedBgo(
        buildDeleteBgoPayload(deleteTargetRow),
      ).unwrap();

      setDeleteResult(result);
      setIsDeleteConfirmOpen(false);
      setDeleteTargetRow(null);
    } catch (error) {
      setDeleteResult({
        success: false,
        code: error?.status || error?.data?.code || "BGO_DELETE_FAILED",
        message:
          error?.data?.message ||
          error?.message ||
          "Failed to delete unaccepted BGO.",
        raw: error,
      });
    }
  }

  return (
    <section style={styles.page}>
      <div style={styles.backRow}>
        <Link to={`/operations/tc-uploads/${tcId}`} style={styles.backLink}>
          ← Back to TC Rows
        </Link>

        <Link
          to={`/operations/tc-uploads/${tcId}/final-report`}
          style={styles.backLink}
        >
          Final Report ({getReportStatus(upload)})
        </Link>
      </div>

      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Operations / TC Details / BGO</p>
          <h2 style={styles.title}>Bulk Geofence Origin</h2>
          <p style={styles.subtitle}>
            BGO starts from reviewed TC rows only. This page groups clean
            READY_FOR_BGO rows by geofence before TEAM/SP allocation and later
            child TRN creation.
          </p>
        </div>

        <Badge tone="success">CREATE CALLABLE READY</Badge>
      </div>

      {isLoading ? (
        <div style={styles.notice}>Loading BGO context...</div>
      ) : null}

      {isError ? <div style={styles.errorNotice}>{errorMessage}</div> : null}

      <div style={styles.summaryPanel}>
        <div style={styles.summaryMetaColumn}>
          <SummaryDetailRow label="TC ID" value={tcId} />
          <SummaryDetailRow label="File" value={valueOrNav(upload?.fileName)} />
          <SummaryDetailRow label="TRN Type" value={valueOrNav(upload?.trnType)} />
        </div>

        <div style={styles.summaryMetricGrid}>
          <InfoCard label="LM" value={valueOrNav(upload?.lmPcode)} />
          <InfoCard label="Ready Rows" value={summary.readyRows} />
          <InfoCard label="Used Rows" value={summary.usedRows} />
          <InfoCard label="BGO Batches" value={bgoBatches.length} />
          <InfoCard label="BGO Rows" value={bgoRows.length} />
        </div>
      </div>

      <div style={styles.infoBanner}>
        <strong>BGO allocation board:</strong> select or drag a TEAM/SP target
        onto each geofence group you want to allocate. The Allocation Review
        table is the single BGO truth table for allocated, assigned, and waiting
        geofence groups.
      </div>

      {rowsWithMultipleGeofences.length > 0 ? (
        <section style={styles.panel}>
          <div style={styles.panelHeader}>
            <div>
              <h3 style={styles.panelTitle}>
                Rows Requiring BGO Geofence Choice
              </h3>
              <p style={styles.panelSubtitle}>
                These rows have more than one geofenceRef. MNG must choose which
                geofence should drive BGO grouping.
              </p>
            </div>

            <Badge
              tone={rowsRequiringChoice.length > 0 ? "warning" : "success"}
            >
              {rowsRequiringChoice.length} pending
            </Badge>
          </div>

          <div style={styles.choiceList}>
            {rowsWithMultipleGeofences.map((row) => {
              const refs = getGeofenceRefs(row);
              const selectedId = selectedGeofencesByRowId[row.id] || "";

              return (
                <div key={row.id} style={styles.choiceCard}>
                  <div>
                    <strong style={styles.choiceTitle}>
                      Row {row.rowNo} • {getMeterNo(row)}
                    </strong>
                    <p style={styles.choiceSub}>
                      {getAddress(row)} • ERF {getErfNo(row)}
                    </p>
                  </div>

                  <select
                    style={styles.select}
                    value={selectedId}
                    onChange={(event) =>
                      selectRowGeofence(row.id, event.target.value)
                    }
                  >
                    <option value="">Select BGO geofence</option>
                    {refs.map((ref) => {
                      const geofenceId = getGeofenceId(ref);

                      return (
                        <option key={geofenceId} value={geofenceId}>
                          {getGeofenceName(ref)}
                        </option>
                      );
                    })}
                  </select>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section style={styles.boardGrid}>
        <div style={styles.leftColumn}>
          <section style={styles.panel}>
            <div style={styles.panelHeader}>
              <div>
                <h3 style={styles.panelTitle}>BGO Target Setup</h3>
                <p style={styles.panelSubtitle}>
                  Select or drag an available TEAM or SUBC SP. Drop it onto the
                  geofence group you want to allocate. BGO remains collective
                  work, so individual USER targeting stays outside this flow.
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
                  ...(targetType === "TEAM" ? styles.targetToggleActive : null),
                }}
                onClick={() => handleTargetTypeChange("TEAM")}
              >
                TEAM
              </button>

              <button
                type="button"
                style={{
                  ...styles.targetToggleButton,
                  ...(targetType === "SP" ? styles.targetToggleActive : null),
                }}
                onClick={() => handleTargetTypeChange("SP")}
              >
                SP
              </button>
            </div>

            {targetOptions.length === 0 ? (
              <div style={styles.emptyState}>
                No active{" "}
                {targetType === "TEAM" ? "teams" : "SUBC service providers"}
                found yet.
              </div>
            ) : (
              <div style={styles.targetOptionList}>
                {targetOptions.map((target) => {
                  const selected = target.id === cleanTargetId;

                  return (
                    <button
                      key={`${target.type}_${target.id}`}
                      type="button"
                      draggable
                      style={{
                        ...styles.targetOptionCard,
                        ...(selected ? styles.targetOptionCardActive : null),
                      }}
                      onClick={() => handleSelectTarget(target)}
                      onDragStart={(event) =>
                        handleTargetDragStart(event, target)
                      }
                      onDragEnd={handleTargetDragEnd}
                      title={`Select or drag ${target.type} ${target.name} onto a geofence group`}
                    >
                      <div style={styles.targetOptionHeader}>
                        <span style={styles.targetType}>{target.type}</span>
                        <strong style={styles.targetTitle}>{target.name}</strong>
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
              <h3 style={styles.panelTitle}>Ready Geofence Groups</h3>
              <p style={styles.panelSubtitle}>
                One BGO batch will be created per selected geofence allocation.
              </p>
            </div>

            <Badge tone={readyGroups.length > 0 ? "success" : "neutral"}>
              {readyGroups.length} group(s)
            </Badge>
          </div>

          {readyGroups.length === 0 ? (
            <div style={styles.emptyState}>
              No ready geofence groups yet. Confirm rows are READY_FOR_BGO and
              choose a geofence for rows with multiple geofenceRefs.
            </div>
          ) : (
            <div style={styles.groupList}>
              {readyGroups.map((group) => {
                const active = selectedGroup?.geofenceId === group.geofenceId;
                const assignedTarget = getAllocatedTargetForGroup(
                  group,
                  allocationsByGeofenceId,
                );
                const hasAssignedTarget = Boolean(assignedTarget?.id);
                const isDragFocused =
                  dragOverGeofenceGroupId === group.geofenceId;

                return (
                  <div
                    key={group.geofenceId}
                    style={{
                      ...styles.groupCard,
                      ...(active ? styles.groupCardActive : null),
                      ...(hasAssignedTarget ? styles.groupCardAllocated : null),
                      ...(isDragFocused ? styles.groupCardDragFocused : null),
                    }}
                    onDragEnter={(event) => handleTargetDragEnter(event, group)}
                    onDragLeave={(event) => handleTargetDragLeave(event, group)}
                    onDragOver={(event) => handleAllowTargetDrop(event, group)}
                    onDrop={(event) => handleDropTargetOnGroup(event, group)}
                  >
                    <div style={styles.groupMain}>
                      <button
                        type="button"
                        style={styles.groupSelectButton}
                        onClick={() =>
                          setSelectedGeofenceGroupId(group.geofenceId)
                        }
                        title="Select this geofence group and preview its rows"
                      >
                        <span style={styles.groupName}>
                          {group.geofenceName}
                        </span>
                        <span style={styles.groupMeta}>
                          {group.rowCount} ready row(s)
                        </span>
                      </button>

                      <div
                        style={{
                          ...styles.groupAllocationBox,
                          ...(hasAssignedTarget
                            ? styles.groupAllocationBoxAssigned
                            : null),
                          ...(isDragFocused
                            ? styles.groupAllocationBoxDragFocused
                            : null),
                        }}
                      >
                        <span style={styles.groupAllocationLabel}>
                          Assigned target
                        </span>
                        <strong style={styles.groupAllocationTarget}>
                          {hasAssignedTarget
                            ? getTargetLabel(assignedTarget)
                            : "No TEAM/SP assigned"}
                        </strong>
                        {hasAssignedTarget ? (
                          <span style={styles.groupAllocationMembers}>
                            {assignedTarget.memberCount || 0} member(s)
                          </span>
                        ) : (
                          <span style={styles.groupAllocationMembers}>
                            {isDragFocused
                              ? "Release to assign this TEAM/SP here."
                              : "Drop a TEAM/SP here."}
                          </span>
                        )}
                      </div>
                    </div>

                    <div style={styles.groupActions}>
                      {hasAssignedTarget ? (
                        <button
                          type="button"
                          style={styles.clearAssignmentButton}
                          onClick={() =>
                            clearTargetFromGeofenceGroup(group.geofenceId)
                          }
                        >
                          Clear
                        </button>
                      ) : null}

                      <Link
                        to={buildGeofenceGeoFenceUrl({
                          geofenceRef: group.geofenceRef,
                          row: group.rows[0],
                          upload,
                          tcId,
                        })}
                        style={styles.groupMapLink}
                        title="Open this geofence on the Geo-Fences map"
                      >
                        Open map
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </section>

      <section style={styles.panel}>
        <div style={styles.panelHeader}>
          <div>
            <h3 style={styles.panelTitle}>Allocation Review</h3>
            <p style={styles.panelSubtitle}>
              This table stays visible before and after creation. It shows all
              ready geofence groups plus BGO batches already allocated from this
              TC upload.
            </p>
          </div>

          <button
            type="button"
            style={{
              ...styles.createButton,
              ...(canCreateBgo ? styles.createButtonEnabled : null),
            }}
            disabled={!canCreateBgo}
            onClick={handleCreateBgo}
            title={createDisabledReason}
          >
            {createBgoState.isLoading ? "Creating BGO..." : "Create BGO"}
          </button>
        </div>

        {allocationReviewRows.length === 0 ? (
          <div style={styles.emptyState}>No allocation rows available yet.</div>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <Th>BGO Batch</Th>
                  <Th>Geofence</Th>
                  <Th>Rows</Th>
                  <Th>Allocation</Th>
                  <Th>Status</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>

              <tbody>
                {allocationReviewRows.map((row) => (
                  <tr key={row.id}>
                    <Td strong>
                      <span title={row.actualBatchId || row.batchId}>
                        {row.batchId}
                      </span>
                    </Td>
                    <Td>{row.geofenceName}</Td>
                    <Td>{row.rowCount}</Td>
                    <Td>
                      <AllocationCell row={row} />
                    </Td>
                    <Td>
                      <Badge tone={row.tone}>{row.status}</Badge>
                    </Td>
                    <Td>
                      {row.allocation === "ALLOCATED" ? (
                        <div style={styles.actionRow}>
                          <button
                            type="button"
                            style={styles.actionButton}
                            disabled
                            title="Dashboard opens in the BGO Dashboard step."
                          >
                            Open Dashboard
                          </button>
                          <button
                            type="button"
                            style={{
                              ...styles.deleteButton,
                              ...(canDeleteAllocationRow(row, bgoCreateAuthority)
                                ? styles.deleteButtonEnabled
                                : null),
                            }}
                            disabled={
                              !canDeleteAllocationRow(row, bgoCreateAuthority) ||
                              deleteBgoState.isLoading
                            }
                            onClick={() => handleOpenDeleteBgo(row)}
                            title={
                              canDeleteAllocationRow(row, bgoCreateAuthority)
                                ? "Delete this unaccepted BGO batch"
                                : "Delete is available only while the BGO batch is ISSUED and unaccepted."
                            }
                          >
                            {deleteBgoState.isLoading ? "Deleting..." : "Delete BGO"}
                          </button>
                        </div>
                      ) : (
                        <span style={styles.actionMuted}>NAv</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p style={styles.microNote}>
          {createDisabledReason}
          {unallocatedReadyGroupCount > 0
            ? ` ${unallocatedReadyGroupCount} ready geofence group(s) are still unassigned and will not be created yet.`
            : ""}
        </p>

        {createResult && !isCreateFeedbackOpen ? (
          <p style={styles.microNote}>
            Last BGO create result:{" "}
            {createResult.success === false ? "FAILED" : "CREATED"}.
          </p>
        ) : null}

        {deleteResult ? (
          <p
            style={
              deleteResult.success === false
                ? styles.deleteResultError
                : styles.deleteResultSuccess
            }
          >
            {deleteResult.success === false
              ? `Delete failed: ${
                  deleteResult.message || deleteResult.code || "NAv"
                }`
              : `BGO deleted: ${
                  deleteResult.message || deleteResult.code || "SUCCESS"
                }`}
          </p>
        ) : null}
      </section>

      {selectedGroup ? (
        <section style={styles.panel}>
          <div style={styles.panelHeader}>
            <div>
              <h3 style={styles.panelTitle}>
                Preview Rows for {selectedGroup.geofenceName}
              </h3>
              <p style={styles.panelSubtitle}>
                This previews rows that would become bgo_rows under this
                geofence batch. Assigned target:{" "}
                {getTargetLabel(
                  getAllocatedTargetForGroup(
                    selectedGroup,
                    allocationsByGeofenceId,
                  ),
                )}
                . Click meter or premise to open the Geo-Fences map.
              </p>
            </div>

            <Badge tone="success">{selectedGroup.rowCount} row(s)</Badge>
          </div>

          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <Th>Row</Th>
                  <Th>Meter</Th>
                  <Th>Address</Th>
                  <Th>ERF</Th>
                  <Th>Reason</Th>
                </tr>
              </thead>

              <tbody>
                {selectedGroup.rows.slice(0, 15).map((row) => (
                  <tr key={row.id}>
                    <Td strong>{row.rowNo}</Td>
                    <Td strong>
                      <Link
                        to={buildMeterGeoFenceUrl({ row, upload, tcId })}
                        style={styles.mapCellLink}
                        title="Open this meter on the Geo-Fences map"
                      >
                        {getMeterNo(row)}
                      </Link>
                    </Td>
                    <Td>
                      <Link
                        to={buildPremiseGeoFenceUrl({ row, upload, tcId })}
                        style={styles.mapCellLink}
                        title="Open this premise on the Geo-Fences map"
                      >
                        {getAddress(row)}
                      </Link>
                    </Td>
                    <Td>{getErfNo(row)}</Td>
                    <Td>
                      <Badge tone="success">{getPrimaryReason(row)}</Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selectedGroup.rows.length > 15 ? (
            <p style={styles.microNote}>
              Showing first 15 rows only in this skeleton.
            </p>
          ) : null}
        </section>
      ) : null}

      {isCreateConfirmOpen ? (
        <BgoCreateConfirmModal
          allocatedGroups={allocatedReadyGroups}
          totalRows={allocatedRowCount}
          isCreating={createBgoState.isLoading}
          onCancel={handleCancelCreateBgo}
          onConfirm={handleConfirmCreateBgo}
        />
      ) : null}

      {isCreateFeedbackOpen ? (
        <BgoCreateFeedbackModal
          result={createResult}
          allocatedGroups={allocatedReadyGroups}
          totalRows={allocatedRowCount}
          onClose={handleCloseCreateFeedback}
        />
      ) : null}

      {isDeleteConfirmOpen ? (
        <BgoDeleteConfirmModal
          row={deleteTargetRow}
          isDeleting={deleteBgoState.isLoading}
          onCancel={handleCancelDeleteBgo}
          onConfirm={handleConfirmDeleteBgo}
        />
      ) : null}
    </section>
  );
}

function BgoDeleteConfirmModal({
  row = null,
  isDeleting = false,
  onCancel,
  onConfirm,
}) {
  const displayBatchId = valueOrNav(row?.batchId);
  const actualBatchId = valueOrNav(row?.actualBatchId || row?.batchId);
  const childTrnCount = safeNumber(row?.trnCount || row?.rowCount);

  return (
    <div style={styles.modalOverlay} role="presentation">
      <div
        style={styles.modalCard}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bgo-delete-confirm-title"
      >
        <div style={styles.modalHeader}>
          <div>
            <p style={styles.eyebrow}>Confirm BGO delete</p>
            <h3 id="bgo-delete-confirm-title" style={styles.modalTitle}>
              Delete this unaccepted BGO batch?
            </h3>
            <p style={styles.modalSubtitle}>
              This can only continue while the BGO batch is still ISSUED and no
              child TRN has been accepted, released, started, completed, or
              cancelled.
            </p>
          </div>

          <Badge tone="danger">WARNING</Badge>
        </div>

        <div style={styles.deleteWarningBox}>
          <strong>This will rollback the BGO allocation.</strong>
          <p>
            iREPS will delete the BGO batch, BGO-created child TRNs, related
            history/notifications, and restore the TC rows back to READY_FOR_BGO
            if the backend confirms it is safe.
          </p>
        </div>

        <div style={styles.deleteIdStack}>
          <InfoCard label="Firestore BGO Batch" value={actualBatchId} />
          <InfoCard label="Display BGO Batch" value={displayBatchId} />
        </div>

        <div style={styles.deleteCompactGrid}>
          <InfoCard label="Geofence" value={row?.geofenceName} />
          <InfoCard label="Rows" value={row?.rowCount} />
          <InfoCard label="Child TRNs" value={childTrnCount} />
          <InfoCard label="State" value={row?.status} />
        </div>

        <div style={styles.deleteTargetBox}>
          <span style={styles.deleteTargetLabel}>Allocated target</span>
          <AllocationTargetPill row={row || {}} />
        </div>

        <div style={styles.modalActions}>
          <button
            type="button"
            style={styles.modalCancelButton}
            onClick={onCancel}
            disabled={isDeleting}
          >
            Cancel
          </button>
          <button
            type="button"
            style={styles.modalDangerButton}
            onClick={onConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting BGO..." : "Delete BGO"}
          </button>
        </div>
      </div>
    </div>
  );
}

function BgoCreateFeedbackModal({
  result = null,
  allocatedGroups = [],
  totalRows = 0,
  onClose,
}) {
  const success = result?.success !== false;
  const batchIds = asArray(result?.bgoBatchIds || result?.batchIds);

  return (
    <div style={styles.modalOverlay} role="presentation">
      <div
        style={styles.modalCard}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bgo-create-feedback-title"
      >
        <div style={styles.modalHeader}>
          <div>
            <p style={styles.eyebrow}>BGO creation feedback</p>
            <h3 id="bgo-create-feedback-title" style={styles.modalTitle}>
              {success ? "BGO created successfully" : "BGO create failed"}
            </h3>
            <p style={styles.modalSubtitle}>
              {success
                ? `${allocatedGroups.length} geofence group(s) and ${totalRows} TC row(s) were submitted to BGO creation.`
                : result?.message ||
                  result?.code ||
                  "The BGO creation request failed."}
            </p>
          </div>

          <Badge tone={success ? "success" : "danger"}>
            {success ? "CREATED" : "FAILED"}
          </Badge>
        </div>

        {success ? (
          <>
            <div style={styles.modalAllocationList}>
              {allocatedGroups.map((group, index) => (
                <div key={group.geofenceId} style={styles.modalAllocationRow}>
                  <div style={styles.modalAllocationIndex}>
                    GF{String(index + 1).padStart(3, "0")}
                  </div>

                  <div style={styles.modalAllocationMain}>
                    <strong style={styles.modalGeofenceName}>
                      {group.geofenceName}
                    </strong>
                    <span style={styles.modalAllocationMeta}>
                      {group.rows.length} TC row(s)
                    </span>
                  </div>

                  <div style={styles.modalArrow}>→</div>

                  <div style={styles.modalTargetBox}>
                    <span style={styles.targetType}>
                      {group.allocationTarget?.type || "NAv"}
                    </span>
                    <strong style={styles.modalTargetName}>
                      {group.allocationTarget?.name ||
                        group.allocationTarget?.id ||
                        "NAv"}
                    </strong>
                    <span style={styles.modalAllocationMeta}>
                      {group.allocationTarget?.memberCount || 0} member(s)
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {batchIds.length > 0 ? (
              <div style={styles.feedbackBatchBox}>
                <strong>Created batch id(s)</strong>
                <p>{batchIds.join(", ")}</p>
              </div>
            ) : null}
          </>
        ) : (
          <div style={styles.createErrorBox}>
            <strong>{result?.code || "BGO_CREATE_FAILED"}</strong>
            <p style={{ margin: "6px 0 0" }}>
              {result?.message || "Failed to create BGO."}
            </p>
          </div>
        )}

        <div style={styles.modalActions}>
          <button type="button" style={styles.modalOkButton} onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

function BgoCreateConfirmModal({
  allocatedGroups = [],
  totalRows = 0,
  isCreating = false,
  onCancel,
  onConfirm,
}) {
  return (
    <div style={styles.modalOverlay} role="presentation">
      <div
        style={styles.modalCard}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bgo-create-confirm-title"
      >
        <div style={styles.modalHeader}>
          <div>
            <p style={styles.eyebrow}>Confirm BGO creation</p>
            <h3 id="bgo-create-confirm-title" style={styles.modalTitle}>
              Create BGO for {allocatedGroups.length} assigned geofence group(s)
              and {totalRows} TC row(s)?
            </h3>
            <p style={styles.modalSubtitle}>
              Please confirm the allocation before iREPS creates BGO batches,
              BGO rows, and child TRNs.
            </p>
          </div>
        </div>

        <div style={styles.modalAllocationList}>
          {allocatedGroups.map((group, index) => (
            <div key={group.geofenceId} style={styles.modalAllocationRow}>
              <div style={styles.modalAllocationIndex}>
                GF{String(index + 1).padStart(3, "0")}
              </div>

              <div style={styles.modalAllocationMain}>
                <strong style={styles.modalGeofenceName}>
                  {group.geofenceName}
                </strong>
                <span style={styles.modalAllocationMeta}>
                  {group.rows.length} TC row(s)
                </span>
              </div>

              <div style={styles.modalArrow}>→</div>

              <div style={styles.modalTargetBox}>
                <span style={styles.targetType}>
                  {group.allocationTarget?.type || "NAv"}
                </span>
                <strong style={styles.modalTargetName}>
                  {group.allocationTarget?.name ||
                    group.allocationTarget?.id ||
                    "NAv"}
                </strong>
                <span style={styles.modalAllocationMeta}>
                  {group.allocationTarget?.memberCount || 0} member(s)
                </span>
              </div>
            </div>
          ))}
        </div>

        <div style={styles.modalActions}>
          <button
            type="button"
            style={styles.modalCancelButton}
            onClick={onCancel}
            disabled={isCreating}
          >
            Cancel
          </button>
          <button
            type="button"
            style={styles.modalOkButton}
            onClick={onConfirm}
            disabled={isCreating}
          >
            {isCreating ? "Creating BGO..." : "OK - Create BGO"}
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoCard({ label, value }) {
  return (
    <div style={styles.infoCard}>
      <span style={styles.infoLabel}>{label}</span>
      <strong style={styles.infoValue}>{valueOrNav(value)}</strong>
    </div>
  );
}

function SummaryDetailRow({ label, value }) {
  return (
    <div style={styles.summaryDetailRow}>
      <span style={styles.summaryDetailLabel}>{label}</span>
      <strong style={styles.summaryDetailValue}>{valueOrNav(value)}</strong>
    </div>
  );
}

function Badge({ children, tone = "neutral" }) {
  const toneStyle =
    tone === "success"
      ? styles.successBadge
      : tone === "warning"
        ? styles.warningBadge
        : tone === "danger"
          ? styles.dangerBadge
          : styles.neutralBadge;

  return <span style={{ ...styles.badge, ...toneStyle }}>{children}</span>;
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

const styles = {
  modalOverlay: {
    position: "fixed",
    inset: 0,
    zIndex: 9999,
    background: "rgba(15, 23, 42, 0.58)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  },

  modalCard: {
    width: "min(860px, 96vw)",
    maxHeight: "90vh",
    overflowY: "auto",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 24,
    boxShadow: "0 24px 80px rgba(15, 23, 42, 0.30)",
    padding: 22,
  },

  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 16,
  },

  modalTitle: {
    margin: "8px 0 0",
    color: "#0f172a",
    fontSize: 22,
    lineHeight: 1.25,
  },

  modalSubtitle: {
    margin: "8px 0 0",
    color: "#64748b",
    fontSize: 13,
    lineHeight: 1.6,
  },

  modalAllocationList: {
    display: "grid",
    gap: 10,
    marginTop: 16,
  },

  modalAllocationRow: {
    display: "grid",
    gridTemplateColumns: "72px minmax(0, 1fr) 30px minmax(180px, 0.75fr)",
    gap: 10,
    alignItems: "center",
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    background: "#f8fafc",
    padding: 12,
  },

  modalAllocationIndex: {
    display: "inline-flex",
    justifyContent: "center",
    border: "1px solid #bfdbfe",
    borderRadius: 999,
    background: "#eff6ff",
    color: "#1d4ed8",
    padding: "6px 8px",
    fontSize: 11,
    fontWeight: 900,
  },

  modalAllocationMain: {
    minWidth: 0,
  },

  modalGeofenceName: {
    display: "block",
    color: "#0f172a",
    fontSize: 14,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  modalAllocationMeta: {
    display: "block",
    marginTop: 4,
    color: "#64748b",
    fontSize: 11,
    fontWeight: 800,
  },

  modalArrow: {
    color: "#16a34a",
    fontSize: 22,
    fontWeight: 900,
    textAlign: "center",
  },

  modalTargetBox: {
    border: "1px solid #bbf7d0",
    borderRadius: 14,
    background: "#f0fdf4",
    padding: 10,
    minWidth: 0,
  },

  modalTargetName: {
    display: "block",
    color: "#0f172a",
    fontSize: 13,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  modalActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 18,
  },

  modalCancelButton: {
    border: "1px solid #cbd5e1",
    borderRadius: 999,
    background: "#ffffff",
    color: "#334155",
    padding: "10px 16px",
    fontSize: 13,
    fontWeight: 900,
    cursor: "pointer",
  },

  modalOkButton: {
    border: "1px solid #16a34a",
    borderRadius: 999,
    background: "#16a34a",
    color: "#ffffff",
    padding: "10px 16px",
    fontSize: 13,
    fontWeight: 900,
    cursor: "pointer",
  },

  modalDangerButton: {
    border: "1px solid #dc2626",
    borderRadius: 999,
    background: "#dc2626",
    color: "#ffffff",
    padding: "10px 16px",
    fontSize: 13,
    fontWeight: 900,
    cursor: "pointer",
  },

  deleteWarningBox: {
    border: "1px solid #fecaca",
    borderRadius: 16,
    background: "#fef2f2",
    color: "#991b1b",
    padding: 14,
    marginBottom: 14,
    fontSize: 13,
    lineHeight: 1.55,
  },

  deleteIdStack: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: 10,
    marginTop: 12,
  },

  deleteCompactGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: 10,
    marginTop: 10,
  },

  deleteTargetBox: {
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    background: "#f8fafc",
    padding: 12,
    marginTop: 14,
    display: "grid",
    gap: 8,
    justifyItems: "start",
  },

  deleteTargetLabel: {
    color: "#64748b",
    fontSize: 10,
    fontWeight: 900,
    textTransform: "uppercase",
  },

  deleteResultSuccess: {
    border: "1px solid #bbf7d0",
    borderRadius: 14,
    background: "#f0fdf4",
    color: "#166534",
    padding: 12,
    margin: "12px 0 0",
    fontSize: 12,
    fontWeight: 900,
    lineHeight: 1.45,
  },

  deleteResultError: {
    border: "1px solid #fecaca",
    borderRadius: 14,
    background: "#fef2f2",
    color: "#991b1b",
    padding: 12,
    margin: "12px 0 0",
    fontSize: 12,
    fontWeight: 900,
    lineHeight: 1.45,
  },

  page: { padding: 24 },

  backRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 12,
  },

  backLink: {
    display: "inline-flex",
    alignItems: "center",
    border: "1px solid #bfdbfe",
    borderRadius: 999,
    background: "#eff6ff",
    color: "#1d4ed8",
    padding: "8px 12px",
    fontSize: 12,
    fontWeight: 900,
    textDecoration: "none",
  },

  header: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 24,
    padding: 24,
    marginBottom: 16,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  },

  eyebrow: {
    margin: 0,
    fontSize: 12,
    fontWeight: 900,
    color: "#2563eb",
    textTransform: "uppercase",
    letterSpacing: 1,
  },

  title: {
    margin: "8px 0",
    fontSize: 28,
    color: "#0f172a",
  },

  subtitle: {
    margin: 0,
    maxWidth: 840,
    color: "#64748b",
    lineHeight: 1.6,
  },

  summaryPanel: {
    display: "grid",
    gridTemplateColumns: "minmax(360px, 1.25fr) minmax(360px, 1fr)",
    gap: 12,
    marginBottom: 16,
    alignItems: "stretch",
  },

  summaryMetaColumn: {
    display: "grid",
    gap: 8,
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    padding: 14,
    minWidth: 0,
  },

  summaryDetailRow: {
    display: "grid",
    gridTemplateColumns: "100px minmax(0, 1fr)",
    gap: 12,
    alignItems: "start",
    borderBottom: "1px solid #f1f5f9",
    paddingBottom: 8,
  },

  summaryDetailLabel: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: 900,
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  },

  summaryDetailValue: {
    color: "#0f172a",
    fontSize: 13,
    lineHeight: 1.45,
    wordBreak: "break-word",
    minWidth: 0,
  },

  summaryMetricGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
    gap: 12,
    minWidth: 0,
  },

  infoCard: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    padding: 14,
    minHeight: 74,
  },

  infoLabel: {
    display: "block",
    color: "#64748b",
    fontSize: 11,
    fontWeight: 900,
    textTransform: "uppercase",
    marginBottom: 8,
  },

  infoValue: {
    color: "#0f172a",
    fontSize: 16,
    lineHeight: 1.4,
    wordBreak: "break-word",
  },

  infoBanner: {
    background: "#fffbeb",
    border: "1px solid #fde68a",
    color: "#92400e",
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    fontSize: 13,
    lineHeight: 1.6,
  },

  panel: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 24,
    padding: 18,
    marginBottom: 16,
  },

  panelHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 14,
  },

  panelTitle: {
    margin: 0,
    color: "#0f172a",
    fontSize: 18,
  },

  panelSubtitle: {
    margin: "6px 0 0",
    color: "#64748b",
    fontSize: 13,
    lineHeight: 1.5,
  },

  boardGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(300px, 0.85fr) minmax(360px, 1.15fr)",
    gap: 16,
    alignItems: "start",
  },

  leftColumn: {
    display: "grid",
    gap: 16,
  },

  targetCard: {
    border: "1px dashed #cbd5e1",
    borderRadius: 18,
    background: "#f8fafc",
    padding: 16,
  },

  targetType: {
    display: "inline-flex",
    borderRadius: 999,
    background: "#eff6ff",
    color: "#1d4ed8",
    padding: "5px 9px",
    fontSize: 10,
    fontWeight: 900,
    marginBottom: 8,
  },

  targetOptionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 8,
  },

  targetTitle: {
    display: "block",
    color: "#0f172a",
    fontSize: 13,
    fontWeight: 900,
    textAlign: "right",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
  },

  targetSub: {
    margin: "0 0 10px",
    color: "#64748b",
    fontSize: 12,
    lineHeight: 1.45,
    fontWeight: 800,
    textAlign: "left",
  },

  targetToggleRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
    marginBottom: 12,
  },

  targetToggleButton: {
    border: "1px solid #cbd5e1",
    borderRadius: 999,
    background: "#ffffff",
    color: "#475569",
    padding: "9px 12px",
    fontSize: 12,
    fontWeight: 900,
    cursor: "pointer",
  },

  targetToggleActive: {
    borderColor: "#2563eb",
    background: "#eff6ff",
    color: "#1d4ed8",
  },

  targetOptionList: {
    display: "grid",
    gap: 10,
    maxHeight: 430,
    overflowY: "auto",
    paddingRight: 4,
  },

  targetOptionCard: {
    width: "100%",
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    background: "#ffffff",
    padding: 12,
    textAlign: "left",
    cursor: "pointer",
  },

  targetOptionCardActive: {
    borderColor: "#16a34a",
    background: "#f0fdf4",
  },

  targetOptionCardDragging: {
    borderColor: "#2563eb",
    background: "#eff6ff",
  },

  targetMicro: {
    display: "block",
    color: "#64748b",
    fontSize: 11,
    fontWeight: 800,
    marginTop: 6,
    wordBreak: "break-word",
  },

  memberList: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },

  memberChip: {
    display: "grid",
    gap: 2,
    border: "1px solid #cbd5e1",
    borderRadius: 999,
    background: "#f8fafc",
    padding: "5px 8px",
    color: "#0f172a",
    maxWidth: "100%",
    fontSize: 11,
  },

  memberChipWarning: {
    borderColor: "#f59e0b",
    background: "#fffbeb",
  },

  memberMore: {
    display: "inline-flex",
    alignItems: "center",
    border: "1px solid #e2e8f0",
    borderRadius: 999,
    background: "#ffffff",
    padding: "6px 9px",
    color: "#475569",
    fontSize: 11,
    fontWeight: 900,
  },

  memberEmpty: {
    border: "1px dashed #cbd5e1",
    borderRadius: 12,
    background: "#f8fafc",
    color: "#64748b",
    fontSize: 12,
    fontWeight: 800,
    padding: 10,
    marginTop: 8,
  },

  formGrid: {
    display: "grid",
    gap: 12,
  },

  formLabel: {
    display: "grid",
    gap: 6,
    color: "#334155",
    fontSize: 12,
    fontWeight: 900,
  },

  input: {
    border: "1px solid #cbd5e1",
    borderRadius: 12,
    background: "#ffffff",
    color: "#0f172a",
    padding: "10px 11px",
    fontSize: 13,
    fontWeight: 800,
  },

  assignButton: {
    border: "1px solid #cbd5e1",
    borderRadius: 12,
    background: "#ffffff",
    color: "#94a3b8",
    padding: "9px 12px",
    fontSize: 12,
    fontWeight: 900,
    cursor: "not-allowed",
  },

  groupList: {
    display: "grid",
    gap: 10,
  },

  groupCard: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: 12,
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    background: "#ffffff",
    padding: 14,
    textAlign: "left",
  },

  groupCardActive: {
    borderColor: "#2563eb",
    background: "#eff6ff",
  },

  groupCardAllocated: {
    borderColor: "#86efac",
    background: "#f0fdf4",
  },

  groupCardDragFocused: {
    borderColor: "#f59e0b",
    background: "#fffbeb",
    boxShadow: "0 0 0 4px rgba(245, 158, 11, 0.18)",
    transform: "translateY(-1px)",
  },

  groupMain: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 0.8fr) minmax(220px, 1.2fr)",
    gap: 12,
    alignItems: "center",
    minWidth: 0,
  },

  groupSelectButton: {
    minWidth: 0,
    border: "none",
    background: "transparent",
    padding: 0,
    textAlign: "left",
    cursor: "pointer",
  },

  groupActions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    flexWrap: "wrap",
  },

  groupAllocationBox: {
    border: "1px dashed #cbd5e1",
    borderRadius: 14,
    background: "#f8fafc",
    padding: 10,
    minWidth: 0,
  },

  groupAllocationBoxAssigned: {
    borderStyle: "solid",
    borderColor: "#86efac",
    background: "#dcfce7",
  },

  groupAllocationBoxDragFocused: {
    borderStyle: "solid",
    borderColor: "#f59e0b",
    background: "#fef3c7",
  },

  groupAllocationLabel: {
    display: "block",
    color: "#64748b",
    fontSize: 10,
    fontWeight: 900,
    textTransform: "uppercase",
    marginBottom: 4,
  },

  groupAllocationTarget: {
    display: "block",
    color: "#0f172a",
    fontSize: 12,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  groupAllocationMembers: {
    display: "block",
    color: "#64748b",
    fontSize: 11,
    fontWeight: 800,
    marginTop: 4,
  },

  assignSelectedButton: {
    border: "1px solid #bfdbfe",
    borderRadius: 999,
    background: "#eff6ff",
    color: "#1d4ed8",
    padding: "7px 10px",
    fontSize: 11,
    fontWeight: 900,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },

  assignSelectedButtonDisabled: {
    borderColor: "#e2e8f0",
    background: "#f8fafc",
    color: "#94a3b8",
    cursor: "not-allowed",
  },

  clearAssignmentButton: {
    border: "1px solid #fecaca",
    borderRadius: 999,
    background: "#fef2f2",
    color: "#991b1b",
    padding: "7px 10px",
    fontSize: 11,
    fontWeight: 900,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },

  groupMapLink: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    border: "1px solid #bbf7d0",
    borderRadius: 999,
    background: "#dcfce7",
    color: "#166534",
    padding: "6px 10px",
    fontSize: 11,
    fontWeight: 900,
    textDecoration: "none",
    whiteSpace: "nowrap",
  },

  groupName: {
    display: "block",
    color: "#0f172a",
    fontSize: 14,
    fontWeight: 900,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  groupMeta: {
    display: "block",
    color: "#64748b",
    fontSize: 12,
    fontWeight: 800,
    marginTop: 4,
  },

  choiceList: {
    display: "grid",
    gap: 10,
  },

  choiceCard: {
    display: "grid",
    gridTemplateColumns: "1fr minmax(260px, 320px)",
    gap: 12,
    alignItems: "center",
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    background: "#f8fafc",
    padding: 14,
  },

  choiceTitle: {
    display: "block",
    color: "#0f172a",
    fontSize: 13,
  },

  choiceSub: {
    margin: "4px 0 0",
    color: "#64748b",
    fontSize: 12,
    lineHeight: 1.4,
  },

  select: {
    border: "1px solid #cbd5e1",
    borderRadius: 12,
    background: "#ffffff",
    color: "#0f172a",
    padding: "10px 11px",
    fontSize: 13,
    fontWeight: 800,
  },

  tableWrap: {
    overflowX: "auto",
  },

  table: {
    width: "100%",
    borderCollapse: "collapse",
    minWidth: 860,
  },

  th: {
    textAlign: "left",
    background: "#f8fafc",
    color: "#475569",
    borderBottom: "1px solid #e2e8f0",
    padding: "12px 10px",
    fontSize: 11,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },

  td: {
    color: "#334155",
    borderBottom: "1px solid #f1f5f9",
    padding: "12px 10px",
    fontSize: 12,
    lineHeight: 1.5,
    verticalAlign: "top",
    whiteSpace: "nowrap",
  },

  strongCell: {
    color: "#0f172a",
    fontWeight: 900,
  },

  allocationCell: {
    display: "grid",
    gap: 6,
    alignItems: "start",
  },

  allocationTargetPill: {
    display: "inline-flex",
    alignItems: "center",
    width: "fit-content",
    maxWidth: 260,
    border: "1px solid #cbd5e1",
    borderRadius: 999,
    background: "#f8fafc",
    color: "#334155",
    padding: "4px 8px",
    fontSize: 10,
    lineHeight: 1.25,
    fontWeight: 900,
    textDecoration: "none",
    whiteSpace: "normal",
  },

  allocationTargetPillTeam: {
    borderColor: "#bfdbfe",
    background: "#eff6ff",
    color: "#1d4ed8",
  },

  allocationTargetPillSp: {
    borderColor: "#bbf7d0",
    background: "#f0fdf4",
    color: "#166534",
  },

  allocationTargetEmpty: {
    display: "inline-flex",
    alignItems: "center",
    width: "fit-content",
    border: "1px solid #e2e8f0",
    borderRadius: 999,
    background: "#f8fafc",
    color: "#94a3b8",
    padding: "4px 8px",
    fontSize: 10,
    lineHeight: 1.25,
    fontWeight: 900,
  },

  actionRow: {
    display: "inline-flex",
    gap: 8,
    flexWrap: "wrap",
  },

  actionMuted: {
    display: "inline-flex",
    alignItems: "center",
    border: "1px solid #e2e8f0",
    borderRadius: 999,
    background: "#f8fafc",
    color: "#94a3b8",
    padding: "7px 10px",
    fontSize: 11,
    fontWeight: 900,
  },

  actionButton: {
    border: "1px solid #bfdbfe",
    borderRadius: 999,
    background: "#eff6ff",
    color: "#94a3b8",
    padding: "7px 10px",
    fontSize: 11,
    fontWeight: 900,
    cursor: "not-allowed",
  },

  deleteButton: {
    border: "1px solid #fecaca",
    borderRadius: 999,
    background: "#fef2f2",
    color: "#94a3b8",
    padding: "7px 10px",
    fontSize: 11,
    fontWeight: 900,
    cursor: "not-allowed",
  },

  deleteButtonEnabled: {
    color: "#991b1b",
    cursor: "pointer",
  },

  createButton: {
    border: "none",
    borderRadius: 14,
    background: "#94a3b8",
    color: "#ffffff",
    padding: "11px 14px",
    fontSize: 12,
    fontWeight: 900,
    cursor: "not-allowed",
    whiteSpace: "nowrap",
  },

  createButtonEnabled: {
    background: "#16a34a",
    cursor: "pointer",
  },

  createSuccessBox: {
    border: "1px solid #bbf7d0",
    borderRadius: 16,
    background: "#f0fdf4",
    color: "#166534",
    padding: 14,
    marginTop: 12,
    fontSize: 13,
    fontWeight: 800,
    lineHeight: 1.5,
  },

  createErrorBox: {
    border: "1px solid #fecaca",
    borderRadius: 16,
    background: "#fef2f2",
    color: "#991b1b",
    padding: 14,
    marginTop: 12,
    fontSize: 13,
    fontWeight: 800,
    lineHeight: 1.5,
  },

  mapCellLink: {
    display: "inline-flex",
    alignItems: "center",
    maxWidth: 520,
    border: "1px solid #bfdbfe",
    borderRadius: 999,
    background: "#eff6ff",
    color: "#1d4ed8",
    padding: "6px 10px",
    fontSize: 12,
    fontWeight: 900,
    textDecoration: "none",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  badge: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: 999,
    padding: "6px 10px",
    fontSize: 10,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },

  successBadge: {
    background: "#dcfce7",
    color: "#166534",
  },

  warningBadge: {
    background: "#fef3c7",
    color: "#92400e",
  },

  dangerBadge: {
    background: "#fee2e2",
    color: "#991b1b",
  },

  neutralBadge: {
    background: "#f1f5f9",
    color: "#475569",
  },

  emptyState: {
    border: "1px dashed #cbd5e1",
    borderRadius: 16,
    background: "#f8fafc",
    color: "#64748b",
    padding: 18,
    fontSize: 13,
    fontWeight: 800,
    lineHeight: 1.5,
  },

  microNote: {
    margin: "10px 0 0",
    color: "#64748b",
    fontSize: 12,
    fontWeight: 800,
    lineHeight: 1.5,
  },

  notice: {
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    color: "#1e3a8a",
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    fontWeight: 800,
  },

  errorNotice: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#991b1b",
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    fontWeight: 800,
  },
};
