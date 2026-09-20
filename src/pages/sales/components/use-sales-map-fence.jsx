/* eslint-disable no-unused-vars -- JSX tags are used by React. */
// Targeted Batch rules TB-R055 (1.3.47): draw a GPS batch geofence on the GPS Sales map, with a live
// count of the meters that can be batched (at most 30), save it as the batch's own geofence, then
// hand its meters to the table. The geofence tools are the ones TB Draft and Geo-Fences use.
import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, documentId, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../../firebase";
import { useCreateGeoFenceMutation } from "../../../redux/geofencesApi";
import { useResolveSalesTargetedBatchMutation } from "../../../redux/salesTargetedBatchApi";
import { buildTargetedBatchDraftId } from "../../../redux/targetedBatchDraftModel";
import { mapPoint } from "../../../features/maps/sales-batch-nearby.js";
import { GeofenceDrawingBar, GeofenceDialogs } from "../../operations/geofence-shared-ui";
import { DraftGeoFenceLayer } from "../../operations/geofence-map-layers";
import GeofenceProgressModal from "../../operations/targeted-batches/draft/geofence-progress-modal.jsx";
import BatchCreationModal from "../../operations/targeted-batches/draft/batch-creation-modal.jsx";
import { GEOFENCE_PROGRESS_TIMEOUT_MS } from "../../operations/targeted-batches/draft/geofence-progress.js";
import { salesDraftMessage } from "../../operations/targeted-batches/draft/sales-batch-draft-model";
import { composeGeofenceName, geofenceNamePart, wardNumberFromPcode, findDuplicateGeofence, duplicateGeofenceNameMessage } from "../../../../functions/geofences/geofence-name.js";
import { chunks, inGroups } from "../../../../functions/targetedBatches/sales-map-fence.js";
import { salesMapFenceCount, salesMapFenceCountText, salesMapFenceErfIds, salesMapFenceLeftOut, salesMapFenceProgress } from "../models/salesMapFenceModel.js";
import { salesMapLayerDrawNotes, salesMapLayerDrawStats } from "../models/salesMapLayersModel.js";

const EMPTY_ERFS = new Map();
const NO_PLANNING = Object.freeze({ model: {}, visibility: {}, ready: false });
const TONES = { ok: "#166534", info: "#334155", busy: "#334155", error: "#b91c1c" };

// The ERF centroids of the Ward's meters that can be batched, read (a few requests at a time) when
// drawing starts.
function useSalesMapFenceErfs(erfIds, enabled) {
  const key = enabled && erfIds.length ? erfIds.join("|") : "";
  const [state, setState] = useState({ key: "", erfsById: EMPTY_ERFS, error: "" });
  useEffect(() => {
    if (!key) return undefined;
    let active = true;
    (async () => {
      const erfsById = new Map();
      try {
        const snapshots = await inGroups(chunks(key.split("|")), ids => getDocs(query(collection(db, "ireps_erfs"), where(documentId(), "in", ids))), 6);
        snapshots.forEach(snapshot => snapshot.docs.forEach(item => erfsById.set(item.id, item.data())));
        if (active) setState({ key, erfsById, error: "" });
      } catch {
        if (active) setState({ key, erfsById: EMPTY_ERFS, error: "The ERFs of this Ward could not be read, so the meters cannot be counted. Cancel and try again." });
      }
    })();
    return () => { active = false; };
  }, [key]);
  const ready = !key || state.key === key;
  return { erfsById: key && ready ? state.erfsById : EMPTY_ERFS, loading: !ready, error: key && ready ? state.error : "" };
}

// The saved geofence, watched directly, so linking is seen whatever the map shows meanwhile.
function useWatchedFence(fenceId) {
  const [fence, setFence] = useState(null);
  useEffect(() => {
    if (!fenceId) return undefined;
    return onSnapshot(doc(db, "geo_fences", fenceId), snapshot => setFence(snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } : null), () => {});
  }, [fenceId]);
  return fence?.id === fenceId ? fence : null;
}

