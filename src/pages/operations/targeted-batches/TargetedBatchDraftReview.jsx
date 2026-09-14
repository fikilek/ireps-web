/* eslint-disable no-unused-vars -- JSX tags are used by React. */
import { useState } from "react";
import TargetedBatchDraftTable from "./draft/TargetedBatchDraftTable";
import TargetedBatchDraftSummary from "./draft/TargetedBatchDraftSummary";
import SalesBatchGeofenceWorkspace from "./draft/sales-batch-geofence-workspace";
import { draftReviewStyles as styles, draftButtonStyle } from "./draft/targetedBatchDraftReviewStyles";
import { salesDraftMessage, salesDraftChipGroups } from "./draft/sales-batch-draft-model";
import BusySpinner from "../../../components/busy-spinner.jsx";
export default function TargetedBatchDraftReview({ draft, model, live, drawing, busy, locating, saving, onRemove, onSave, onCreate, onClear, onResolve, feedback }) {
  const [highlightedId, setHighlightedId] = useState(null);
  const listLocked = busy || Boolean(draft.uncertainRequest);
  // Rules TB-R038 (1.3.14): one chip per Ward, plus Needs manual ERFing / Not located, each
  // removable in bulk after a confirmation. Replaces the earlier Keep Ward buttons.
  const chips = salesDraftChipGroups(model.rows);
  const removeGroup = group => {
    const count = group.salesIds.length;
    if (window.confirm(`Remove the ${count} ${group.title} meter${count === 1 ? "" : "s"} from this draft?`)) group.salesIds.forEach(salesId => onRemove(salesId));
  };
  const chipRow = chips.length > 0 && <div style={chipRowStyle} aria-label="Meters by Ward">
    {chips.map(group => <span key={group.key} style={{ ...chipStyle, ...(group.kind === "ward" ? null : chipAttentionStyle) }} title={group.title}>
      {group.label}: <strong>{group.salesIds.length}</strong>
      {group.removable && <button type="button" style={chipRemoveStyle} disabled={listLocked} onClick={() => removeGroup(group)}
        aria-label={`Remove all ${group.salesIds.length} ${group.title} meters from this draft`} title={`Remove all ${group.title} meters`}>×</button>}
    </span>)}
  </div>;
  const topActions = <><button type="button" style={draftButtonStyle(busy)} onClick={onResolve} disabled={busy}>{locating ? <BusySpinner label="Locating meters…" size={14} asStatus={false}/> : "Locate meters again"}</button><button type="button" style={draftButtonStyle(busy || Boolean(draft.uncertainRequest))} onClick={onClear} disabled={busy || Boolean(draft.uncertainRequest)}>Clear draft</button></>;
  return <section style={styles.panel}>
    <header style={styles.header}><div><p style={styles.eyebrow}>Sales Planning</p><h1 style={styles.title}>TB Draft</h1><p>{draft.id}</p></div></header>
    <TargetedBatchDraftSummary draft={draft} model={model}/>
    {feedback && <p role="alert" style={styles.integrityPanel}>{salesDraftMessage(feedback)}</p>}
    {!live?.ready && (live?.error
      ? <p role="status" style={styles.sourceNotice}>{salesDraftMessage(live.error)}</p>
      : <p style={styles.sourceNotice}><BusySpinner label="Loading draft…"/></p>)}
    <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "start", padding: "1rem" }}>
      <div style={{ flex: "1 1 360px", minWidth: 0 }}>{chipRow}<TargetedBatchDraftTable rows={model.rows} disabled={listLocked} onRemove={onRemove} topActions={topActions} highlightedId={highlightedId} onHighlight={setHighlightedId}/></div>
      <div style={{ flex: "2 1 580px", minWidth: 0 }}><SalesBatchGeofenceWorkspace {...{ draft, model, live, drawing, busy, locating, saving, onSave, onCreate, highlightedId }} createDisabled={busy || !model.canCreate} onHighlight={setHighlightedId}/></div>
    </div>
  </section>;
}

const chipRowStyle = { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", margin: "0 0 10px" };
const chipStyle = { display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 6px 4px 12px", borderRadius: 999, border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1e3a8a", fontSize: 13 };
const chipAttentionStyle = { border: "1px solid #fed7aa", background: "#fff7ed", color: "#9a3412" };
const chipRemoveStyle = { width: 22, height: 22, borderRadius: 999, border: "1px solid currentColor", background: "#ffffff", color: "inherit", fontWeight: 900, lineHeight: 1, cursor: "pointer" };
