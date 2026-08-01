/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { formatNumber } from "../targetedBatchUtils";
import { draftReviewStyles as styles } from "./targetedBatchDraftReviewStyles";

export const EMPTY_DRAFT_FILTERS = Object.freeze({
  searchText: "",
  rowDecision: "ALL",
  astMatchStatus: "ALL",
  proposedTrnType: "ALL",
});

export default function TargetedBatchDraftFilters({
  filters,
  totalRows,
  filteredRows,
  showRowDecision,
  astOptions,
  trnOptions,
  onChange,
  onClear,
}) {
  return (
    <section style={styles.filtersPanel}>
      <div style={styles.filtersHeader}>
        <h3 style={styles.filtersTitle}>Draft row filters</h3>
        <span style={styles.filtersCount}>
          {formatNumber(filteredRows)} of {formatNumber(totalRows)} rows shown
        </span>
      </div>

      <div
        style={{
          ...styles.filtersGrid,
          ...(showRowDecision ? styles.filtersGridWithDecision : null),
        }}
      >
        <label style={styles.filterLabel}>
          Search
          <input
            type="search"
            value={filters.searchText}
            onChange={(event) => onChange("searchText", event.target.value)}
            placeholder="Meter, account, customer, address, SG code or rejection reason"
            style={styles.filterInput}
          />
        </label>

        {showRowDecision ? (
          <label style={styles.filterLabel}>
            Row Outcome
            <select
              value={filters.rowDecision}
              onChange={(event) => onChange("rowDecision", event.target.value)}
              style={styles.filterInput}
            >
              <option value="ALL">All</option>
              <option value="ACCEPT">ACCEPT</option>
              <option value="REJECT">REJECT</option>
            </select>
          </label>
        ) : null}

        <label style={styles.filterLabel}>
          AST Match
          <select
            value={filters.astMatchStatus}
            onChange={(event) =>
              onChange("astMatchStatus", event.target.value)
            }
            style={styles.filterInput}
          >
            <option value="ALL">All</option>
            {astOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label style={styles.filterLabel}>
          Proposed TRN
          <select
            value={filters.proposedTrnType}
            onChange={(event) =>
              onChange("proposedTrnType", event.target.value)
            }
            style={styles.filterInput}
          >
            <option value="ALL">All</option>
            {trnOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <button type="button" style={styles.secondaryButton} onClick={onClear}>
          Clear Filters
        </button>
      </div>
    </section>
  );
}