// `drawing` (useGeofencePolygonDraft) is owned by the map section, as TB Draft's page owns its own:
// the Map Layers also need the points of the shape being drawn, to load only near it (1.3.63).
export function useSalesMapFence({ drawing, planning = NO_PLANNING, canDraw = false, lmPcode = "", wardPcode = "", wardLabel = "", rows = [], categoryMonth = null, wardGeofences = [], onSaved }) {
  const [resolve] = useResolveSalesTargetedBatchMutation();
  const [createGeoFence] = useCreateGeoFenceMutation();
  const [createModalOpen, setCreateModalOpen] = useState(false), [confirmOpen, setConfirmOpen] = useState(false);
  const [draftName, setDraftName] = useState(""), [draftDescription, setDraftDescription] = useState("");
  const [dialogError, setDialogError] = useState(""), [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(null), [failure, setFailure] = useState(null);
  // The Ward the geofence is drawn for, fixed when drawing starts (the Ward controls are locked
  // meanwhile; if it still changes, Save is refused).
  const [drawWard, setDrawWard] = useState(null);
  const isCreateMode = drawing.drawing;
  const ward = isCreateMode && drawWard ? drawWard : { pcode: wardPcode, number: wardNumberFromPcode(wardPcode), label: wardLabel };
  const wardChanged = Boolean(isCreateMode && drawWard && drawWard.pcode !== wardPcode);
  const standardName = composeGeofenceName(ward.number, geofenceNamePart(draftName));
  const busy = Boolean(createModalOpen || isCreateMode || confirmOpen || saving || progress || failure);

  const erfIds = useMemo(() => salesMapFenceErfIds(rows, { lmPcode, categoryMonth }), [rows, lmPcode, categoryMonth]);
  const erfs = useSalesMapFenceErfs(erfIds, isCreateMode || confirmOpen);
  const count = useMemo(() => salesMapFenceCount({ points: drawing.points, rows, erfsById: erfs.erfsById, lmPcode, wardPcode: ward.pcode, categoryMonth }),
    [drawing.points, rows, erfs.erfsById, lmPcode, ward.pcode, categoryMonth]);
  const countText = wardChanged
    ? { tone: "error", text: `The Ward changed. This geofence is being drawn for ${drawWard.label}: select it again, or Cancel.` }
    : salesMapFenceCountText({ pointsCount: drawing.points.length, count, loading: erfs.loading, error: erfs.error });
  // TB-R055.7: ERFs, Sales, Premises and Assets inside the shape, for the ticked layers.
  const draftPreviewStats = useMemo(() => salesMapLayerDrawStats({ draftPoints: drawing.points, ...planning }), [drawing.points, planning]);
  const layerNotes = useMemo(() => salesMapLayerDrawNotes({ draftPoints: drawing.points, ...planning }), [drawing.points, planning]);
  const completeness = layerNotes.length ? <div role="status" style={{ color: "#92400e", fontSize: 13 }}>{layerNotes.map(note => <span key={note} style={{ display: "block" }}>{note}</span>)}</div> : null;
  const canSave = Boolean(count.canSave && !wardChanged && !erfs.loading && !erfs.error && !saving && standardName);
  const canStart = Boolean(canDraw && lmPcode && wardPcode && !busy);

  const changeName = value => { setDraftName(value); setDialogError(""); };
  // Not while a save runs: its result decides whether the drawing is still needed.
  const cancel = () => { if (saving) return; drawing.clear(); setConfirmOpen(false); setDraftName(""); setDraftDescription(""); setDialogError(""); setDrawWard(null); };
  const handleStartDrawing = () => {
    if (!geofenceNamePart(draftName).trim()) { setDialogError(`Type a name after "Gf W${ward.number}".`); return; }
    const duplicate = findDuplicateGeofence(standardName, wardGeofences);
    if (duplicate) { setDialogError(duplicateGeofenceNameMessage(duplicate)); return; }
    setDrawWard({ pcode: wardPcode, number: wardNumberFromPcode(wardPcode), label: wardLabel });
    drawing.clear(); drawing.setDrawing(true); setCreateModalOpen(false); setDialogError("");
  };
  const handleMapClick = event => {
    if (!isCreateMode || saving) return;
    const point = mapPoint(event.detail?.latLng);
    if (point) drawing.addPoint(point);
  };

  // Save: locate the meters (GPS: from the Sales record, no Google), then save the geofence as the
  // batch's own; the server counts again and refuses more than 30 (TB-R055.3, .4). A counted meter
  // that cannot be made ready is left out and named.
  const handleConfirmCreate = async () => {
    if (!canSave) return;
    const duplicate = findDuplicateGeofence(standardName, wardGeofences);
    if (duplicate) { setDialogError(duplicateGeofenceNameMessage(duplicate)); return; }
    const counted = count.batchableIds, tbId = buildTargetedBatchDraftId(), name = standardName, saveWard = ward;
    const points = drawing.points.map((point, order) => ({ latitude: point.lat, longitude: point.lng, order }));
    setConfirmOpen(false); setSaving(true); setDialogError("");
    setProgress({ phase: "saving", name, wardLabel: saveWard.label, fenceId: null, timedOut: false, tbId, salesIds: [], leftOut: [] });
    try {
      const located = await resolve({ tbId, lmPcode, source: "PREPAID_SALES", salesIds: counted }).unwrap();
      const ready = (located.rows || []).filter(row => row.ready && row.proof);
      if (!ready.length) throw new Error(`None of the ${counted.length} meters could be made ready for a batch. ${salesMapFenceLeftOut({ counted, savedIds: [], rows: located.rows, meters: rows }).join("; ")}`);
      const targetedBatch = { tbId, lmPcode, source: "PREPAID_SALES", geofenceId: null, salesIds: ready.map(row => row.salesId), reason: `Selected from GPS Sales Table · geofence ${name}`,
        salesPeriodFrom: null, salesPeriodTo: null, resolutionProofs: Object.fromEntries(ready.map(row => [row.salesId, row.proof])) };
      let result;
      try {
        result = await createGeoFence({ name, description: draftDescription.trim() || "NAv", points, salesMapFence: true, targetedBatch,
          parents: { lmPcode, wardPcode: saveWard.pcode, countryPcode: "ZA", provincePcode: lmPcode.slice(0, 3), dmPcode: lmPcode.slice(0, -1) } }).unwrap();
      } catch (transport) {
        // No answer from the server: it may still have saved the geofence.
        throw Object.assign(new Error(transport?.message || "The server did not answer."), { uncertain: true });
      }
      if (result?.success !== true) throw new Error(result?.message || "The geofence could not be saved.");
      const savedIds = result.savedSalesIds || targetedBatch.salesIds;
      setProgress(current => current && { ...current, phase: "saved", fenceId: result.geofenceId, salesIds: savedIds,
        leftOut: salesMapFenceLeftOut({ counted, savedIds, rows: located.rows, meters: rows }) });
      drawing.clear(); setDraftName(""); setDraftDescription(""); setDrawWard(null);
    } catch (error) {
      setProgress(null);
      setFailure({ name, uncertain: error?.uncertain === true, message: salesDraftMessage(error?.error || error?.message || "The geofence could not be saved. Try again.") });
    } finally { setSaving(false); }
  };

  // Progress until the server has linked the geofence (TB-R055.5), then hand it to the table once.
  const savedFence = useWatchedFence(progress?.fenceId || "");
  const progressState = progress ? salesMapFenceProgress({ phase: progress.phase, fenceId: progress.fenceId, fence: savedFence, timedOut: progress.timedOut }) : null;
  const waiting = Boolean(progress?.phase === "saved" && !progress.timedOut && !progressState?.done);
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setTimeout(() => setProgress(current => current && { ...current, timedOut: true }), GEOFENCE_PROGRESS_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [waiting]);
  const handedOver = useRef("");
  useEffect(() => {
    if (!progressState?.done || !progress?.fenceId || handedOver.current === progress.fenceId) return;
    handedOver.current = progress.fenceId;
    onSaved?.({ id: progress.fenceId, name: progress.name, tbId: progress.tbId, salesIds: progress.salesIds });
  }, [progressState?.done, progress, onSaved]);

  const countLine = <p role="status" style={{ margin: 0, color: TONES[countText.tone], fontWeight: countText.tone === "error" ? 900 : 750 }}>{countText.text}</p>;
  const drawButton = canDraw ? <button type="button" style={{ ...drawButtonStyle, opacity: canStart ? 1 : 0.5, cursor: canStart ? "pointer" : "not-allowed" }} disabled={!canStart}
    title="Draw the geofence for a GPS batch (at most 30 meters that can be batched)" onClick={() => { setDialogError(""); setCreateModalOpen(true); }}>
    Draw batch geofence</button> : null;
  const panel = <GeofenceDrawingBar isCreateMode={isCreateMode} draftName={standardName} draftPoints={drawing.points} draftPolygonReady={drawing.points.length >= 3} draftPreviewStats={draftPreviewStats}
    handleUndoPoint={() => { if (!saving) drawing.undo(); }} handleRestartDraft={() => { if (!saving) drawing.setPoints([]); }} handleOpenCreateConfirm={() => { if (canSave) setConfirmOpen(true); }}
    canSaveDraft={canSave} createState={{ isLoading: saving }} handleCancelDraft={cancel} draftInside={countLine} completeness={completeness} inline/>;
  const mapLayer = isCreateMode ? <DraftGeoFenceLayer draftPoints={drawing.points} color={count.over ? "#dc2626" : "#2563eb"}/> : null;
  const leftOut = progress?.leftOut || [];
  const dialogs = <>
    <GeofenceDialogs listModalOpen={false} wardLabel={ward.label} setListModalOpen={() => {}} visibleGeofences={[]} selectedGeoFence={null} setSelectedGeoFence={() => {}}
      createModalOpen={createModalOpen} setCreateModalOpen={open => { setCreateModalOpen(open); if (!open) setDialogError(""); }} draftName={draftName} setDraftName={changeName}
      draftDescription={draftDescription} setDraftDescription={setDraftDescription} handleStartDrawing={handleStartDrawing} confirmCreateModalOpen={confirmOpen}
      setConfirmCreateModalOpen={open => { setConfirmOpen(open); if (!open) setDialogError(""); }} draftPreviewStats={draftPreviewStats} createState={{ isLoading: saving }}
      handleConfirmCreate={handleConfirmCreate} createSuccess={null} setCreateSuccess={() => {}} draftInside={countLine} completeness={completeness}
      lockedWard wardNumber={ward.number} existingGeofences={wardGeofences} createError={dialogError}/>
    {progress && progressState ? <GeofenceProgressModal name={progress.name} wardLabel={progress.wardLabel} progress={progressState} fence={savedFence} onClose={() => setProgress(null)}
      linkedTo={`batch ${progress.tbId}`} stillLinkingText="Its ERFs and meters are still being linked. The table filters to it as soon as they are."
      next={<><strong>Next:</strong> the table now shows this geofence&apos;s {progress.salesIds.length} meter{progress.salesIds.length === 1 ? "" : "s"}, ticked. Press <strong>Create Target Batch</strong> to open TB Draft with this geofence, or create the batch later from <strong>Batches &amp; Geofences</strong>.
        {leftOut.length ? <><br/><strong>Left out ({leftOut.length}):</strong> {leftOut.join("; ")}.</> : null}</>}/> : null}
    {failure ? <BatchCreationModal title={failure.uncertain ? "Geofence not confirmed" : "Geofence not saved"} tone="error"
      lines={failure.uncertain
        ? [`${failure.name}: ${failure.message}`, "iREPS could not confirm whether it was saved. Check Batches & Geofences before you save it again; if it is there, create its batch from there."]
        : [`${failure.name}: ${failure.message}`, "Nothing was saved. Your drawing is still on the map: change it and press Save again, or Cancel."]}
      actions={[{ label: "OK", primary: true, onClick: () => setFailure(null) }]} escapeAction={() => setFailure(null)}/> : null}
  </>;
  return { drawButton, panel, mapLayer, dialogs, handleMapClick, isCreateMode, busy };
}

const drawButtonStyle = { alignSelf: "flex-end", border: "1px solid #7c3aed", borderRadius: "0.65rem", padding: "0.52rem 0.7rem", background: "#7c3aed", color: "#ffffff", fontWeight: 850 };
