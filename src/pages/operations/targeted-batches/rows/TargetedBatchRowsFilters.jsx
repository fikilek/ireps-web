/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { tbRowsStyles as styles } from "./targetedBatchRowsStyles";

function TextFilter({ label, value, placeholder, onChange }) {
  return (
    <label style={styles.filterLabel}>
      {label}
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        style={styles.filterControl}
      />
    </label>
  );
}

function SelectFilter({ label, value, options, onChange }) {
  return (
    <label style={styles.filterLabel}>
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={styles.filterControl}
      >
        <option value="ALL">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function TargetedBatchRowsFilters({
  filters,
  options,
  onChange,
}) {
  return (
    <div style={styles.filtersGrid}>
      <TextFilter
        label="Search All Row Fields"
        value={filters.search}
        placeholder="IDs, address, reason, references..."
        onChange={(value) => onChange("search", value)}
      />
      <TextFilter
        label="Meter Number"
        value={filters.meterNo}
        placeholder="Search meter"
        onChange={(value) => onChange("meterNo", value)}
      />
      <TextFilter
        label="Account / Customer"
        value={filters.accountCustomer}
        placeholder="Search account or customer"
        onChange={(value) => onChange("accountCustomer", value)}
      />
      <TextFilter
        label="Town"
        value={filters.town}
        placeholder="Search town"
        onChange={(value) => onChange("town", value)}
      />
      <SelectFilter
        label="Row Outcome"
        value={filters.outcome}
        options={options.outcome}
        onChange={(value) => onChange("outcome", value)}
      />
      <SelectFilter
        label="AST Match"
        value={filters.astMatchStatus}
        options={options.astMatchStatus}
        onChange={(value) => onChange("astMatchStatus", value)}
      />
      <SelectFilter
        label="Proposed TRN"
        value={filters.proposedTrnType}
        options={options.proposedTrnType}
        onChange={(value) => onChange("proposedTrnType", value)}
      />
      <SelectFilter
        label="Allocation"
        value={filters.allocationStatus}
        options={options.allocationStatus}
        onChange={(value) => onChange("allocationStatus", value)}
      />
      <SelectFilter
        label="Premise"
        value={filters.premiseStatus}
        options={options.premiseStatus}
        onChange={(value) => onChange("premiseStatus", value)}
      />
      <SelectFilter
        label="Meter Discovery"
        value={filters.meterDiscoveryStatus}
        options={options.meterDiscoveryStatus}
        onChange={(value) => onChange("meterDiscoveryStatus", value)}
      />
      <SelectFilter
        label="Completion"
        value={filters.completionStatus}
        options={options.completionStatus}
        onChange={(value) => onChange("completionStatus", value)}
      />
    </div>
  );
}
