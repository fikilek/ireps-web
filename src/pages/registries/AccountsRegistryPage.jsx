import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import {
  useGetRegistryAccountsByWardQuery,
  useLazyGetFieldAccountDataHistoryByPremiseQuery,
} from "../../redux/registryAccountsApi";
import { useGetRegistryWardsByLmQuery } from "../../redux/registryWardsApi";

function getActiveLmPcode(activeWorkbase) {
  return (
    activeWorkbase?.lmPcode ||
    activeWorkbase?.pcode ||
    activeWorkbase?.id ||
    activeWorkbase?.localMunicipalityId ||
    null
  );
}

function formatNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue.toLocaleString() : "0";
}

function formatUpdatedAt(value) {
  if (!value || value === "NAv") return "NAv";

  if (typeof value === "string") {
    return value.slice(0, 19).replace("T", " ");
  }

  if (typeof value?.toDate === "function") {
    return value.toDate().toLocaleString();
  }

  return "NAv";
}

function getWardLabel(ward) {
  if (!ward) return "NAv";
  return `Ward ${ward.wardNumber}`;
}

function normalizeFilterText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function includesText(value, filterValue) {
  const filterText = normalizeFilterText(filterValue);
  if (!filterText) return true;

  return normalizeFilterText(value).includes(filterText);
}

function getWardNumberFromPcode(wardPcode = "") {
  const match = String(wardPcode || "").match(/(\d{1,3})$/);
  const numberValue = Number(match?.[1] || 0);

  return Number.isFinite(numberValue) ? numberValue : 0;
}

function getOwnerTypeLabel(ownerType) {
  if (ownerType === "NATURAL_PERSON") return "Natural Person";
  if (ownerType === "JURISTIC_PERSON") return "Juristic Person";
  return ownerType || "NAv";
}

function getStatusRank(status) {
  const normalized = String(status || "").toUpperCase();

  if (normalized === "ERROR") return 3;
  if (normalized === "WARNING") return 2;
  if (normalized === "BALANCED") return 1;

  return 0;
}

function getSortValue(row, key) {
  if (key === "premiseAddress") return row.premiseAddress || "";
  if (key === "ward") return getWardNumberFromPcode(row.wardPcode);
  if (key === "erfNo") return row.erfNo || "";
  if (key === "owner") return row.ownerLabel || "";
  if (key === "ownerType") return row.ownerType || "";
  if (key === "accounts") return row.accountCount || 0;
  if (key === "meters") return row.meterCount || 0;
  if (key === "reconciliation") return getStatusRank(row.reconciliationStatus);
  if (key === "history") return row.historySortValue || 0;

  return "";
}

function compareNatural(a, b) {
  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }

  return String(a || "").localeCompare(String(b || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function compareDefaultRows(a, b) {
  const wardCompare = compareNatural(
    getWardNumberFromPcode(a.wardPcode),
    getWardNumberFromPcode(b.wardPcode),
  );

  if (wardCompare !== 0) return wardCompare;

  const erfCompare = compareNatural(a.erfNo, b.erfNo);
  if (erfCompare !== 0) return erfCompare;

  return compareNatural(a.premiseAddress, b.premiseAddress);
}

function countFilterMatches(count, mode) {
  if (!mode || mode === "ALL") return true;
  if (mode === "ZERO") return count === 0;
  if (mode === "ONE") return count === 1;
  if (mode === "MULTIPLE") return count > 1;

  return true;
}

function ownerHasDetails(owner = {}) {
  return owner?.ownerType === "JURISTIC_PERSON"
    ? owner?.juristicPerson?.registeredName ||
        owner?.juristicPerson?.registrationNumber ||
        owner?.juristicPerson?.tradingName
    : owner?.naturalPerson?.name ||
        owner?.naturalPerson?.surname ||
        owner?.naturalPerson?.idNumber;
}

function occupantHasDetails(occupant = {}) {
  return (
    occupant?.name ||
    occupant?.surname ||
    occupant?.idNumber ||
    occupant?.relationshipToOwner ||
    occupant?.contact?.phone ||
    occupant?.contact?.whatsapp ||
    occupant?.contact?.email
  );
}

function SortButton({ label, sortKey, sortConfig, onSort }) {
  const isActive = sortConfig?.key === sortKey;
  const arrow = !isActive ? "↕" : sortConfig.direction === "asc" ? "↑" : "↓";

  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      style={styles.sortButton}
      title={`Sort by ${label}`}
    >
      <span>{label}</span>
      <span>{arrow}</span>
    </button>
  );
}

function FilterInput({ value, onChange, placeholder }) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      style={styles.headerInput}
    />
  );
}

