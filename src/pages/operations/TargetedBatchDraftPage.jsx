/* eslint-disable no-unused-vars -- JSX tags are used by React. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { useAuth } from "../../auth/useAuth";
import { useCreateGeoFenceMutation } from "../../redux/geofencesApi";
import { useSalesReadScope } from "../../redux/salesApi";
import { clearTargetedBatchDraft, selectTargetedBatchDraft, updateSalesDraftResolution, saveSalesDraftFence, removeSalesDraftMeter, setSalesDraftConfirmation, setSalesDraftUncertainRequest } from "../../redux/targetedBatchDraftSlice";
import { useGetSalesBatchDraftSnapshotQuery, useResolveSalesTargetedBatchMutation, useAssessSalesTargetedBatchMutation, useCreateSalesTargetedBatchMutation } from "../../redux/salesTargetedBatchApi";
import { useGeofencePolygonDraft } from "../../features/maps/use-geofence-polygon-draft";
import { salesDraftIntent, projectSalesDraft, draftGeometry, confirmationIdentity, salesDraftResolutionFailure, salesDraftReturnPath, salesDraftSignature, salesDraftMessage } from "./targeted-batches/draft/sales-batch-draft-model";
import BatchCreationModal from "./targeted-batches/draft/batch-creation-modal.jsx";
import { checkingText, checkFailedLines, creatingText, creationSteps, CREATION_NOT_CONFIRMED } from "./targeted-batches/draft/batch-creation-window.js";
import TargetedBatchDraftReview from "./targeted-batches/TargetedBatchDraftReview";
import TargetedBatchConfirmModal from "./targeted-batches/TargetedBatchConfirmModal";
import { draftReviewStyles as styles, draftButtonStyle } from "./targeted-batches/draft/targetedBatchDraftReviewStyles";

export default function TargetedBatchDraftPage() {
  const draft = useSelector(selectTargetedBatchDraft), dispatch = useDispatch();
  const { activeWorkbase } = useAuth();
  const lmPcode = activeWorkbase?.lmPcode || activeWorkbase?.pcode || activeWorkbase?.id || activeWorkbase?.localMunicipalityId;
  const scope = useSalesReadScope(lmPcode), scopeKey = JSON.stringify(scope);
  const mismatch = Boolean(scope && draft && (draft.scope.lmPcode !== lmPcode || draft.scopeKey !== scopeKey));
  useEffect(() => { if (mismatch) dispatch(clearTargetedBatchDraft()); }, [mismatch, dispatch]);
  return <section style={{ padding: 24, minWidth: 0 }}>
    <p><Link to="/operations/targeted-batches">Back to TB Register</Link> · <Link to="/sales">Sales</Link></p>
    {!draft || mismatch ? <div style={styles.panel}><h1>TB Draft</h1><p>Select 1–30 GPS Sales or Non-GPS Sales meters to open a draft.</p></div>
      : !scope ? <p role="status">Waiting for the current account and LM…</p>
      : !draft.retainedIds ? <p>CSV creation is paused. Open a Sales selection to create a TB Draft.</p>
      : <SalesDraftSession key={`${draft.id}:${scopeKey}`} draft={draft}/>}</section>;
}

function SalesDraftSession({ draft }) {
  const dispatch = useDispatch(), navigate = useNavigate(), drawing = useGeofencePolygonDraft();
  const [resolve, resolveState] = useResolveSalesTargetedBatchMutation(), [save, saveState] = useCreateGeoFenceMutation();
  const [assess, assessState] = useAssessSalesTargetedBatchMutation(), [create, createState] = useCreateSalesTargetedBatchMutation();
  const [feedback, setFeedback] = useState(""), [recheck, setRecheck] = useState(0), [resolvedSignature, setResolvedSignature] = useState("");
  const [resolutionFailure, setResolutionFailure] = useState(null);
  // Rules TB-R040 (1.3.36): checking | check-failed | creating | failed | uncertain, or null. A request
  // whose outcome was never confirmed (e.g. the user left while it ran) reopens as not confirmed.
  const [creationWindow, setCreationWindow] = useState(() => draft.uncertainRequest ? { kind: "uncertain", message: CREATION_NOT_CONFIRMED } : null);
  const ids = JSON.stringify(draft.retainedIds), resolved = Object.values(draft.resolutions);
  const erfIds = [...new Set(resolved.map(row => row.erfId).filter(Boolean))].sort();
  const wardIds = [...new Set(resolved.map(row => row.scope?.wardPcode).filter(Boolean))].sort();
  const { data: live } = useGetSalesBatchDraftSnapshotQuery({ lmPcode: draft.scope.lmPcode, salesIds: draft.retainedIds, erfIds, wardIds, tbId: draft.id, geofenceId: draft.savedFence?.id });
  const signature = salesDraftSignature(live);
  const latest = useRef(null);
  useEffect(() => { latest.current = { draft, live }; }, [draft, live]);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const handled = useRef("");
  const uncertain = Boolean(draft.uncertainRequest);
  useEffect(() => {
    if (!signature || uncertain || !JSON.parse(ids).length) return;
    const key = JSON.stringify([signature, ids, recheck]);
    if (handled.current === key) return;
    handled.current = key;
    let active = true, pending = true;
    const input = salesDraftIntent(latest.current.draft);
    resolve(input).unwrap().then(result => {
      pending = false;
      if (!active) return;
      dispatch(updateSalesDraftResolution({ tbId: input.tbId, rows: result.rows }));
      setResolvedSignature(signature); setResolutionFailure(null); setFeedback("");
    }).catch(error => {
      pending = false;
      if (active) {
        handled.current = "";
        setResolutionFailure({ key, ...salesDraftResolutionFailure(error, input.source) });
      }
    });
    return () => { active = false; if (pending && handled.current === key) handled.current = ""; };
  }, [signature, ids, recheck, uncertain, resolve, dispatch]);
  useEffect(() => {
    if (live?.fence && JSON.stringify(live.fence) !== JSON.stringify(draft.savedFence)) dispatch(saveSalesDraftFence({ tbId: draft.id, fence: live.fence }));
  }, [live?.fence, draft.savedFence, draft.id, dispatch]);
  const geometry = useMemo(() => draftGeometry(drawing.points, draft.savedFence), [drawing.points, draft.savedFence]);
  const currentResolutionFailure = resolutionFailure?.key === JSON.stringify([signature, ids, recheck]) ? resolutionFailure : null;
  const model = useMemo(() => projectSalesDraft(draft, live, { geometry, resolutionsCurrent: signature === resolvedSignature,
    resolving: resolveState.isLoading, resolutionFailure: currentResolutionFailure }),
  [draft, live, geometry, signature, resolvedSignature, resolveState.isLoading, currentResolutionFailure]);
  const identity = confirmationIdentity(draft, live);
  const confirmation = draft.confirmation;
  const stale = !live?.ready || resolveState.isLoading || Boolean(currentResolutionFailure) || confirmation?.identity !== identity;
  const busy = resolveState.isLoading || saveState.isLoading || assessState.isLoading || createState.isLoading;

  async function saveFence(payload) {
    if (!model.canSave || busy) throw new Error("The draft is not ready for this geofence");
    const result = await save({ ...payload, targetedBatch: salesDraftIntent(draft) }).unwrap();
    if (result.success !== true) throw new Error(result.message || "Geofence creation failed");
    if (mounted.current) dispatch(saveSalesDraftFence({ tbId: draft.id, fence: { id: result.geofenceId } }));
    return result;
  }
  async function openConfirmation() {
    if (!model.canCreate || busy || uncertain) return;
    const capturedIdentity = identity, input = salesDraftIntent(draft);
    setFeedback("");
    setCreationWindow({ kind: "checking", count: input.salesIds.length });
    try {
      const result = await assess(input).unwrap();
      if (!mounted.current) return;
      if (confirmationIdentity(latest.current.draft, latest.current.live) !== capturedIdentity) {
        const message = "The draft changed while it was being checked.";
        setFeedback(`${message} Press Create Batch again.`); setCreationWindow({ kind: "check-failed", lines: [message, "Nothing was created. Press Create Batch again to check the current draft."] });
        return;
      }
      setCreationWindow(null);
      dispatch(setSalesDraftConfirmation({ tbId: draft.id, confirmation: { ...result, identity: capturedIdentity, input: { ...input, confirmationProof: result.confirmationProof, fingerprint: result.fingerprint, includedIds: result.includedIds } } }));
    } catch (error) {
      if (!mounted.current) return;
      const message = salesDraftMessage(error.error || "The draft is not ready to become a batch.");
      setFeedback(message); setCreationWindow({ kind: "check-failed", lines: checkFailedLines({ message, unreachable: error.uncertain === true }) });
    }
  }
  async function commitConfirmed(input) {
    if (!input || createState.isLoading) return;
    const wardLabel = draft.confirmation?.scope?.wardName || null, geofenceLabel = live?.fence?.name || draft.savedFence?.name || null;
    setCreationWindow({ kind: "creating", count: input.includedIds?.length || 0 });
    dispatch(setSalesDraftUncertainRequest({ tbId: draft.id, request: input }));
    try {
      const result = await create(input).unwrap();
      if (!mounted.current) return;
      if (result.tbId !== draft.id || result.creationState !== "READY") throw { uncertain: true, error: "The response did not establish a complete batch. Retry the same request." };
      // TB Register finishes the "Opening TB Register" step, shows Batch created and clears this draft
      // (TB-R040, 1.3.36); clearing it here first would flash an empty TB Draft between the windows.
      navigate("/operations/targeted-batches", { replace: true, state: { targetedBatchCreation: { success: true, createdBatchCount: 1, createdRowCount: result.rowCount, wardLabel, geofenceLabel, batches: [{ tbId: result.tbId, rowCount: result.rowCount }] } } });
    } catch (error) {
      // A definite failure unlocks the draft even if the user has already left TB Draft.
      if (!error.uncertain) dispatch(setSalesDraftUncertainRequest({ tbId: draft.id, request: null }));
      if (!mounted.current) return;
      const message = error.uncertain ? CREATION_NOT_CONFIRMED : error.error || "The batch could not be created.";
      setFeedback(message);
      setCreationWindow({ kind: error.uncertain ? "uncertain" : "failed", message: salesDraftMessage(message) });
    }
  }
  function closeFailedCreation() {
    setCreationWindow(null);
    dispatch(setSalesDraftConfirmation({ tbId: draft.id, confirmation: null }));
  }
  return <>
    <TargetedBatchDraftReview draft={draft} model={model} live={live} drawing={drawing} geometry={geometry} busy={busy || uncertain} locating={resolveState.isLoading} saving={saveState.isLoading} feedback={resolveState.isLoading ? "" : currentResolutionFailure?.reason || feedback}
      onRemove={salesId => dispatch(removeSalesDraftMeter({ tbId: draft.id, salesId }))} onSave={saveFence} onCreate={openConfirmation}
      onResolve={() => { handled.current = ""; setResolutionFailure(null); setFeedback(""); setRecheck(value => value + 1); }} onClear={() => { if (window.confirm("Clear this draft and go back to the meter table? A geofence you already saved stays saved.")) {
        dispatch(clearTargetedBatchDraft()); navigate(salesDraftReturnPath(draft.source.type), { replace: true });
      } }}/>
    {uncertain && !createState.isLoading && <button type="button" style={draftButtonStyle()} onClick={() => commitConfirmed(draft.uncertainRequest)}>Retry the same request</button>}
    {confirmation && !uncertain && !creationWindow && <TargetedBatchConfirmModal draft={draft} confirmation={confirmation} isCreating={createState.isLoading} stale={stale}
      onCancel={() => dispatch(setSalesDraftConfirmation({ tbId: draft.id, confirmation: null }))} onConfirm={() => { if (!stale) commitConfirmed(confirmation.input); }}/>}
    {creationWindow?.kind === "checking" && <BatchCreationModal title="Checking the batch" working lines={[checkingText(creationWindow.count), "This usually takes a few seconds."]}/>}
    {creationWindow?.kind === "check-failed" && <BatchCreationModal title="The batch can't be created yet" tone="error" lines={creationWindow.lines}
      actions={[{ label: "OK", primary: true, onClick: () => setCreationWindow(null) }]} escapeAction={() => setCreationWindow(null)}/>}
    {creationWindow?.kind === "creating" && <BatchCreationModal title="Creating the batch" working steps={creationSteps("create")} lines={[creatingText(creationWindow.count)]}/>}
    {creationWindow?.kind === "failed" && <BatchCreationModal title="Batch not created" tone="error" lines={[creationWindow.message, "Nothing was created. OK returns to TB Draft."]}
      actions={[{ label: "OK", primary: true, onClick: closeFailedCreation }]} escapeAction={closeFailedCreation}/>}
    {creationWindow?.kind === "uncertain" && <BatchCreationModal title="Batch not confirmed yet" tone="warning" lines={[creationWindow.message]}
      actions={[{ label: "Retry the same request", primary: true, onClick: () => commitConfirmed(draft.uncertainRequest) }, { label: "Close", onClick: () => setCreationWindow(null) }]}
      escapeAction={() => setCreationWindow(null)}/>}</>;
}
