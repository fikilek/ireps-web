/* eslint-disable no-unused-vars -- JSX tags are used by React. */
import { useState } from "react";
import TargetedBatchDraftTable from "./draft/TargetedBatchDraftTable";
import TargetedBatchDraftSummary from "./draft/TargetedBatchDraftSummary";
import SalesBatchGeofenceWorkspace from "./draft/sales-batch-geofence-workspace";
import { draftReviewStyles as styles, draftButtonStyle } from "./draft/targetedBatchDraftReviewStyles";
import { salesDraftMessage, salesDraftWardGroups } from "./draft/sales-batch-draft-model";
export default function TargetedBatchDraftReview({ draft, model, live, drawing, busy, locating, saving, onRemove, onSave, onCreate, onClear, onResolve, feedback }) {
  const [highlightedId, setHighlightedId] = useState(null);
  const groups = salesDraftWardGroups(model.rows);
  const topActions = <><button type="button" style={draftButtonStyle(busy)} onClick={onResolve} disabled={busy}>Locate meters again</button><button type="button" style={draftButtonStyle(busy || Boolean(draft.uncertainRequest))} onClick={onClear} disabled={busy || Boolean(draft.uncertainRequest)}>Clear draft</button></>;
  return <section style={styles.panel}>
    <header style={styles.header}><div><p style={styles.eyebrow}>Sales Planning</p><h1 style={styles.title}>TB Draft</h1><p>{draft.id}</p></div>
      <button type="button" style={draftButtonStyle(busy || !model.canCreate, true)} onClick={onCreate} disabled={busy || !model.canCreate}>Create</button></header>
    <TargetedBatchDraftSummary draft={draft} model={model}/>
    {groups.length > 1 && <div style={styles.headerActions} aria-label="Keep one Ward"><span>{groups.map(group => `${group.label}: ${group.salesIds.length} meters`).join(" · ")}</span>{groups.map(group => <button key={group.pcode} type="button" disabled={busy} style={draftButtonStyle(busy)} onClick={() => model.rows.filter(row => !group.salesIds.includes(row.salesId)).forEach(row => onRemove(row.salesId))}>Keep {group.label}</button>)}</div>}
    {feedback && <p role="alert" style={styles.integrityPanel}>{salesDraftMessage(feedback)}</p>}
    {!live?.ready && <p role="status" style={styles.sourceNotice}>{salesDraftMessage(live?.error) || "Loading current Sales, ERF, Ward and geofence data…"}</p>}
    <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "start", padding: "1rem" }}>
      <div style={{ flex: "1 1 360px", minWidth: 0 }}><TargetedBatchDraftTable rows={model.rows} disabled={busy || Boolean(draft.uncertainRequest)} onRemove={onRemove} topActions={topActions} highlightedId={highlightedId} onHighlight={setHighlightedId}/></div>
      <div style={{ flex: "2 1 580px", minWidth: 0 }}><SalesBatchGeofenceWorkspace {...{ draft, model, live, drawing, busy, locating, saving, onSave, highlightedId }} onHighlight={setHighlightedId}/></div>
    </div>
  </section>;
}