function FilterSelect({ value, onChange, children }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      style={styles.headerSelect}
    >
      {children}
    </select>
  );
}

function CountPill({ count, label, onClick }) {
  return (
    <button type="button" style={styles.countPill} onClick={onClick}>
      {formatNumber(count)} {label}
    </button>
  );
}

function ModalShell({ title, subtitle, onClose, children, wide = false }) {
  return (
    <div style={styles.modalOverlay} role="dialog" aria-modal="true">
      <div style={wide ? styles.modalWide : styles.modalCard}>
        <div style={styles.modalHeader}>
          <div>
            <p className="eyebrow" style={styles.modalEyebrow}>
              Accounts Registry
            </p>
            <h2 style={styles.modalTitle}>{title}</h2>
            {subtitle ? <p className="muted">{subtitle}</p> : null}
          </div>

          <button type="button" style={styles.closeButton} onClick={onClose}>
            ✕
          </button>
        </div>

        <div style={styles.modalBody}>{children}</div>
      </div>
    </div>
  );
}

function SimpleListTable({ columns = [], rows = [], emptyText = "No rows found." }) {
  if (!rows.length) {
    return <p className="muted">{emptyText}</p>;
  }

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={row.id || rowIndex}>
              {columns.map((column) => (
                <td key={column.key}>{column.render(row, rowIndex)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DetailLine({ label, value }) {
  return (
    <div style={styles.detailLine}>
      <span style={styles.detailLabel}>{label}</span>
      <strong style={styles.detailValue}>{value || "NAv"}</strong>
    </div>
  );
}

function DetailSection({ title, children }) {
  return (
    <div style={styles.detailSection}>
      <h3 style={styles.detailTitle}>{title}</h3>
      {children}
    </div>
  );
}

function HistoryCard({ historyRow }) {
  const media = Array.isArray(historyRow?.media) ? historyRow.media : [];
  const processing = historyRow?.processing || {};

  return (
    <div style={styles.historyCard}>
      <div style={styles.historyHeader}>
        <div>
          <strong>{formatUpdatedAt(historyRow.capturedAt)}</strong>
          <p className="muted" style={{ margin: 0 }}>
            Captured by {historyRow.capturedByUser || "NAv"}
          </p>
        </div>
        <span style={styles.statusPill}>{historyRow.processingStatus}</span>
      </div>

      <div style={styles.historyGrid}>
        <DetailLine
          label="Account No(s)"
          value={historyRow.accountNos?.join(", ") || "NAv"}
        />
        <DetailLine label="Owner" value={historyRow.ownerLabel} />
        <DetailLine label="Occupant" value={historyRow.occupantLabel} />
        <DetailLine label="Media" value={`${formatNumber(historyRow.mediaCount)} item(s)`} />
      </div>

      <details style={styles.historyDetails}>
        <summary style={styles.historySummary}>View record details</summary>

        <div style={styles.detailsGrid}>
          <DetailSection title="Owner">
            <DetailLine label="Owner Type" value={getOwnerTypeLabel(historyRow.owner?.ownerType)} />
            <DetailLine label="Name" value={historyRow.ownerLabel} />
            <DetailLine label="ID / Registration" value={historyRow.owner?.naturalPerson?.idNumber || historyRow.owner?.juristicPerson?.registrationNumber || "NAv"} />
            <DetailLine label="Phone" value={historyRow.owner?.contact?.phone} />
            <DetailLine label="WhatsApp" value={historyRow.owner?.contact?.whatsapp} />
            <DetailLine label="Email" value={historyRow.owner?.contact?.email} />
          </DetailSection>

          <DetailSection title="Occupant">
            <DetailLine label="Name" value={historyRow.occupantLabel} />
            <DetailLine label="ID Number" value={historyRow.occupant?.idNumber} />
            <DetailLine label="Relationship" value={historyRow.occupant?.relationshipToOwner} />
            <DetailLine label="Phone" value={historyRow.occupant?.contact?.phone} />
            <DetailLine label="WhatsApp" value={historyRow.occupant?.contact?.whatsapp} />
            <DetailLine label="Email" value={historyRow.occupant?.contact?.email} />
          </DetailSection>

          <DetailSection title="Processing">
            <DetailLine label="Status" value={processing?.accountMasterStatus} />
            <DetailLine label="Processed At" value={formatUpdatedAt(processing?.processedAt)} />
            <DetailLine label="Error Code" value={processing?.errorCode} />
            <DetailLine label="Error Message" value={processing?.errorMessage} />
          </DetailSection>
        </div>

        <DetailSection title="Media Evidence">
          {media.length === 0 ? (
            <p className="muted">No media was captured on this record.</p>
          ) : (
            <div style={styles.mediaList}>
              {media.map((item, index) => (
                <a
                  key={`${item?.tag || "media"}-${index}`}
                  href={item?.url}
                  target="_blank"
                  rel="noreferrer"
                  style={styles.mediaLink}
                >
                  {item?.tag || `Media ${index + 1}`}
                </a>
              ))}
            </div>
          )}
        </DetailSection>
      </details>
    </div>
  );
}

export default function AccountsRegistryPage() {
  const { activeWorkbase } = useAuth();

  const [selectedWardPcode, setSelectedWardPcode] = useState("");
  const [sortConfig, setSortConfig] = useState({ key: "default", direction: "asc" });
  const [filters, setFilters] = useState({
    premiseAddress: "",
    erfNo: "",
    owner: "",
    ownerType: "ALL",
    accountSearch: "",
    accountCountMode: "ALL",
    meterSearch: "",
    meterCountMode: "ALL",
    reconciliationStatus: "ALL",
    historyStatus: "ALL",
  });
  const [modalState, setModalState] = useState({ type: "", row: null });
  const [historyRows, setHistoryRows] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

  const activeLmPcode = getActiveLmPcode(activeWorkbase);
  const activeWorkbaseName =
    activeWorkbase?.name ||
    activeWorkbase?.lmName ||
    activeWorkbase?.id ||
    activeWorkbase?.pcode ||
    "NAv";

  const { data: wardRows = [], isLoading: wardsLoading } =
    useGetRegistryWardsByLmQuery(activeLmPcode || skipToken);

  const defaultWard = useMemo(() => {
    return (
      wardRows.find((ward) => ward.premiseCount > 0) || wardRows[0] || null
    );
  }, [wardRows]);

  const userSelectedWard = useMemo(() => {
    return wardRows.find((ward) => ward.wardPcode === selectedWardPcode) || null;
  }, [wardRows, selectedWardPcode]);

  const effectiveSelectedWardPcode =
    userSelectedWard?.wardPcode || defaultWard?.wardPcode || "";
  const selectedWard = userSelectedWard || defaultWard;

  const {
    data: accountRows = [],
    isLoading,
    isFetching,
    error,
  } = useGetRegistryAccountsByWardQuery(effectiveSelectedWardPcode || skipToken);

  const [getHistoryByPremise] = useLazyGetFieldAccountDataHistoryByPremiseQuery();

  const totals = accountRows.reduce(
    (accumulator, row) => {
      accumulator.accounts += row.accountCount || 0;
      accumulator.meters += row.meterCount || 0;

      if (row.ownerType === "NATURAL_PERSON") accumulator.naturalOwners += 1;
      if (row.ownerType === "JURISTIC_PERSON") accumulator.juristicOwners += 1;
      if (row.reconciliationStatus === "BALANCED") accumulator.balanced += 1;
      if (row.reconciliationStatus === "WARNING") accumulator.warning += 1;
      if (row.reconciliationStatus === "ERROR") accumulator.error += 1;

      return accumulator;
    },
    {
      accounts: 0,
      meters: 0,
      naturalOwners: 0,
      juristicOwners: 0,
      balanced: 0,
      warning: 0,
      error: 0,
    },
  );

  const filteredRows = useMemo(() => {
    return accountRows.filter((row) => {
      const accountSearchMatch = !filters.accountSearch
        ? true
        : row.accounts.some((account) =>
            includesText(account.accountNo, filters.accountSearch),
          );

      const meterSearchMatch = !filters.meterSearch
        ? true
        : row.meters.some(
            (meter) =>
              includesText(meter.meterNo, filters.meterSearch) ||
              includesText(meter.meterId, filters.meterSearch),
          );

      return (
        includesText(row.premiseAddress, filters.premiseAddress) &&
        includesText(row.erfNo, filters.erfNo) &&
        includesText(row.ownerLabel, filters.owner) &&
        (filters.ownerType === "ALL" || row.ownerType === filters.ownerType) &&
        accountSearchMatch &&
        countFilterMatches(row.accountCount, filters.accountCountMode) &&
        meterSearchMatch &&
        countFilterMatches(row.meterCount, filters.meterCountMode) &&
        (filters.reconciliationStatus === "ALL" ||
          row.reconciliationStatus === filters.reconciliationStatus) &&
        (filters.historyStatus === "ALL" ||
          row.historyStatus === filters.historyStatus)
      );
    });
  }, [accountRows, filters]);

  const sortedRows = useMemo(() => {
    const rows = [...filteredRows];

    if (!sortConfig?.key || sortConfig.key === "default") {
      return rows.sort(compareDefaultRows);
    }

    return rows.sort((a, b) => {
      const compare = compareNatural(
        getSortValue(a, sortConfig.key),
        getSortValue(b, sortConfig.key),
      );

      return sortConfig.direction === "desc" ? compare * -1 : compare;
    });
  }, [filteredRows, sortConfig]);

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function handleSort(sortKey) {
    setSortConfig((current) => {
      if (current.key !== sortKey) {
        return { key: sortKey, direction: "asc" };
      }

      if (current.direction === "asc") {
        return { key: sortKey, direction: "desc" };
      }

      return { key: "default", direction: "asc" };
    });
  }

  function handleWardChange(value) {
    setSelectedWardPcode(value);
  }

  function openModal(type, row) {
    setModalState({ type, row });
  }

  function closeModal() {
    setModalState({ type: "", row: null });
    setHistoryRows([]);
    setHistoryError("");
    setHistoryLoading(false);
  }

  async function openHistoryModal(row) {
    openModal("history", row);
    setHistoryRows([]);
    setHistoryError("");
    setHistoryLoading(true);

    try {
      const rows = await getHistoryByPremise(row.premiseId).unwrap();
      setHistoryRows(Array.isArray(rows) ? rows : []);
    } catch (historyLoadError) {
      console.error("AccountsRegistryPage history error:", historyLoadError);
      setHistoryError(
        historyLoadError?.message || "Could not load field account data history.",
      );
    } finally {
      setHistoryLoading(false);
    }
  }

  const selectedRow = modalState.row;

  return (
    <>
      <header className="console-header">
        <div>
          <p className="eyebrow">Registry</p>
          <h1>Account Registry</h1>

          <p className="muted">
            Showing read-only registry_accounts rows for {activeWorkbaseName}.
          </p>

          <Link className="text-link" to="/registries">
            ← Back to Registries
          </Link>
        </div>

        <div className="role-pill">
          {isFetching
            ? "Streaming..."
            : `${formatNumber(sortedRows.length)} account registry rows`}
        </div>
      </header>

      <section className="filter-panel">
        <label>
          Ward
          <select
            value={effectiveSelectedWardPcode}
            onChange={(event) => handleWardChange(event.target.value)}
            disabled={wardsLoading || wardRows.length === 0}
          >
            <option value="">Select ward</option>

            {wardRows.map((ward) => (
              <option key={ward.wardPcode} value={ward.wardPcode}>
                Ward {ward.wardNumber} · {formatNumber(ward.premiseCount)} premises
              </option>
            ))}
          </select>
        </label>

        <div className="filter-summary">
          <strong>{getWardLabel(selectedWard)}</strong>
          <span>{effectiveSelectedWardPcode || "No ward selected"}</span>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="stat-card">
          <span>Premises</span>
          <strong>{formatNumber(accountRows.length)}</strong>
        </div>

        <div className="stat-card">
          <span>Filtered Rows</span>
          <strong>{formatNumber(sortedRows.length)}</strong>
        </div>

        <div className="stat-card">
          <span>Accounts</span>
          <strong>{formatNumber(totals.accounts)}</strong>
        </div>

        <div className="stat-card">
          <span>Meters</span>
          <strong>{formatNumber(totals.meters)}</strong>
        </div>

        <div className="stat-card">
          <span>Natural Owners</span>
          <strong>{formatNumber(totals.naturalOwners)}</strong>
        </div>

        <div className="stat-card">
          <span>Juristic Owners</span>
          <strong>{formatNumber(totals.juristicOwners)}</strong>
        </div>

        <div className="stat-card">
          <span>Balanced</span>
          <strong>{formatNumber(totals.balanced)}</strong>
        </div>

        <div className="stat-card">
          <span>LM PCode</span>
          <strong>{activeLmPcode || "NAv"}</strong>
        </div>
      </section>

      <section className="table-panel">
        {!effectiveSelectedWardPcode ? (
          <div className="empty-state">
            <h2>Select a ward</h2>
            <p className="muted">
              Account Registry is ward-scoped for clean registry browsing.
            </p>
          </div>
        ) : null}

        {error ? (
          <div className="empty-state error-box">
            <h2>Could not load account registry</h2>
            <p className="muted">
              Check Firestore rules, registry_accounts, or the ward field used by
              the query.
            </p>
          </div>
        ) : null}

        {isLoading ? (
          <div className="empty-state">
            <h2>Loading account registry...</h2>
            <p className="muted">Opening Firestore stream.</p>
          </div>
        ) : null}

        {!isLoading &&
        effectiveSelectedWardPcode &&
        accountRows.length === 0 &&
        !error ? (
          <div className="empty-state">
            <h2>No account registry rows found</h2>
            <p className="muted">
              No account registry rows were returned for ward {effectiveSelectedWardPcode}.
            </p>
          </div>
        ) : null}

        {accountRows.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>
                    <SortButton
                      label="Premise Address"
                      sortKey="premiseAddress"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterInput
                      value={filters.premiseAddress}
                      onChange={(value) => updateFilter("premiseAddress", value)}
                      placeholder="Filter address"
                    />
                  </th>
                  <th>
                    <SortButton
                      label="Ward"
                      sortKey="ward"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterSelect
                      value={effectiveSelectedWardPcode}
                      onChange={handleWardChange}
                    >
                      <option value="">Select ward</option>
                      {wardRows.map((ward) => (
                        <option key={ward.wardPcode} value={ward.wardPcode}>
                          Ward {ward.wardNumber}
                        </option>
                      ))}
                    </FilterSelect>
                  </th>
                  <th>
                    <SortButton
                      label="ERF No"
                      sortKey="erfNo"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterInput
                      value={filters.erfNo}
                      onChange={(value) => updateFilter("erfNo", value)}
                      placeholder="ERF"
                    />
                  </th>
                  <th>
                    <SortButton
                      label="Owner"
                      sortKey="owner"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterInput
                      value={filters.owner}
                      onChange={(value) => updateFilter("owner", value)}
                      placeholder="Owner"
                    />
                  </th>
                  <th>
                    <SortButton
                      label="Owner Type"
                      sortKey="ownerType"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterSelect
                      value={filters.ownerType}
                      onChange={(value) => updateFilter("ownerType", value)}
                    >
                      <option value="ALL">All</option>
                      <option value="NATURAL_PERSON">Natural Person</option>
                      <option value="JURISTIC_PERSON">Juristic Person</option>
                    </FilterSelect>
                  </th>
                  <th>
                    <SortButton
                      label="Accounts"
                      sortKey="accounts"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterInput
                      value={filters.accountSearch}
                      onChange={(value) => updateFilter("accountSearch", value)}
                      placeholder="Account no"
                    />
                    <FilterSelect
                      value={filters.accountCountMode}
                      onChange={(value) => updateFilter("accountCountMode", value)}
                    >
                      <option value="ALL">Any count</option>
                      <option value="ZERO">0</option>
                      <option value="ONE">1</option>
                      <option value="MULTIPLE">2+</option>
                    </FilterSelect>
                  </th>
                  <th>
                    <SortButton
                      label="Meters"
                      sortKey="meters"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterInput
                      value={filters.meterSearch}
                      onChange={(value) => updateFilter("meterSearch", value)}
                      placeholder="Meter no"
                    />
                    <FilterSelect
                      value={filters.meterCountMode}
                      onChange={(value) => updateFilter("meterCountMode", value)}
                    >
                      <option value="ALL">Any count</option>
                      <option value="ZERO">0</option>
                      <option value="ONE">1</option>
                      <option value="MULTIPLE">2+</option>
                    </FilterSelect>
                  </th>
                  <th>
                    <SortButton
                      label="Reconciliation"
                      sortKey="reconciliation"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterSelect
                      value={filters.reconciliationStatus}
                      onChange={(value) =>
                        updateFilter("reconciliationStatus", value)
                      }
                    >
                      <option value="ALL">All</option>
                      <option value="BALANCED">Balanced</option>
                      <option value="WARNING">Warning</option>
                      <option value="ERROR">Error</option>
                    </FilterSelect>
                  </th>
                  <th>
                    <SortButton
                      label="History"
                      sortKey="history"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterSelect
                      value={filters.historyStatus}
                      onChange={(value) => updateFilter("historyStatus", value)}
                    >
                      <option value="ALL">All</option>
                      <option value="HAS_HISTORY">Has history</option>
                      <option value="NO_HISTORY">No history</option>
                    </FilterSelect>
                  </th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {sortedRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.premiseAddress}</strong>
                      <div className="muted" style={styles.smallMuted}>
                        {row.premiseId}
                      </div>
                    </td>
                    <td>{row.wardPcode}</td>
                    <td>{row.erfNo}</td>
                    <td>{row.ownerLabel}</td>
                    <td>{getOwnerTypeLabel(row.ownerType)}</td>
                    <td>
                      <CountPill
                        count={row.accountCount}
                        label={row.accountCount === 1 ? "Account" : "Accounts"}
                        onClick={() => openModal("accounts", row)}
                      />
                    </td>
                    <td>
                      <CountPill
                        count={row.meterCount}
                        label={row.meterCount === 1 ? "Meter" : "Meters"}
                        onClick={() => openModal("meters", row)}
                      />
                    </td>
                    <td>
                      <span style={styles.statusPill}>{row.reconciliationStatus}</span>
                    </td>
                    <td>
                      <button
                        type="button"
                        style={styles.textButton}
                        onClick={() => openHistoryModal(row)}
                      >
                        {row.historyStatus === "HAS_HISTORY"
                          ? "View History"
                          : "No History"}
                      </button>
                    </td>
                    <td>
                      <button
                        type="button"
                        style={styles.actionButton}
                        onClick={() => openModal("details", row)}
                      >
                        View Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {modalState.type === "accounts" && selectedRow ? (
        <ModalShell
          title="Accounts linked to this premise"
          subtitle={selectedRow.premiseAddress}
          onClose={closeModal}
        >
          <SimpleListTable
            columns={[
              {
                key: "accountNo",
                label: "Account No",
                render: (account) => account.accountNo || "NAv",
              },
              {
                key: "accountMasterId",
                label: "Account Master ID",
                render: (_account, index) =>
                  selectedRow.refs?.accountMasterIds?.[index] || "NAv",
              },
            ]}
            rows={selectedRow.accounts}
            emptyText="No accounts are linked to this premise row."
          />
        </ModalShell>
      ) : null}

      {modalState.type === "meters" && selectedRow ? (
        <ModalShell
          title="Meters linked to this premise"
          subtitle={selectedRow.premiseAddress}
          onClose={closeModal}
        >
          <SimpleListTable
            columns={[
              {
                key: "meterNo",
                label: "Meter No",
                render: (meter) => meter.meterNo || "NAv",
              },
              {
                key: "meterId",
                label: "Meter ID",
                render: (meter) => meter.meterId || "NAv",
              },
            ]}
            rows={selectedRow.meters}
            emptyText="No meters are linked to this premise row."
          />
        </ModalShell>
      ) : null}

      {modalState.type === "details" && selectedRow ? (
        <ModalShell
          title="Account Registry Details"
          subtitle={selectedRow.premiseAddress}
          onClose={closeModal}
          wide
        >
          <div style={styles.detailsGrid}>
            <DetailSection title="Premise">
              <DetailLine label="Premise ID" value={selectedRow.premiseId} />
              <DetailLine label="Address" value={selectedRow.premiseAddress} />
              <DetailLine label="Property Type" value={selectedRow.propertyType} />
              <DetailLine label="ERF No" value={selectedRow.erfNo} />
              <DetailLine label="Ward" value={selectedRow.wardPcode} />
              <DetailLine label="LM" value={selectedRow.lmPcode} />
            </DetailSection>

            <DetailSection title="Owner">
              <DetailLine label="Owner Type" value={getOwnerTypeLabel(selectedRow.ownerType)} />
              <DetailLine label="Owner" value={selectedRow.ownerLabel} />
              <DetailLine label="ID / Registration" value={selectedRow.owner?.naturalPerson?.idNumber || selectedRow.owner?.juristicPerson?.registrationNumber || "NAv"} />
              <DetailLine label="Phone" value={selectedRow.owner?.contact?.phone} />
              <DetailLine label="WhatsApp" value={selectedRow.owner?.contact?.whatsapp} />
              <DetailLine label="Email" value={selectedRow.owner?.contact?.email} />
              {!ownerHasDetails(selectedRow.owner) ? (
                <p className="muted">No owner details captured.</p>
              ) : null}
            </DetailSection>

            <DetailSection title="Occupant">
              <DetailLine label="Occupant" value={selectedRow.occupantLabel} />
              <DetailLine label="ID Number" value={selectedRow.occupant?.idNumber} />
              <DetailLine label="Relationship" value={selectedRow.occupant?.relationshipToOwner} />
              <DetailLine label="Phone" value={selectedRow.occupant?.contact?.phone} />
              <DetailLine label="WhatsApp" value={selectedRow.occupant?.contact?.whatsapp} />
              <DetailLine label="Email" value={selectedRow.occupant?.contact?.email} />
              {!occupantHasDetails(selectedRow.occupant) ? (
                <p className="muted">No occupant details captured.</p>
              ) : null}
            </DetailSection>

            <DetailSection title="Reconciliation">
              <DetailLine label="Status" value={selectedRow.reconciliationStatus} />
              <DetailLine label="Checked At" value={formatUpdatedAt(selectedRow.reconciliation?.checkedAt)} />
              <DetailLine
                label="Exceptions"
                value={`${formatNumber(selectedRow.reconciliationExceptions.length)} exception(s)`}
              />
              {selectedRow.reconciliationExceptions.length > 0 ? (
                <ul style={styles.exceptionList}>
                  {selectedRow.reconciliationExceptions.map((exception, index) => (
                    <li key={`${exception?.code || "exception"}-${index}`}>
                      <strong>{exception?.code || "NAv"}</strong> — {exception?.message || "NAv"}
                    </li>
                  ))}
                </ul>
              ) : null}
            </DetailSection>
          </div>

          <DetailSection title="Accounts">
            <SimpleListTable
              columns={[
                {
                  key: "accountNo",
                  label: "Account No",
                  render: (account) => account.accountNo || "NAv",
                },
                {
                  key: "accountMasterId",
                  label: "Account Master ID",
                  render: (_account, index) =>
                    selectedRow.refs?.accountMasterIds?.[index] || "NAv",
                },
              ]}
              rows={selectedRow.accounts}
              emptyText="No accounts are linked to this premise row."
            />
          </DetailSection>

          <DetailSection title="Meters">
            <SimpleListTable
              columns={[
                {
                  key: "meterNo",
                  label: "Meter No",
                  render: (meter) => meter.meterNo || "NAv",
                },
                {
                  key: "meterId",
                  label: "Meter ID",
                  render: (meter) => meter.meterId || "NAv",
                },
              ]}
              rows={selectedRow.meters}
              emptyText="No meters are linked to this premise row."
            />
          </DetailSection>
        </ModalShell>
      ) : null}

      {modalState.type === "history" && selectedRow ? (
        <ModalShell
          title="Field Account Data History"
          subtitle={selectedRow.premiseAddress}
          onClose={closeModal}
          wide
        >
          {historyLoading ? (
            <div className="empty-state">
              <h2>Loading history...</h2>
              <p className="muted">Reading field_account_data for this premise.</p>
            </div>
          ) : null}

          {historyError ? (
            <div className="empty-state error-box">
              <h2>Could not load history</h2>
              <p className="muted">{historyError}</p>
            </div>
          ) : null}

          {!historyLoading && !historyError && historyRows.length === 0 ? (
            <p className="muted">No field account data history found.</p>
          ) : null}

          {!historyLoading && historyRows.length > 0 ? (
            <>
              <div style={styles.historySummaryGrid}>
                <DetailLine label="Premise" value={selectedRow.premiseAddress} />
                <DetailLine label="ERF No" value={selectedRow.erfNo} />
                <DetailLine label="Ward" value={selectedRow.wardPcode} />
                <DetailLine label="History Records" value={formatNumber(historyRows.length)} />
              </div>

              <div style={styles.timelineList}>
                {historyRows.map((historyRow) => (
                  <HistoryCard key={historyRow.id} historyRow={historyRow} />
                ))}
              </div>
            </>
          ) : null}
        </ModalShell>
      ) : null}
    </>
  );
}

const styles = {
  sortButton: {
    width: "100%",
    border: 0,
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.4rem",
    padding: 0,
    fontWeight: 900,
    textAlign: "left",
  },
  headerInput: {
    width: "100%",
    minWidth: "8rem",
    marginTop: "0.4rem",
    border: "1px solid #cbd5e1",
    borderRadius: "0.45rem",
    padding: "0.36rem 0.45rem",
    fontSize: "0.72rem",
  },
  headerSelect: {
    width: "100%",
    minWidth: "7.5rem",
    marginTop: "0.4rem",
    border: "1px solid #cbd5e1",
    borderRadius: "0.45rem",
    padding: "0.36rem 0.45rem",
    fontSize: "0.72rem",
    background: "#ffffff",
  },
  countPill: {
    border: "1px solid #bfdbfe",
    background: "#eff6ff",
    color: "#1d4ed8",
    borderRadius: "999px",
    padding: "0.35rem 0.65rem",
    fontWeight: 900,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  actionButton: {
    border: 0,
    background: "#0f172a",
    color: "#ffffff",
    borderRadius: "0.65rem",
    padding: "0.5rem 0.7rem",
    fontWeight: 900,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  textButton: {
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#0f172a",
    borderRadius: "0.65rem",
    padding: "0.46rem 0.62rem",
    fontWeight: 850,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  statusPill: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: "999px",
    background: "#f1f5f9",
    color: "#0f172a",
    border: "1px solid #cbd5e1",
    padding: "0.28rem 0.55rem",
    fontSize: "0.76rem",
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  smallMuted: {
    fontSize: "0.72rem",
    marginTop: "0.25rem",
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(15, 23, 42, 0.58)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "1.25rem",
    zIndex: 1000,
  },
  modalCard: {
    width: "min(720px, 96vw)",
    maxHeight: "88vh",
    overflow: "auto",
    background: "#ffffff",
    borderRadius: "1.25rem",
    boxShadow: "0 24px 60px rgba(15, 23, 42, 0.35)",
  },
  modalWide: {
    width: "min(1120px, 96vw)",
    maxHeight: "88vh",
    overflow: "auto",
    background: "#ffffff",
    borderRadius: "1.25rem",
    boxShadow: "0 24px 60px rgba(15, 23, 42, 0.35)",
  },
  modalHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "1rem",
    padding: "1.15rem 1.25rem",
    borderBottom: "1px solid #e2e8f0",
  },
  modalEyebrow: {
    margin: 0,
  },
  modalTitle: {
    margin: "0.1rem 0 0",
  },
  modalBody: {
    padding: "1.25rem",
  },
  closeButton: {
    border: 0,
    background: "#f1f5f9",
    color: "#0f172a",
    borderRadius: "0.85rem",
    width: "2.4rem",
    height: "2.4rem",
    fontWeight: 900,
    cursor: "pointer",
  },
  detailsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(245px, 1fr))",
    gap: "0.9rem",
  },
  detailSection: {
    border: "1px solid #e2e8f0",
    borderRadius: "0.95rem",
    padding: "0.9rem",
    marginBottom: "0.9rem",
    background: "#f8fafc",
  },
  detailTitle: {
    margin: "0 0 0.65rem",
    fontSize: "0.95rem",
  },
  detailLine: {
    display: "flex",
    justifyContent: "space-between",
    gap: "0.75rem",
    borderBottom: "1px solid #e2e8f0",
    padding: "0.45rem 0",
  },
  detailLabel: {
    color: "#64748b",
    fontSize: "0.78rem",
    fontWeight: 850,
  },
  detailValue: {
    color: "#0f172a",
    textAlign: "right",
    fontSize: "0.82rem",
    wordBreak: "break-word",
  },
  exceptionList: {
    margin: "0.75rem 0 0",
    paddingLeft: "1.1rem",
  },
  historySummaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: "0.85rem",
    marginBottom: "1rem",
  },
  timelineList: {
    display: "grid",
    gap: "0.85rem",
  },
  historyCard: {
    border: "1px solid #e2e8f0",
    borderRadius: "1rem",
    padding: "1rem",
    background: "#ffffff",
  },
  historyHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "0.8rem",
    marginBottom: "0.8rem",
  },
  historyGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "0.75rem",
  },
  historyDetails: {
    marginTop: "0.85rem",
  },
  historySummary: {
    cursor: "pointer",
    fontWeight: 900,
    color: "#1d4ed8",
  },
  mediaList: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.55rem",
  },
  mediaLink: {
    border: "1px solid #bfdbfe",
    borderRadius: "999px",
    background: "#eff6ff",
    color: "#1d4ed8",
    padding: "0.38rem 0.65rem",
    textDecoration: "none",
    fontSize: "0.8rem",
    fontWeight: 900,
  },
};
