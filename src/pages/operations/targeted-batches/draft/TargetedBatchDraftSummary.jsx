import { draftReviewStyles as styles } from "./targetedBatchDraftReviewStyles";
export default function TargetedBatchDraftSummary({ draft, model }) {
  return <div><div style={styles.summaryGrid}>{[["Retained meters",model.rows.length],["Ready meters",model.readyIds.length],["Left out",model.rows.length-model.readyIds.length],["Ward",model.wards.join(", ") || "Not found yet"]].map(([label,value]) => <div key={label} style={styles.summaryCard}><span>{label}</span><strong style={styles.summaryValue}>{value}</strong></div>)}</div>
    <p style={styles.sourceNotice}>{draft.source.label} · {draft.scope.lmName} · {draft.selection.reason}</p>
    {model.gate && <p role="alert" style={styles.integrityPanel}>{model.gate}</p>}</div>;
}
