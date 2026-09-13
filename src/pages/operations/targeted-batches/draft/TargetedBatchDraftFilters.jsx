import { draftReviewStyles as styles } from "./targetedBatchDraftReviewStyles";
export default function TargetedBatchDraftFilters({ columns, filters, onChange }) {
  return <tr>{columns.map((column, index) => <th key={column.key} style={index === 0 ? { ...styles.bodyCell, ...styles.fixedFirstColumn } : styles.bodyCell}>
    <input aria-label={`Filter ${column.label}`} value={filters[column.key] || ""} onChange={event => onChange(column.key, event.target.value)} style={styles.filterInput}/>
  </th>)}</tr>;
}
