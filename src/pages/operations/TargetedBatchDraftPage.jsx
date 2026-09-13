/* eslint-disable no-unused-vars -- JSX tags are used by React. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { useAuth } from "../../auth/useAuth";
import { useSalesReadScope } from "../../redux/salesApi";
import { clearTargetedBatchDraft, selectTargetedBatchDraft, updateSalesDraftResolution, saveSalesDraftFence, removeSalesDraftMeter, setSalesDraftConfirmation, setSalesDraftUncertainRequest } from "../../redux/targetedBatchDraftSlice";
import { useGetSalesBatchDraftSnapshotQuery, useResolveSalesTargetedBatchMutation, useSaveSalesTargetedBatchGeofenceMutation, useAssessSalesTargetedBatchMutation, useCreateSalesTargetedBatchMutation } from "../../redux/salesTargetedBatchApi";
import { useGeofencePolygonDraft } from "../../features/maps/use-geofence-polygon-draft";
import { salesDraftIntent, projectSalesDraft, draftGeometry, confirmationIdentity } from "./targeted-batches/draft/sales-batch-draft-model";
import TargetedBatchDraftReview from "./targeted-batches/TargetedBatchDraftReview";
import TargetedBatchConfirmModal from "./targeted-batches/TargetedBatchConfirmModal";
import { draftReviewStyles as styles } from "./targeted-batches/draft/targetedBatchDraftReviewStyles";

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
  const [resolve, resolveState] = useResolveSalesTargetedBatchMutation(), [save, saveState] = useSaveSalesTargetedBatchGeofenceMutation();
  const [assess, assessState] = useAssessSalesTargetedBatchMutation(), [create, createState] = useCreateSalesTargetedBatchMutation();
  const [feedback, setFeedback] = useState(""), [recheck, setRecheck] = useState(0), [resolvedSignature, setResolvedSignature] = useState("");
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setTick(Date.now()), 5000); return () => clearInterval(timer); }, []);
  const ids = JSON.stringify(draft.retainedIds), resolved = Object.values(draft.resolutions);
  const erfIds = [...new Set(resolved.map(row => row.erfId).filter(Boolean))].sort();
  const wardIds = [...new Set(resolved.map(row => row.scope?.wardPcode).filter(Boolean))].sort();
  const { data: live } = useGetSalesBatchDraftSnapshotQuery({ lmPcode: draft.scope.lmPcode, salesIds: draft.retainedIds, erfIds, wardIds, tbId: draft.id });
  const signature = live?.ready ? JSON.stringify([live.sales, live.erfs, live.wards]) : "";
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
      setResolvedSignature(signature); setFeedback("");
    }).catch(error => { pending = false; if (active) { handled.current = ""; setFeedback(error.error || "Resolution is unavailable. Recheck when the service is available."); } });
    return () => { active = false; if (pending && handled.current === key) handled.current = ""; };
  }, [signature, ids, recheck, uncertain, resolve, dispatch]);
  useEffect(() => {
    if (live?.fence && JSON.stringify(live.fence) !== JSON.stringify(draft.savedFence)) dispatch(saveSalesDraftFence({ tbId: draft.id, fence: live.fence }));
  }, [live?.fence, draft.savedFence, draft.id, dispatch]);
  const geometry = useMemo(() => draftGeometry(drawing.points, draft.savedFence), [drawing.points, draft.savedFence]);
  const model = useMemo(() => projectSalesDraft(draft, live, { geometry, resolutionsCurrent: signature === resolvedSignature, now: tick }), [draft, live, geometry, signature, resolvedSignature, tick]);
  const identity = confirmationIdentity(draft, live);
  const confirmation = draft.confirmation;
  const stale = !live?.ready || confirmation?.identity !== identity || tick > (confirmation?.expiresAt || 0);
  const busy = resolveState.isLoading || saveState.isLoading || assessState.isLoading || createState.isLoading;

  async function saveFence() {
    if (!model.canSave || !drawing.complete || busy) return;
    try {
      await save({ ...salesDraftIntent(draft), points: drawing.points, saveSalesIds: model.readyIds }).unwrap();
      if (!mounted.current) return;
      setFeedback("Geofence saved. Its included population is fixed for this draft.");
    } catch (error) { if (!mounted.current) return; setFeedback(error.error || "Geofence save failed. The retained draft is unchanged."); }
  }
  async function openConfirmation() {
    if (!model.canCreate || busy || uncertain) return;
    const capturedIdentity = identity, input = salesDraftIntent(draft);
    try {
      const result = await assess(input).unwrap();
      if (!mounted.current) return;
      if (confirmationIdentity(latest.current.draft, latest.current.live) !== capturedIdentity) { setFeedback("Draft data changed during assessment. Select Create again."); return; }
      dispatch(setSalesDraftConfirmation({ tbId: draft.id, confirmation: { ...result, identity: capturedIdentity, expiresAt: result.expiresAt, input: { ...input, confirmationProof: result.confirmationProof, fingerprint: result.fingerprint, includedIds: result.includedIds } } }));
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
    <TargetedBatchDraftReview draft={draft} model={model} live={live} drawing={drawing} geometry={geometry} busy={busy || uncertain} feedback={feedback}
      onRemove={salesId => dispatch(removeSalesDraftMeter({ tbId: draft.id, salesId }))} onSave={saveFence} onCreate={openConfirmation}
      onResolve={() => { handled.current = ""; setRecheck(value => value + 1); }} onClear={() => { if (window.confirm("Clear this retained draft? Saved fences remain recorded.")) dispatch(clearTargetedBatchDraft()); }}/>
    {uncertain && !createState.isLoading && <button type="button" onClick={() => commitConfirmed(draft.uncertainRequest)}>Retry the same confirmed creation</button>}
    {confirmation && !uncertain && <TargetedBatchConfirmModal draft={draft} confirmation={confirmation} isCreating={createState.isLoading} stale={stale}
      onCancel={() => dispatch(setSalesDraftConfirmation({ tbId: draft.id, confirmation: null }))} onConfirm={() => { if (!stale) commitConfirmed(confirmation.input); }}/>}</>;
}
