import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../../auth/useAuth";
import { useGeo } from "@/context/GeoContext";
import { useWarehouse } from "@/context/WarehouseContext";

import {
  useCreateBgoMutation,
  useDeleteUnacceptedBgoMutation,
  useGetBmdBgoBatchesByWardQuery,
} from "../../redux/bgoApi";
import { useGetGeoFencesByWardQuery } from "../../redux/geofencesApi";
import { useGetAvailableTeamsQuery } from "../../redux/teamsApi";
import { useGetAvailableServiceProvidersQuery } from "../../redux/serviceProvidersApi";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeNumber(value, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function readFirstString(...values) {
  for (const value of values) {
    const clean = String(value || "").trim();
    if (clean) return clean;
  }

  return "";
}

function valueOrNav(value) {
  const clean = String(value || "").trim();
  return clean || "NAv";
}

function normalizeUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function hasMeaningfulValue(value) {
  const text = normalizeUpper(value);

  return (
    text !== "" &&
    text !== "NAV" &&
    text !== "N/AV" &&
    text !== "N/A" &&
    text !== "NA" &&
    text !== "NULL" &&
    text !== "UNDEFINED"
  );
}

function getActiveLmPcode(activeWorkbase, selectedLm) {
  return readFirstString(
    selectedLm?.pcode,
    selectedLm?.id,
    activeWorkbase?.lmPcode,
    activeWorkbase?.pcode,
    activeWorkbase?.id,
    activeWorkbase?.localMunicipalityId,
  );
}

function getLmName(activeWorkbase, selectedLm) {
  return valueOrNav(
    readFirstString(
      selectedLm?.name,
      selectedLm?.lmName,
      activeWorkbase?.name,
      activeWorkbase?.lmName,
      activeWorkbase?.id,
    ),
  );
}

function getWardPcode(ward = {}) {
  return readFirstString(ward?.pcode, ward?.id, ward?.wardPcode, ward?.code);
}

function getWardNo(ward = {}) {
  const explicit = readFirstString(ward?.wardNo, ward?.no, ward?.number, ward?.code);
  if (explicit) return explicit;

  const pcode = getWardPcode(ward);
  const match = pcode.match(/(\d{3})$/);
  if (!match) return "NAv";

  return String(Number(match[1]) || match[1]);
}

function getWardLabel(ward = {}, fallbackPcode = "") {
  const pcode = getWardPcode(ward) || fallbackPcode;
  const name = readFirstString(ward?.name, ward?.wardName, ward?.label);

  if (name && pcode && !name.includes(pcode)) return `${name} (${pcode})`;
  if (name) return name;

  const wardNo = getWardNo({ ...ward, id: pcode });
  if (wardNo !== "NAv" && pcode) return `Ward ${wardNo} (${pcode})`;
  if (pcode) return pcode;

  return "NAv";
}

function getGeofenceName(geofence = {}) {
  return valueOrNav(
    readFirstString(
      geofence?.name,
      geofence?.label,
      geofence?.description,
      geofence?.id,
    ),
  );
}

function getGeofenceDescription(geofence = {}) {
  return valueOrNav(readFirstString(geofence?.description, geofence?.notes));
}

function normalizeGeofenceRefs(refs = []) {
  return asArray(refs)
    .map((ref) => ({
      id: readFirstString(ref?.id, ref?.geofenceId, ref?.geoFenceId),
      name: readFirstString(ref?.name, ref?.label, ref?.description),
    }))
    .filter((ref) => ref.id);
}

function getEntityGeofenceRefs(entity = {}) {
  return normalizeGeofenceRefs(
    entity?.geofenceRefs ||
      entity?.__geofenceRefs ||
      entity?.ast?.geofenceRefs ||
      entity?.premise?.geofenceRefs ||
      entity?.refs?.geofenceRefs ||
      [],
  );
}

function hasGeofenceRef(entity = {}, geofenceId = "") {
  const cleanId = String(geofenceId || "").trim();
  if (!cleanId) return false;

  return getEntityGeofenceRefs(entity).some((ref) => ref.id === cleanId);
}

function getErfId(erf = {}) {
  return readFirstString(erf?.id, erf?.erfId, erf?.__erfId);
}

function getErfNo(erf = {}) {
  return valueOrNav(
    readFirstString(
      erf?.erfNo,
      erf?.__erfNo,
      erf?.erf?.erfNo,
      erf?.erf?.number,
      erf?.sg?.erfNo,
      erf?.sg?.parcelNo,
      erf?.sg?.parcelNumber,
      erf?.admin?.erfNo,
      erf?.admin?.parcelNo,
      erf?.id,
    ),
  );
}

function getTargetName(target = {}) {
  return valueOrNav(
    readFirstString(target?.name, target?.label, target?.displayName, target?.id),
  );
}

function getTargetOptionSubtitle(target = {}) {
  if (target.type === "TEAM") {
    return `${target.memberCount || 0} member(s) • ${
      target.serviceProviderCount || 0
    } SP link(s)`;
  }

  const parentText =
    target.parentServiceProviderName && target.parentServiceProviderName !== "NAv"
      ? `SUBC under ${target.parentServiceProviderName}`
      : "SUBC service provider";

  return parentText;
}

function getTargetOptionMicroText(target = {}) {
  if (target.type === "TEAM") {
    return `Owner: ${target.mncServiceProviderName || "NAv"}`;
  }

  return `SP ID: ${target.id || "NAv"}`;
}

function buildTargetPayload(target = null) {
  if (!target || typeof target !== "object") return null;

  const type = normalizeUpper(target.type);
  const id = String(target.id || "").trim();
  const name = getTargetName(target);

  if (!["TEAM", "SP"].includes(type) || !id) return null;

  return {
    type,
    id,
    name,
    memberCount: safeNumber(target.memberCount),
    serviceProviderCount: safeNumber(target.serviceProviderCount),
  };
}

function getTargetLabel(target = {}) {
  if (!target?.type || !target?.id) return "NAv";
  return `${target.type} • ${target.name || target.id}`;
}

function normalizeAuthorityText(value) {
  return normalizeUpper(value);
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

function buildWardOptions({ availableWards = [], selectedWard = null }) {
  const byPcode = new Map();

  asArray(availableWards).forEach((ward) => {
    const pcode = getWardPcode(ward);
    if (!pcode) return;
    byPcode.set(pcode, ward);
  });

  const selectedPcode = getWardPcode(selectedWard || {});
  if (selectedPcode && !byPcode.has(selectedPcode)) {
    byPcode.set(selectedPcode, selectedWard);
  }

  return Array.from(byPcode.values()).sort((left, right) =>
    getWardLabel(left).localeCompare(getWardLabel(right), undefined, {
      numeric: true,
    }),
  );
}

function buildTargetOptions({ teams = [], serviceProviders = [], targetType = "TEAM" }) {
  if (targetType === "SP") {
    return asArray(serviceProviders)
      .map((serviceProvider) => ({
        ...serviceProvider,
        type: "SP",
        id: serviceProvider.id,
        name: getTargetName(serviceProvider),
      }))
      .filter((item) => item.id);
  }

  return asArray(teams)
    .map((team) => ({
      ...team,
      type: "TEAM",
      id: team.id,
      name: getTargetName(team),
    }))
    .filter((item) => item.id);
}

function getEntityCollections(all = {}) {
  return {
    erfs: asArray(all?.erfs || all?.erfRows || all?.wardErfs),
    premises: asArray(all?.premises || all?.prems || all?.premiseRows),
    meters: asArray(all?.meters || all?.asts || all?.meterRows),
  };
}

function buildGeofenceGroups({ geofences = [], all = {} }) {
  const { erfs, premises, meters } = getEntityCollections(all);

  return asArray(geofences).map((geofence) => {
    const geofenceId = geofence.id;
    const matchingErfs = erfs.filter((erf) => hasGeofenceRef(erf, geofenceId));
    const matchingPremises = premises.filter((premise) =>
      hasGeofenceRef(premise, geofenceId),
    );
    const matchingMeters = meters.filter((meter) => hasGeofenceRef(meter, geofenceId));

    const fallbackCounts = geofence?.counts || {};
    const erfRefs = matchingErfs
      .map((erf) => ({
        id: getErfId(erf),
        erfNo: getErfNo(erf),
        erfType: erf?.isInformal === true ? "INFORMAL" : "FORMAL",
      }))
      .filter((erf) => erf.id);

    return {
      geofenceId,
      geofenceName: getGeofenceName(geofence),
      geofenceDescription: getGeofenceDescription(geofence),
      geofenceRef: {
        id: geofenceId,
        name: getGeofenceName(geofence),
      },
      raw: geofence,
      erfRefs,
      erfCount: erfRefs.length || safeNumber(fallbackCounts.erfs),
      premiseCount: matchingPremises.length || safeNumber(fallbackCounts.premises),
      meterCount: matchingMeters.length || safeNumber(fallbackCounts.meters),
    };
  });
}

function buildAllocatedReadyGroups(groups = [], allocationsByGeofenceId = {}) {
  return groups
    .map((group) => ({
      ...group,
      allocationTarget: allocationsByGeofenceId[group.geofenceId] || null,
    }))
    .filter((group) => group.allocationTarget?.id);
}

function buildCreatePayload({ group, scope }) {
  return {
    batchMode: "BMD",
    sourceModule: "BULK_METER_DISCOVERY",
    trnType: "METER_DISCOVERY",
    operationType: "METER_DISCOVERY",
    operationCode: "MDIS",

    scope,

    geofenceRef: group.geofenceRef,

    target: {
      type: group.allocationTarget.type,
      id: group.allocationTarget.id,
      name: group.allocationTarget.name,
    },

    worklist: {
      type: "ERF_LIST",
      erfRefs: group.erfRefs,
    },

    summary: {
      erfCount: group.erfCount,
      premiseCount: group.premiseCount,
      meterCount: group.meterCount,
    },
  };
}

function createGeofenceMapRoute({ lmPcode, wardPcode, group }) {
  const params = new URLSearchParams({
    lmPcode: lmPcode || "",
    wardPcode: wardPcode || "",
    focusGeofenceId: group?.geofenceId || "",
    focusGeofenceName: group?.geofenceName || "",
    fitGeofence: "true",
  });

  return `/operations/geo-fences?${params.toString()}`;
}

function Badge({ tone = "neutral", children }) {
  return <span style={{ ...styles.badge, ...(styles[`badge_${tone}`] || {}) }}>{children}</span>;
}

function getBatchId(batch = {}) {
  return readFirstString(batch?.bgoBatchId, batch?.batchId, batch?.id, batch?.raw?.id);
}

function getBatchWorkflowState(batch = {}) {
  return normalizeUpper(batch?.workflowState || batch?.raw?.workflow?.state || batch?.raw?.state);
}

function getBatchReleaseState(batch = {}) {
  return normalizeUpper(batch?.releaseState || batch?.raw?.bgo?.releaseState || batch?.raw?.releaseState);
}

function getBatchBmdCreatedPremiseCount(batch = {}) {
  const raw = batch?.raw || {};
  return safeNumber(
    raw?.bmdProgress?.premisesCreated ??
      raw?.bmd?.premisesCreated ??
      raw?.progress?.premisesCreated ??
      raw?.createdCounts?.premises ??
      raw?.bgo?.premisesCreated,
  );
}

function getBatchBmdCreatedMeterCount(batch = {}) {
  const raw = batch?.raw || {};
  return safeNumber(
    raw?.bmdProgress?.metersDiscovered ??
      raw?.bmd?.metersDiscovered ??
      raw?.progress?.metersDiscovered ??
      raw?.createdCounts?.meters ??
      raw?.derivedExecutionSummary?.totalChildTrns ??
      raw?.summary?.totalChildTrns ??
      raw?.bgo?.metersDiscovered,
  );
}

function isBatchWaitingForAcceptance(batch = {}) {
  return (
    getBatchWorkflowState(batch) === "ISSUED" &&
    getBatchReleaseState(batch) === "WAITING_BATCH_ACCEPTANCE"
  );
}

function getRemoveDisabledReason(batch = {}) {
  if (!batch) return "Select an MD BGO allocation first.";

  if (!isBatchWaitingForAcceptance(batch)) {
    return "Only ISSUED MD BGO allocations waiting for acceptance can be removed.";
  }

  const premiseCreatedCount = getBatchBmdCreatedPremiseCount(batch);
  const meterCreatedCount = getBatchBmdCreatedMeterCount(batch);

  if (premiseCreatedCount > 0 || meterCreatedCount > 0) {
    return "Cannot remove: premises or meters have already been created under this MD BGO allocation.";
  }

  return "Ready to remove this MD BGO allocation.";
}

function canRemoveBmdBatch(batch = {}) {
  return getRemoveDisabledReason(batch) === "Ready to remove this MD BGO allocation.";
}

function isExistingBmdAllocationActive(batch = {}) {
  const workflowState = getBatchWorkflowState(batch);

  return !["CANCELLED", "CANCELED", "REJECTED", "COMPLETED"].includes(workflowState);
}

function buildExistingAllocationByGeofenceId(existingBmdBatches = []) {
  return asArray(existingBmdBatches).reduce((acc, batch) => {
    const geofenceId = readFirstString(batch?.geofenceId, batch?.geofenceRef?.id);

    if (!geofenceId || !isExistingBmdAllocationActive(batch)) return acc;

    if (!acc[geofenceId]) {
      acc[geofenceId] = batch;
    }

    return acc;
  }, {});
}

function ExistingBmdAllocationCard({ batch, onRemove, isDeleting }) {
  const raw = batch?.raw || {};
  const batchId = getBatchId(batch);
  const premiseCreatedCount = getBatchBmdCreatedPremiseCount(batch);
  const meterCreatedCount = getBatchBmdCreatedMeterCount(batch);
  const removable = canRemoveBmdBatch(batch) && !isDeleting;

  return (
    <div style={styles.existingBatchCard}>
      <div style={styles.existingBatchMain}>
        <div>
          <strong style={styles.existingBatchTitle}>{batch.geofenceName || "NAv"}</strong>
          <span style={styles.existingBatchSub}>{batchId}</span>
        </div>
        <Badge tone={isBatchWaitingForAcceptance(batch) ? "warning" : "neutral"}>
          {getBatchWorkflowState(batch)}
        </Badge>
      </div>

      <div style={styles.existingBatchGrid}>
        <InfoCard label="Target" value={getTargetLabel(batch.target)} />
        <InfoCard label="ERFs" value={raw?.summary?.erfCount || raw?.batchReleaseSummary?.totalRows || 0} />
        <InfoCard label="BMD Premises Created" value={premiseCreatedCount} />
        <InfoCard label="BMD Meters Created" value={meterCreatedCount} />
      </div>

      <div style={styles.existingBatchFooter}>
        <span style={styles.existingBatchReason}>{getRemoveDisabledReason(batch)}</span>
        <button
          type="button"
          style={{
            ...styles.dangerOutlineButton,
            ...(removable ? styles.dangerOutlineButtonEnabled : null),
          }}
          disabled={!removable}
          onClick={() => onRemove(batch)}
          title={getRemoveDisabledReason(batch)}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

function InfoCard({ label, value }) {
  return (
    <div style={styles.infoCard}>
      <span style={styles.infoLabel}>{label}</span>
      <strong style={styles.infoValue}>{value}</strong>
    </div>
  );
}

function Th({ children }) {
  return <th style={styles.th}>{children}</th>;
}

function Td({ children, strong = false }) {
  return <td style={{ ...styles.td, ...(strong ? styles.tdStrong : null) }}>{children}</td>;
}

function getFeedbackTone(feedback = {}) {
  if (feedback?.tone) return feedback.tone;
  return feedback?.success ? "success" : "danger";
}

function FeedbackModal({ feedback, onClose }) {
  if (!feedback) return null;

  const tone = getFeedbackTone(feedback);
  const details = asArray(feedback.details).filter(Boolean);

  return (
    <div style={styles.modalOverlay}>
      <div style={styles.modalCard}>
        <div style={styles.modalHeader}>
          <div>
            <p style={styles.eyebrow}>{feedback.eyebrow || "MD BGO Feedback"}</p>
            <h3 style={styles.modalTitle}>{feedback.title || "MD BGO result"}</h3>
            {feedback.message ? (
              <p style={styles.modalSubtitle}>{feedback.message}</p>
            ) : null}
          </div>
          <Badge tone={tone}>{feedback.badgeLabel || (feedback.success ? "SUCCESS" : "FAILED")}</Badge>
        </div>

        {details.length > 0 ? (
          <div style={styles.feedbackDetailList}>
            {details.map((detail, index) => (
              <div key={`${detail}-${index}`} style={styles.feedbackDetailItem}>
                {detail}
              </div>
            ))}
          </div>
        ) : null}

        {feedback.code ? (
          <div style={styles.feedbackCode}>Code: {feedback.code}</div>
        ) : null}

        <div style={styles.modalActions}>
          <button type="button" style={styles.modalPrimaryButton} onClick={onClose}>
            {feedback.closeLabel || "Close"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BmdBgoPage() {
  const authContext = useAuth();
  const { activeWorkbase } = authContext || {};
  const { geoState, updateGeo } = useGeo();
  const warehouse = useWarehouse();
  const { available = {}, all = {} } = warehouse || {};

  const selectedLm = geoState?.selectedLm || null;
  const selectedWard = geoState?.selectedWard || null;

  const lmPcode = getActiveLmPcode(activeWorkbase, selectedLm);
  const lmName = getLmName(activeWorkbase, selectedLm);
  const wardOptions = useMemo(
    () =>
      buildWardOptions({
        availableWards: available?.wards,
        selectedWard,
      }),
    [available?.wards, selectedWard],
  );

  const initialWardPcode = getWardPcode(selectedWard || {}) || getWardPcode(wardOptions[0]);
  const [selectedWardPcode, setSelectedWardPcode] = useState(initialWardPcode || "");
  const [targetType, setTargetType] = useState("TEAM");
  const [targetId, setTargetId] = useState("");
  const [allocationsByGeofenceId, setAllocationsByGeofenceId] = useState({});
  const [selectedGeofenceGroupId, setSelectedGeofenceGroupId] = useState(null);
  const [dragTarget, setDragTarget] = useState(null);
  const [dragOverGeofenceGroupId, setDragOverGeofenceGroupId] = useState(null);
  const [createResult, setCreateResult] = useState(null);
  const [removeResult, setRemoveResult] = useState(null);
  const [removeCandidate, setRemoveCandidate] = useState(null);
  const [feedbackModal, setFeedbackModal] = useState(null);
  const [isCreateConfirmOpen, setIsCreateConfirmOpen] = useState(false);

  useEffect(() => {
    const activeWardPcode = getWardPcode(selectedWard || {});
    if (!selectedWardPcode && activeWardPcode) {
      setSelectedWardPcode(activeWardPcode);
      return;
    }

    if (!selectedWardPcode && wardOptions.length > 0) {
      setSelectedWardPcode(getWardPcode(wardOptions[0]));
    }
  }, [selectedWardPcode, selectedWard, wardOptions]);

  const selectedWardDoc = useMemo(() => {
    return wardOptions.find((ward) => getWardPcode(ward) === selectedWardPcode) || null;
  }, [wardOptions, selectedWardPcode]);

  const wardLabel = getWardLabel(selectedWardDoc, selectedWardPcode);
  const scopeReady = Boolean(lmPcode && selectedWardPcode);

  const {
    data: geofences = [],
    isLoading: geofencesLoading,
    isError: geofencesError,
    error: geofencesErrorData,
  } = useGetGeoFencesByWardQuery(
    { lmPcode, wardPcode: selectedWardPcode },
    { skip: !scopeReady },
  );

  const { data: availableTeams = [], isLoading: teamsLoading } =
    useGetAvailableTeamsQuery({ limit: 500 });

  const { data: availableServiceProviders = [], isLoading: serviceProvidersLoading } =
    useGetAvailableServiceProvidersQuery({ limit: 500 });

  const [createBgo, createBgoState] = useCreateBgoMutation();
  const [deleteUnacceptedBgo, deleteBgoState] = useDeleteUnacceptedBgoMutation();

  const {
    data: existingBmdBatches = [],
    isLoading: existingBmdBatchesLoading,
    isError: existingBmdBatchesError,
  } = useGetBmdBgoBatchesByWardQuery(
    { lmPcode, wardPcode: selectedWardPcode, limit: 500 },
    { skip: !scopeReady },
  );

  const existingAllocationByGeofenceId = useMemo(
    () => buildExistingAllocationByGeofenceId(existingBmdBatches),
    [existingBmdBatches],
  );

  const readyGroups = useMemo(
    () => buildGeofenceGroups({ geofences, all }),
    [geofences, all],
  );

  const activeAllocatedGeofenceCount = useMemo(
    () => Object.keys(existingAllocationByGeofenceId).length,
    [existingAllocationByGeofenceId],
  );

  const allocatableReadyGroups = useMemo(
    () =>
      readyGroups.filter(
        (group) => !existingAllocationByGeofenceId[group.geofenceId],
      ),
    [readyGroups, existingAllocationByGeofenceId],
  );

  useEffect(() => {
    const activeAllocatedGeofenceIds = new Set(
      Object.keys(existingAllocationByGeofenceId),
    );

    if (activeAllocatedGeofenceIds.size === 0) return;

    setAllocationsByGeofenceId((current) => {
      let changed = false;
      const next = { ...current };

      activeAllocatedGeofenceIds.forEach((geofenceId) => {
        if (next[geofenceId]) {
          delete next[geofenceId];
          changed = true;
        }
      });

      return changed ? next : current;
    });

    setSelectedGeofenceGroupId((current) =>
      activeAllocatedGeofenceIds.has(current) ? null : current,
    );
  }, [existingAllocationByGeofenceId]);

  const selectedGroup =
    allocatableReadyGroups.find(
      (group) => group.geofenceId === selectedGeofenceGroupId,
    ) ||
    allocatableReadyGroups[0] ||
    null;

  const targetOptions = useMemo(
    () =>
      buildTargetOptions({
        teams: availableTeams,
        serviceProviders: availableServiceProviders,
        targetType,
      }),
    [availableTeams, availableServiceProviders, targetType],
  );

  const selectedTargetOption =
    targetOptions.find((target) => target.id === targetId) || null;

  const selectedTargetPayload = useMemo(
    () => buildTargetPayload(selectedTargetOption),
    [selectedTargetOption],
  );

  const allocatedReadyGroups = useMemo(
    () => buildAllocatedReadyGroups(allocatableReadyGroups, allocationsByGeofenceId),
    [allocatableReadyGroups, allocationsByGeofenceId],
  );

  const unallocatedReadyGroupCount = Math.max(
    allocatableReadyGroups.length - allocatedReadyGroups.length,
    0,
  );

  const totalSummary = useMemo(
    () =>
      allocatableReadyGroups.reduce(
        (acc, group) => ({
          erfs: acc.erfs + safeNumber(group.erfCount),
          premises: acc.premises + safeNumber(group.premiseCount),
          meters: acc.meters + safeNumber(group.meterCount),
        }),
        { erfs: 0, premises: 0, meters: 0 },
      ),
    [allocatableReadyGroups],
  );

  const allocatedSummary = useMemo(
    () =>
      allocatedReadyGroups.reduce(
        (acc, group) => ({
          erfs: acc.erfs + safeNumber(group.erfCount),
          premises: acc.premises + safeNumber(group.premiseCount),
          meters: acc.meters + safeNumber(group.meterCount),
        }),
        { erfs: 0, premises: 0, meters: 0 },
      ),
    [allocatedReadyGroups],
  );

  const bgoCreateAuthority = resolveBgoCreateUiAuthority(authContext);
  const allocatedGroupsWithoutErfs = allocatedReadyGroups.filter(
    (group) => asArray(group.erfRefs).length === 0,
  );

  const canCreate =
    bgoCreateAuthority.ok &&
    scopeReady &&
    allocatedReadyGroups.length > 0 &&
    allocatedGroupsWithoutErfs.length === 0 &&
    !createBgoState.isLoading;

  const createDisabledReason = !bgoCreateAuthority.ok
    ? `${bgoCreateAuthority.message} Current authority resolved as ${bgoCreateAuthority.label}.`
    : !scopeReady
      ? "Select LM and ward first."
      : allocatableReadyGroups.length === 0
        ? activeAllocatedGeofenceCount > 0
          ? "All geofence groups in this ward already have active MD BGO allocations."
          : "No active geofence groups found for the selected ward."
        : allocatedReadyGroups.length === 0
          ? "Drag a TEAM/SP target onto at least one geofence group."
          : allocatedGroupsWithoutErfs.length > 0
            ? "Every allocated BMD geofence must have at least one ERF worklist item."
            : createBgoState.isLoading
              ? "Creating MD BGO allocation..."
              : `Ready to create ${allocatedReadyGroups.length} MD BGO allocation(s).`;

  function handleWardChange(event) {
    const nextWardPcode = event.target.value;
    const nextWard = wardOptions.find((ward) => getWardPcode(ward) === nextWardPcode) || null;

    setSelectedWardPcode(nextWardPcode);
    setAllocationsByGeofenceId({});
    setSelectedGeofenceGroupId(null);
    setCreateResult(null);
    setRemoveResult(null);
    setRemoveCandidate(null);
    setFeedbackModal(null);

    if (nextWard && typeof updateGeo === "function") {
      updateGeo({
        selectedWard: nextWard,
        lastSelectionType: "WARD",
      });
    }
  }

  function handleTargetTypeChange(nextType) {
    setTargetType(nextType);
    setTargetId("");
  }

  function handleSelectTarget(target) {
    const cleanTarget = buildTargetPayload(target);
    if (!cleanTarget) return;

    setTargetType(cleanTarget.type);
    setTargetId(cleanTarget.id);
  }

  function assignTargetToGeofenceGroup(group, target = selectedTargetPayload) {
    const cleanTarget = buildTargetPayload(target);

    if (!group?.geofenceId || !cleanTarget) return;
    if (existingAllocationByGeofenceId[group.geofenceId]) return;

    setSelectedGeofenceGroupId(group.geofenceId);
    setAllocationsByGeofenceId((current) => ({
      ...current,
      [group.geofenceId]: cleanTarget,
    }));
    setCreateResult(null);
    setFeedbackModal(null);
  }

  function clearTargetFromGeofenceGroup(geofenceId) {
    setAllocationsByGeofenceId((current) => {
      const next = { ...current };
      delete next[geofenceId];
      return next;
    });
    setCreateResult(null);
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
        console.warn("Could not parse dropped MD BGO target", error);
      }
    }

    return buildTargetPayload(dragTarget || selectedTargetPayload);
  }

  function handleDropTargetOnGroup(event, group) {
    event.preventDefault();
    setDragOverGeofenceGroupId(null);

    if (existingAllocationByGeofenceId[group?.geofenceId]) return;

    const droppedTarget = readDroppedTarget(event);
    if (!droppedTarget) return;

    assignTargetToGeofenceGroup(group, droppedTarget);
    setDragTarget(null);
  }

  function handleTargetDragEnter(event, group) {
    event.preventDefault();
    if (!group?.geofenceId) return;
    if (existingAllocationByGeofenceId[group.geofenceId]) return;

    const hasDragPayload = Boolean(dragTarget || selectedTargetPayload);
    if (!hasDragPayload) return;

    setDragOverGeofenceGroupId(group.geofenceId);
    event.dataTransfer.dropEffect = "copy";
  }

  function handleTargetDragLeave(event, group) {
    event.preventDefault();

    const currentTarget = event.currentTarget;
    const relatedTarget = event.relatedTarget;

    if (currentTarget?.contains?.(relatedTarget)) return;

    if (dragOverGeofenceGroupId === group?.geofenceId) {
      setDragOverGeofenceGroupId(null);
    }
  }

  function handleTargetDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleOpenCreateConfirm() {
    if (!canCreate) return;
    setFeedbackModal(null);
    setIsCreateConfirmOpen(true);
  }

  async function handleConfirmCreateBgo() {
    if (!canCreate || createBgoState.isLoading) return;

    const scope = {
      lmPcode,
      lmName,
      wardPcode: selectedWardPcode,
      wardName: wardLabel,
    };

    const createdResults = [];
    const failedResults = [];

    setCreateResult(null);
    setFeedbackModal(null);
    setIsCreateConfirmOpen(false);

    for (const group of allocatedReadyGroups) {
      const payload = buildCreatePayload({ group, scope });

      try {
        const response = await createBgo(payload).unwrap();
        createdResults.push({ group, response });
      } catch (error) {
        failedResults.push({
          group,
          error,
          code: error?.status || error?.data?.code || "BMD_BGO_CREATE_FAILED",
          message:
            error?.data?.message ||
            error?.message ||
            "Could not create MD BGO allocation.",
        });
      }
    }

    const batchIds = createdResults.flatMap((item) =>
      asArray(item?.response?.bgoBatchIds || item?.response?.batchIds).length > 0
        ? asArray(item?.response?.bgoBatchIds || item?.response?.batchIds)
        : item?.response?.bgoBatchId
          ? [item.response.bgoBatchId]
          : [],
    );

    setCreateResult({
      success: failedResults.length === 0,
      createdResults,
      failedResults,
      batchIds,
    });

    const createHasFailures = failedResults.length > 0;
    const createHasSuccess = createdResults.length > 0;

    setFeedbackModal({
      success: !createHasFailures,
      tone: createHasFailures ? (createHasSuccess ? "warning" : "danger") : "success",
      eyebrow: "MD BGO Allocation",
      title: createHasFailures
        ? createHasSuccess
          ? "MD BGO allocation partially completed"
          : "MD BGO allocation failed"
        : "MD BGO allocation created",
      badgeLabel: createHasFailures ? (createHasSuccess ? "PARTIAL" : "FAILED") : "SUCCESS",
      message: `Created: ${createdResults.length} • Failed: ${failedResults.length}`,
      details: [
        ...batchIds.map((batchId) => `Created batch: ${batchId}`),
        ...failedResults.map(
          (failure) =>
            `${failure.group?.geofenceName || "NAv"}: ${failure.code || "ERROR"} — ${failure.message || "Could not create MD BGO allocation."}`,
        ),
      ],
      code: createHasFailures ? "BMD_BGO_CREATE_REVIEW_REQUIRED" : "SUCCESS",
    });

    if (createdResults.length > 0) {
      setAllocationsByGeofenceId((current) => {
        const next = { ...current };

        createdResults.forEach((item) => {
          if (item?.group?.geofenceId) {
            delete next[item.group.geofenceId];
          }
        });

        return next;
      });

      setSelectedGeofenceGroupId((current) => {
        const createdGeofenceIds = new Set(
          createdResults.map((item) => item?.group?.geofenceId).filter(Boolean),
        );

        return createdGeofenceIds.has(current) ? null : current;
      });
    }
  }


  function handleOpenRemoveConfirm(batch) {
    if (!batch || !canRemoveBmdBatch(batch)) return;
    setRemoveCandidate(batch);
    setRemoveResult(null);
    setFeedbackModal(null);
  }

  async function handleConfirmRemoveBmdBatch() {
    if (!removeCandidate || deleteBgoState.isLoading) return;

    const batchId = getBatchId(removeCandidate);

    setFeedbackModal(null);

    try {
      const response = await deleteUnacceptedBgo({
        bgoBatchId: batchId,
        batchId,
      }).unwrap();

      const successMessage = response?.message || "MD BGO allocation removed successfully.";

      setRemoveResult({
        success: true,
        message: successMessage,
        batchId,
      });
      setFeedbackModal({
        success: true,
        tone: "success",
        eyebrow: "MD BGO Removal",
        title: "MD BGO allocation removed",
        badgeLabel: "SUCCESS",
        message: successMessage,
        details: [`Removed batch: ${batchId}`],
        code: response?.code || "SUCCESS",
      });
      setRemoveCandidate(null);
    } catch (error) {
      const failureMessage =
        error?.data?.message ||
        error?.message ||
        "Could not remove MD BGO allocation.";
      const failureCode = error?.status || error?.data?.code || "BMD_BGO_REMOVE_FAILED";

      setRemoveResult({
        success: false,
        message: failureMessage,
        code: failureCode,
        batchId,
      });
      setFeedbackModal({
        success: false,
        tone: "danger",
        eyebrow: "MD BGO Removal",
        title: "MD BGO remove failed or blocked",
        badgeLabel: "FAILED",
        message: failureMessage,
        details: [`Batch: ${batchId}`],
        code: failureCode,
      });
      setRemoveCandidate(null);
    }
  }

  const isLoading =
    geofencesLoading || teamsLoading || serviceProvidersLoading || existingBmdBatchesLoading;
  const errorMessage =
    geofencesErrorData?.message ||
    geofencesErrorData?.data?.message ||
    "Failed to load MD BGO context.";

  return (
    <section style={styles.page}>
      <div style={styles.backRow}>
        <Link to="/operations" style={styles.backLink}>
          ← Operations Overview
        </Link>
        <Link to="/operations/geo-fences" style={styles.backLink}>
          Geo-Fences
        </Link>
      </div>

      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Operations / MD BGO</p>
          <h2 style={styles.title}>Bulk Meter Discovery BGO</h2>
          <p style={styles.subtitle}>
            Select a ward, then drag a TEAM/SP target onto existing geofence
            groups. MD BGO creates bgo_batches only; meter discovery TRNs are
            created later in the field when meters are captured.
          </p>
        </div>

        <Badge tone="success">BMD MODE</Badge>
      </div>

      {isLoading ? <div style={styles.notice}>Loading MD BGO context...</div> : null}
      {geofencesError ? <div style={styles.errorNotice}>{errorMessage}</div> : null}

      <div style={styles.scopePanel}>
        <div style={styles.scopeMain}>
          <label style={styles.formLabel}>
            Ward
            <select
              style={styles.select}
              value={selectedWardPcode}
              onChange={handleWardChange}
              disabled={!lmPcode || wardOptions.length === 0}
            >
              <option value="">Select ward...</option>
              {wardOptions.map((ward) => {
                const pcode = getWardPcode(ward);
                return (
                  <option key={pcode} value={pcode}>
                    {getWardLabel(ward, pcode)}
                  </option>
                );
              })}
            </select>
          </label>

          <div style={styles.scopeHelp}>
            LM: <strong>{lmName}</strong> ({lmPcode || "NAv"}) • Selected ward: <strong>{wardLabel}</strong>
          </div>
        </div>

        <div style={styles.summaryMetricGrid}>
          <InfoCard label="Ready Geofences" value={allocatableReadyGroups.length} />
          <InfoCard label="Allocated Geofences" value={activeAllocatedGeofenceCount} />
          <InfoCard label="ERFs" value={totalSummary.erfs} />
          <InfoCard label="Premises" value={totalSummary.premises} />
          <InfoCard label="Meters" value={totalSummary.meters} />
        </div>
      </div>

      <div style={styles.infoBanner}>
        <strong>MD BGO allocation board:</strong> drag TEAM/SP target cards onto
        geofence groups. This mirrors the AST-focused BGO allocation approach,
        but the work source is ward geofences instead of TC rows.
      </div>

      {!scopeReady ? (
        <div style={styles.warningBox}>
          Select an LM and Ward first. MD BGO is always ward scoped.
        </div>
      ) : null}

      <section style={styles.boardGrid}>
        <section style={styles.leftColumn}>
          <div style={styles.panel}>
            <div style={styles.panelHeaderCompact}>
              <div>
                <h3 style={styles.panelTitle}>BGO Target Setup</h3>
                <p style={styles.panelSubtitle}>
                  Select or drag an available TEAM or SUBC SP. Drop it onto the
                  geofence group that must receive the MD BGO allocation.
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
                No active {targetType === "TEAM" ? "teams" : "SUBC service providers"} found.
              </div>
            ) : (
              <div style={styles.targetOptionList}>
                {targetOptions.map((target) => {
                  const selected = target.id === targetId;

                  return (
                    <button
                      type="button"
                      key={`${target.type}_${target.id}`}
                      draggable
                      style={{
                        ...styles.targetOptionCard,
                        ...(selected ? styles.targetOptionCardActive : null),
                        ...(dragTarget?.id === target.id ? styles.targetOptionCardDragging : null),
                      }}
                      onClick={() => handleSelectTarget(target)}
                      onDragStart={(event) => handleTargetDragStart(event, target)}
                      onDragEnd={handleTargetDragEnd}
                      title={`Select or drag ${target.type} ${target.name} onto a geofence group`}
                    >
                      <div style={styles.targetOptionHeader}>
                        <span style={styles.targetType}>{target.type}</span>
                        <strong style={styles.targetTitle}>{target.name}</strong>
                      </div>
                      <p style={styles.targetSub}>{getTargetOptionSubtitle(target)}</p>
                      <span style={styles.targetMicro}>{getTargetOptionMicroText(target)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div style={styles.panel}>
            <h3 style={styles.panelTitle}>Selected Target</h3>
            {selectedTargetPayload ? (
              <div style={styles.selectedTargetCard}>
                <span style={styles.targetType}>{selectedTargetPayload.type}</span>
                <strong>{selectedTargetPayload.name}</strong>
                <span style={styles.targetMicro}>{selectedTargetPayload.id}</span>
              </div>
            ) : (
              <div style={styles.emptyState}>Select or drag a TEAM/SP target.</div>
            )}
          </div>
        </section>

        <section style={styles.panel}>
          <div style={styles.panelHeaderCompact}>
            <div>
              <h3 style={styles.panelTitle}>Ready Geofence Groups</h3>
              <p style={styles.panelSubtitle}>
                Unallocated geofence groups for {wardLabel}. Drop a TEAM/SP target
                on a geofence card to allocate it.
              </p>
            </div>
            <Badge tone={allocatableReadyGroups.length > 0 ? "success" : "warning"}>
              {allocatableReadyGroups.length} group(s)
            </Badge>
          </div>

          {allocatableReadyGroups.length === 0 ? (
            <div style={styles.emptyState}>
              {activeAllocatedGeofenceCount > 0
                ? "All geofence groups in this ward already have active MD BGO allocations. Remove, reject, or close an allocation before creating another one on the same geofence."
                : "No active geofences found for the selected ward."}
            </div>
          ) : (
            <div style={styles.groupList}>
              {allocatableReadyGroups.map((group) => {
                const assignedTarget = allocationsByGeofenceId[group.geofenceId] || null;
                const existingAllocation = existingAllocationByGeofenceId[group.geofenceId] || null;
                const alreadyAllocated = Boolean(existingAllocation);
                const active = selectedGroup?.geofenceId === group.geofenceId;
                const dragFocused = dragOverGeofenceGroupId === group.geofenceId;

                return (
                  <div
                    key={group.geofenceId}
                    style={{
                      ...styles.groupCard,
                      ...(active ? styles.groupCardActive : null),
                      ...(assignedTarget ? styles.groupCardAllocated : null),
                      ...(alreadyAllocated ? styles.groupCardExistingAllocated : null),
                      ...(dragFocused ? styles.groupCardDragFocused : null),
                    }}
                    onDragEnter={(event) => handleTargetDragEnter(event, group)}
                    onDragOver={handleTargetDragOver}
                    onDragLeave={(event) => handleTargetDragLeave(event, group)}
                    onDrop={(event) => handleDropTargetOnGroup(event, group)}
                  >
                    <div style={styles.groupMain}>
                      <button
                        type="button"
                        style={styles.groupSelectButton}
                        onClick={() => setSelectedGeofenceGroupId(group.geofenceId)}
                      >
                        <span style={styles.groupTitleRow}>
                          <strong style={styles.groupTitle}>{group.geofenceName}</strong>
                          {alreadyAllocated ? <Badge tone="warning">Allocated</Badge> : null}
                        </span>
                        <span style={styles.groupSub}>{group.geofenceDescription}</span>
                        <span style={styles.groupMeta}>GF ID: {group.geofenceId}</span>
                        {alreadyAllocated ? (
                          <span style={styles.groupMeta}>
                            Existing MD BGO: {getTargetLabel(existingAllocation.target)} • {getBatchWorkflowState(existingAllocation)}
                          </span>
                        ) : null}
                      </button>

                      <div style={styles.groupStatsGrid}>
                        <InfoCard label="ERFs" value={group.erfCount} />
                        <InfoCard label="Premises" value={group.premiseCount} />
                        <InfoCard label="Meters" value={group.meterCount} />
                      </div>
                    </div>

                    <div style={styles.groupAllocationBoxWrap}>
                      <div
                        style={{
                          ...styles.groupAllocationBox,
                          ...(assignedTarget ? styles.groupAllocationBoxAssigned : null),
                          ...(dragFocused ? styles.groupAllocationBoxDragFocused : null),
                        }}
                      >
                        <span style={styles.groupAllocationLabel}>Assigned target</span>
                        <strong style={styles.groupAllocationTarget}>
                          {assignedTarget ? getTargetLabel(assignedTarget) : "Drop TEAM/SP here"}
                        </strong>
                        {assignedTarget ? (
                          <button
                            type="button"
                            style={styles.clearButton}
                            onClick={() => clearTargetFromGeofenceGroup(group.geofenceId)}
                          >
                            Clear
                          </button>
                        ) : (
                          <button
                            type="button"
                            style={{
                              ...styles.assignButton,
                              ...(selectedTargetPayload ? styles.assignButtonEnabled : null),
                            }}
                            disabled={!selectedTargetPayload}
                            onClick={() => assignTargetToGeofenceGroup(group)}
                          >
                            Assign selected
                          </button>
                        )}
                      </div>

                      <Link
                        to={createGeofenceMapRoute({
                          lmPcode,
                          wardPcode: selectedWardPcode,
                          group,
                        })}
                        style={styles.openMapLink}
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
        <div style={styles.panelHeaderCompact}>
          <div>
            <h3 style={styles.panelTitle}>Allocation Review</h3>
            <p style={styles.panelSubtitle}>
              This is the single review table before MD BGO creation. Each row
              becomes one BMD-BGO batch in the existing bgo_batches collection.
            </p>
          </div>
          <button
            type="button"
            style={{
              ...styles.createButton,
              ...(canCreate ? styles.createButtonEnabled : null),
            }}
            disabled={!canCreate}
            onClick={handleOpenCreateConfirm}
            title={createDisabledReason}
          >
            {createBgoState.isLoading ? "Creating MD BGO..." : "Create MD BGO"}
          </button>
        </div>

        <div style={styles.reviewSummaryRow}>
          <InfoCard label="Allocated Groups" value={allocatedReadyGroups.length} />
          <InfoCard label="Unallocated Groups" value={unallocatedReadyGroupCount} />
          <InfoCard label="Allocated ERFs" value={allocatedSummary.erfs} />
          <InfoCard label="Allocated Premises" value={allocatedSummary.premises} />
          <InfoCard label="Allocated Meters" value={allocatedSummary.meters} />
        </div>

        {allocatedReadyGroups.length === 0 ? (
          <div style={styles.emptyState}>No geofence groups allocated yet.</div>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <Th>Geofence</Th>
                  <Th>Target</Th>
                  <Th>ERFs</Th>
                  <Th>Premises</Th>
                  <Th>Meters</Th>
                  <Th>Status</Th>
                  <Th>Action</Th>
                </tr>
              </thead>
              <tbody>
                {allocatedReadyGroups.map((group) => {
                  const ready = asArray(group.erfRefs).length > 0;
                  const existingAllocation = existingAllocationByGeofenceId[group.geofenceId] || null;

                  return (
                    <tr key={group.geofenceId}>
                      <Td strong>{group.geofenceName}</Td>
                      <Td>{getTargetLabel(group.allocationTarget)}</Td>
                      <Td>{group.erfCount}</Td>
                      <Td>{group.premiseCount}</Td>
                      <Td>{group.meterCount}</Td>
                      <Td>
                        <Badge tone={!ready || existingAllocation ? "warning" : "success"}>
                          {!ready
                            ? "NO_ERF_WORKLIST"
                            : existingAllocation
                              ? "ALREADY_ALLOCATED"
                              : "READY_TO_CREATE"}
                        </Badge>
                      </Td>
                      <Td>
                        <button
                          type="button"
                          style={styles.tableActionButton}
                          onClick={() => clearTargetFromGeofenceGroup(group.geofenceId)}
                        >
                          Remove
                        </button>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={styles.createReason}>{createDisabledReason}</div>

        {/* Create feedback is shown in the outcome modal after submission. */}
      </section>

      <section style={styles.panel}>
        <div style={styles.panelHeaderCompact}>
          <div>
            <h3 style={styles.panelTitle}>Existing MD BGO Allocations</h3>
            <p style={styles.panelSubtitle}>
              Remove is only available while the allocation is still ISSUED and no
              BMD premises or meters have been created under it.
            </p>
          </div>
          <Badge tone={existingBmdBatches.length > 0 ? "success" : "neutral"}>
            {existingBmdBatches.length} allocation(s)
          </Badge>
        </div>

        {existingBmdBatchesError ? (
          <div style={styles.errorNotice}>Could not load existing MD BGO allocations.</div>
        ) : existingBmdBatches.length === 0 ? (
          <div style={styles.emptyState}>No MD BGO allocations found for this ward.</div>
        ) : (
          <div style={styles.existingBatchList}>
            {existingBmdBatches.map((batch) => (
              <ExistingBmdAllocationCard
                key={getBatchId(batch)}
                batch={batch}
                isDeleting={deleteBgoState.isLoading}
                onRemove={handleOpenRemoveConfirm}
              />
            ))}
          </div>
        )}

        {/* Remove feedback is shown in the outcome modal after the backend responds. */}
      </section>



      {removeCandidate ? (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard}>
            <div style={styles.modalHeader}>
              <div>
                <p style={styles.eyebrow}>Remove MD BGO Allocation</p>
                <h3 style={styles.modalTitle}>Confirm remove?</h3>
                <p style={styles.modalSubtitle}>
                  This will remove the MD BGO allocation from bgo_batches. The
                  backend will still block the remove if any BMD premise, meter,
                  or discovery TRN has already been created under this batch.
                </p>
              </div>
              <Badge tone="danger">REMOVE</Badge>
            </div>

            <div style={styles.modalAllocationList}>
              <div style={styles.modalAllocationRow}>
                <div style={styles.modalAllocationIndex}>GF</div>
                <div>
                  <strong>{removeCandidate.geofenceName || "NAv"}</strong>
                  <span style={styles.modalAllocationMeta}>
                    Target: {getTargetLabel(removeCandidate.target)}
                  </span>
                  <span style={styles.modalAllocationMeta}>
                    Batch: {getBatchId(removeCandidate)}
                  </span>
                  <span style={styles.modalAllocationMeta}>
                    Status: {getBatchWorkflowState(removeCandidate)} • {getBatchReleaseState(removeCandidate)}
                  </span>
                  <span style={styles.modalAllocationMeta}>
                    BMD Premises Created: {getBatchBmdCreatedPremiseCount(removeCandidate)} • BMD Meters Created: {getBatchBmdCreatedMeterCount(removeCandidate)}
                  </span>
                  <span style={styles.modalAllocationWarning}>
                    {getRemoveDisabledReason(removeCandidate)}
                  </span>
                </div>
              </div>
            </div>

            <div style={styles.modalActions}>
              <button
                type="button"
                style={styles.modalCancelButton}
                onClick={() => setRemoveCandidate(null)}
                disabled={deleteBgoState.isLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                style={styles.modalDangerButton}
                onClick={handleConfirmRemoveBmdBatch}
                disabled={deleteBgoState.isLoading}
              >
                {deleteBgoState.isLoading ? "Removing..." : "Confirm Remove"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isCreateConfirmOpen ? (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard}>
            <div style={styles.modalHeader}>
              <div>
                <p style={styles.eyebrow}>Confirm MD BGO</p>
                <h3 style={styles.modalTitle}>Create MD BGO allocation?</h3>
                <p style={styles.modalSubtitle}>
                  iREPS will create {allocatedReadyGroups.length} BMD-BGO batch
                  document(s). No child METER_DISCOVERY TRNs will be created
                  upfront.
                </p>
              </div>
              <Badge tone="warning">REVIEW</Badge>
            </div>

            <div style={styles.modalAllocationList}>
              {allocatedReadyGroups.map((group, index) => (
                <div key={group.geofenceId} style={styles.modalAllocationRow}>
                  <div style={styles.modalAllocationIndex}>{index + 1}</div>
                  <div>
                    <strong>{group.geofenceName}</strong>
                    <span style={styles.modalAllocationMeta}>
                      {getTargetLabel(group.allocationTarget)} • {group.erfCount} ERF(s), {group.premiseCount} premise(s), {group.meterCount} meter(s)
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div style={styles.modalActions}>
              <button
                type="button"
                style={styles.modalCancelButton}
                onClick={() => setIsCreateConfirmOpen(false)}
                disabled={createBgoState.isLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                style={styles.modalPrimaryButton}
                onClick={handleConfirmCreateBgo}
                disabled={createBgoState.isLoading}
              >
                {createBgoState.isLoading ? "Creating..." : "Confirm Create"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <FeedbackModal
        feedback={feedbackModal}
        onClose={() => setFeedbackModal(null)}
      />
    </section>
  );
}

const styles = {
  page: {
    padding: 24,
    display: "grid",
    gap: 16,
  },
  backRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  backLink: {
    display: "inline-flex",
    alignItems: "center",
    border: "1px solid #cbd5e1",
    borderRadius: 999,
    background: "#ffffff",
    color: "#0f172a",
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
    display: "flex",
    justifyContent: "space-between",
    gap: 14,
    alignItems: "flex-start",
  },
  eyebrow: {
    margin: 0,
    fontSize: 12,
    fontWeight: 900,
    color: "#059669",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  title: {
    margin: "8px 0 8px",
    color: "#0f172a",
    fontSize: 28,
  },
  subtitle: {
    margin: 0,
    maxWidth: 900,
    color: "#64748b",
    lineHeight: 1.6,
  },
  notice: {
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    color: "#1e3a8a",
    borderRadius: 16,
    padding: 14,
    fontWeight: 800,
  },
  errorNotice: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#991b1b",
    borderRadius: 16,
    padding: 14,
    fontWeight: 800,
  },
  warningBox: {
    background: "#fffbeb",
    border: "1px solid #fde68a",
    color: "#92400e",
    borderRadius: 16,
    padding: 14,
    fontWeight: 800,
  },
  infoBanner: {
    background: "#ecfdf5",
    border: "1px solid #bbf7d0",
    color: "#065f46",
    borderRadius: 18,
    padding: 16,
    lineHeight: 1.55,
    fontSize: 14,
  },
  scopePanel: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 22,
    padding: 18,
    display: "grid",
    gridTemplateColumns: "minmax(280px, 420px) 1fr",
    gap: 16,
    alignItems: "end",
  },
  scopeMain: {
    display: "grid",
    gap: 8,
  },
  scopeHelp: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: 800,
  },
  formLabel: {
    display: "grid",
    gap: 6,
    color: "#334155",
    fontSize: 12,
    fontWeight: 900,
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
  summaryMetricGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 10,
  },
  infoCard: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    padding: 12,
    display: "grid",
    gap: 4,
  },
  infoLabel: {
    color: "#64748b",
    fontSize: 10,
    fontWeight: 900,
    textTransform: "uppercase",
  },
  infoValue: {
    color: "#0f172a",
    fontSize: 16,
    fontWeight: 900,
  },
  boardGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(300px, 0.85fr) minmax(420px, 1.15fr)",
    gap: 16,
    alignItems: "start",
  },
  leftColumn: {
    display: "grid",
    gap: 16,
  },
  panel: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 22,
    padding: 18,
    boxShadow: "0 10px 25px rgba(15, 23, 42, 0.05)",
  },
  panelHeaderCompact: {
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
  targetOptionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 8,
  },
  targetType: {
    display: "inline-flex",
    borderRadius: 999,
    background: "#eff6ff",
    color: "#1d4ed8",
    padding: "5px 9px",
    fontSize: 10,
    fontWeight: 900,
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
  targetMicro: {
    display: "block",
    color: "#64748b",
    fontSize: 11,
    fontWeight: 800,
    marginTop: 6,
    wordBreak: "break-word",
  },
  selectedTargetCard: {
    display: "grid",
    gap: 8,
    border: "1px solid #bbf7d0",
    borderRadius: 16,
    background: "#f0fdf4",
    padding: 14,
  },
  groupList: {
    display: "grid",
    gap: 10,
  },
  groupCard: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(220px, 280px)",
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
  groupCardExistingAllocated: {
    borderColor: "#f59e0b",
    background: "#fffbeb",
  },
  groupCardDragFocused: {
    borderColor: "#f59e0b",
    background: "#fffbeb",
    boxShadow: "0 0 0 4px rgba(245, 158, 11, 0.18)",
    transform: "translateY(-1px)",
  },
  groupMain: {
    display: "grid",
    gap: 12,
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
  groupTitleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  groupTitle: {
    display: "block",
    color: "#0f172a",
    fontSize: 15,
    fontWeight: 900,
    minWidth: 0,
  },
  groupSub: {
    display: "block",
    color: "#64748b",
    fontSize: 12,
    marginTop: 3,
  },
  groupMeta: {
    display: "block",
    color: "#94a3b8",
    fontSize: 11,
    marginTop: 5,
    fontWeight: 800,
  },
  groupStatsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 8,
  },
  groupAllocationBoxWrap: {
    display: "grid",
    gap: 8,
    alignContent: "start",
  },
  groupAllocationBox: {
    border: "1px dashed #cbd5e1",
    borderRadius: 14,
    background: "#f8fafc",
    padding: 10,
    minWidth: 0,
    display: "grid",
    gap: 8,
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
  },
  groupAllocationTarget: {
    display: "block",
    color: "#0f172a",
    fontSize: 12,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  assignButton: {
    border: "1px solid #cbd5e1",
    borderRadius: 12,
    background: "#ffffff",
    color: "#94a3b8",
    padding: "8px 10px",
    fontSize: 11,
    fontWeight: 900,
    cursor: "not-allowed",
  },
  assignButtonEnabled: {
    color: "#047857",
    borderColor: "#86efac",
    background: "#ecfdf5",
    cursor: "pointer",
  },
  clearButton: {
    border: "1px solid #86efac",
    borderRadius: 12,
    background: "#ffffff",
    color: "#047857",
    padding: "8px 10px",
    fontSize: 11,
    fontWeight: 900,
    cursor: "pointer",
  },
  openMapLink: {
    display: "inline-flex",
    justifyContent: "center",
    border: "1px solid #cbd5e1",
    borderRadius: 999,
    background: "#ffffff",
    color: "#0f172a",
    padding: "7px 10px",
    fontSize: 11,
    fontWeight: 900,
    textDecoration: "none",
  },
  reviewSummaryRow: {
    display: "grid",
    gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
    gap: 10,
    marginBottom: 14,
  },
  tableWrap: {
    overflowX: "auto",
    border: "1px solid #e2e8f0",
    borderRadius: 16,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    minWidth: 780,
    background: "#ffffff",
  },
  th: {
    background: "#f8fafc",
    color: "#475569",
    fontSize: 11,
    fontWeight: 900,
    textTransform: "uppercase",
    padding: "12px 10px",
    textAlign: "left",
    borderBottom: "1px solid #e2e8f0",
  },
  td: {
    color: "#334155",
    fontSize: 13,
    fontWeight: 700,
    padding: "12px 10px",
    borderBottom: "1px solid #f1f5f9",
  },
  tdStrong: {
    color: "#0f172a",
    fontWeight: 900,
  },
  tableActionButton: {
    border: "1px solid #cbd5e1",
    borderRadius: 999,
    background: "#ffffff",
    color: "#0f172a",
    padding: "7px 10px",
    fontSize: 11,
    fontWeight: 900,
    cursor: "pointer",
  },
  createButton: {
    border: "1px solid #cbd5e1",
    borderRadius: 14,
    background: "#e2e8f0",
    color: "#64748b",
    padding: "11px 14px",
    fontSize: 13,
    fontWeight: 900,
    cursor: "not-allowed",
  },
  createButtonEnabled: {
    borderColor: "#059669",
    background: "#059669",
    color: "#ffffff",
    cursor: "pointer",
  },
  createReason: {
    marginTop: 12,
    color: "#64748b",
    fontSize: 12,
    fontWeight: 800,
  },
  emptyState: {
    background: "#f8fafc",
    border: "1px dashed #cbd5e1",
    color: "#64748b",
    borderRadius: 16,
    padding: 16,
    textAlign: "center",
    fontWeight: 800,
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    padding: "6px 10px",
    fontSize: 11,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  badge_success: {
    background: "#dcfce7",
    color: "#166534",
  },
  badge_warning: {
    background: "#fef3c7",
    color: "#92400e",
  },
  badge_danger: {
    background: "#fee2e2",
    color: "#991b1b",
  },
  badge_neutral: {
    background: "#f1f5f9",
    color: "#475569",
  },
  resultBox: {
    marginTop: 14,
    borderRadius: 16,
    padding: 14,
    fontSize: 13,
  },
  resultSuccess: {
    background: "#ecfdf5",
    border: "1px solid #bbf7d0",
    color: "#065f46",
  },
  resultError: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#991b1b",
  },
  resultText: {
    margin: "6px 0 0",
  },
  resultList: {
    display: "grid",
    gap: 4,
    marginTop: 10,
    fontWeight: 800,
    wordBreak: "break-word",
  },
  feedbackDetailList: {
    display: "grid",
    gap: 8,
    marginTop: 14,
  },
  feedbackDetailItem: {
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    background: "#f8fafc",
    color: "#334155",
    padding: "9px 11px",
    fontSize: 12,
    fontWeight: 800,
    wordBreak: "break-word",
  },
  feedbackCode: {
    marginTop: 12,
    color: "#64748b",
    fontSize: 12,
    fontWeight: 900,
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(15, 23, 42, 0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    zIndex: 1000,
  },
  modalCard: {
    width: "min(720px, 100%)",
    maxHeight: "90vh",
    overflow: "auto",
    background: "#ffffff",
    borderRadius: 24,
    border: "1px solid #e2e8f0",
    padding: 22,
    boxShadow: "0 22px 60px rgba(15, 23, 42, 0.22)",
  },
  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    alignItems: "flex-start",
    marginBottom: 16,
  },
  modalTitle: {
    margin: "8px 0 6px",
    color: "#0f172a",
  },
  modalSubtitle: {
    margin: 0,
    color: "#64748b",
    lineHeight: 1.5,
  },
  modalAllocationList: {
    display: "grid",
    gap: 10,
  },
  modalAllocationRow: {
    display: "grid",
    gridTemplateColumns: "42px 1fr",
    gap: 12,
    alignItems: "center",
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    padding: 12,
    background: "#f8fafc",
  },
  modalAllocationIndex: {
    width: 34,
    height: 34,
    borderRadius: 999,
    background: "#ecfdf5",
    color: "#047857",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 900,
  },
  modalAllocationMeta: {
    display: "block",
    marginTop: 4,
    color: "#64748b",
    fontSize: 12,
    fontWeight: 800,
  },
  modalActions: {
    marginTop: 18,
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
  },
  modalCancelButton: {
    border: "1px solid #cbd5e1",
    borderRadius: 12,
    background: "#ffffff",
    color: "#0f172a",
    padding: "10px 14px",
    fontWeight: 900,
    cursor: "pointer",
  },

  existingBatchList: {
    display: "grid",
    gap: 12,
  },
  existingBatchCard: {
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    background: "#ffffff",
    padding: 14,
  },
  existingBatchMain: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "flex-start",
    marginBottom: 12,
  },
  existingBatchTitle: {
    display: "block",
    color: "#0f172a",
    fontSize: 14,
    fontWeight: 900,
  },
  existingBatchSub: {
    display: "block",
    color: "#64748b",
    fontSize: 11,
    fontWeight: 800,
    marginTop: 4,
    wordBreak: "break-word",
  },
  existingBatchGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 10,
  },
  existingBatchFooter: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    marginTop: 12,
  },
  existingBatchReason: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: 800,
  },
  dangerOutlineButton: {
    border: "1px solid #fecaca",
    borderRadius: 999,
    background: "#f8fafc",
    color: "#94a3b8",
    padding: "8px 12px",
    fontSize: 11,
    fontWeight: 900,
    cursor: "not-allowed",
    whiteSpace: "nowrap",
  },
  dangerOutlineButtonEnabled: {
    background: "#ffffff",
    color: "#b91c1c",
    borderColor: "#fca5a5",
    cursor: "pointer",
  },
  modalPrimaryButton: {
    border: "1px solid #059669",
    borderRadius: 12,
    background: "#059669",
    color: "#ffffff",
    padding: "10px 14px",
    fontWeight: 900,
    cursor: "pointer",
  },
  modalDangerButton: {
    border: "1px solid #dc2626",
    borderRadius: 12,
    background: "#dc2626",
    color: "#ffffff",
    padding: "10px 14px",
    fontWeight: 900,
    cursor: "pointer",
  },
};
