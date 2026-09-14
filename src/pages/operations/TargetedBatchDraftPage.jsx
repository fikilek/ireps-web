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
import { salesDraftIntent, projectSalesDraft, draftGeometry, confirmationIdentity, salesDraftResolutionFailure, salesDraftReturnPath, salesDraftSignature } from "./targeted-batches/draft/sales-batch-draft-model";
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
    try {
      const result = await assess(input).unwrap();
      if (!mounted.current) return;
      if (confirmationIdentity(latest.current.draft, latest.current.live) !== capturedIdentity) { setFeedback("Draft data changed during assessment. Select Create again."); return; }
      dispatch(setSalesDraftConfirmation({ tbId: draft.id, confirmation: { ...result, identity: capturedIdentity, input: { ...input, confirmationProof: result.confirmationProof, fingerprint: result.fingerprint, includedIds: result.includedIds } } }));
    } catch (error) { if (!mounted.current) return; setFeedback(error.error || "The current draft is not ready for confirmation."); }
  }
  async function commitConfirmed(input) {
    if (!input || createState.isLoading) return;
    dispatch(setSalesDraftUncertainRequest({ tbId: draft.id, request: input }));
    try {
      const result = await create(input).unwrap();
      if (!mounted.current) return;
      if (result.tbId !== draft.id || result.creationState !== "READY") throw { uncertain: true, error: "The response did not establish a complete batch. Retry the same request." };
      dispatch(clearTargetedBatchDraft());
      navigate("/operations/targeted-batches", { replace: true, state: { targetedBatchCreation: { success: true, createdBatchCount: 1, createdRowCount: result.rowCount, batches: [{ tbId: result.tbId, rowCount: result.rowCount }] } } });
    } catch (error) {
      if (!mounted.current) return;
      if (!error.uncertain) dispatch(setSalesDraftUncertainRequest({ tbId: draft.id, request: null }));
      setFeedback(error.uncertain ? "Creation outcome is not yet confirmed. Retry the same confirmed request; do not start another batch." : error.error || "Creation failed; no partial batch was created.");
    }
  }
  return <>
    <TargetedBatchDraftReview draft={draft} model={model} live={live} drawing={drawing} geometry={geometry} busy={busy || uncertain} locating={resolveState.isLoading} saving={saveState.isLoading} feedback={resolveState.isLoading ? "" : currentResolutionFailure?.reason || feedback}
      onRemove={salesId => dispatch(removeSalesDraftMeter({ tbId: draft.id, salesId }))} onSave={saveFence} onCreate={openConfirmation}
      onResolve={() => { handled.current = ""; setResolutionFailure(null); setFeedback(""); setRecheck(value => value + 1); }} onClear={() => { if (window.confirm("Clear this draft and go back to the meter table? A geofence you already saved stays saved.")) {
        dispatch(clearTargetedBatchDraft()); navigate(salesDraftReturnPath(draft.source.type), { replace: true });
      } }}/>
    {uncertain && !createState.isLoading && <button type="button" style={draftButtonStyle()} onClick={() => commitConfirmed(draft.uncertainRequest)}>Retry the same confirmed creation</button>}
    {confirmation && !uncertain && <TargetedBatchConfirmModal draft={draft} confirmation={confirmation} isCreating={createState.isLoading} stale={stale}
      onCancel={() => dispatch(setSalesDraftConfirmation({ tbId: draft.id, confirmation: null }))} onConfirm={() => { if (!stale) commitConfirmed(confirmation.input); }}/>}</>;
}
