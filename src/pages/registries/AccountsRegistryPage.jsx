/* eslint-disable no-unused-vars -- JSX tags are consumed by React; this ESLint profile does not track them. */
import { irepsTableDateRange as getUpdatedAtFilterRange } from "../../components/table/irepsTableModel.js";
import IrepsTable, { IrepsTableFilterInput as FilterInput, IrepsTableFilterSelect as FilterSelect } from "../../components/table/IrepsTable";
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../auth/useAuth";
import { useGeo } from "../../context/GeoContext";
import { useGetRegistryAccountsByWardQuery,
  useLazyGetFieldAccountDataHistoryByPremiseQuery,
} from "../../redux/registryAccountsApi";
import { useGetRegistryWardsByLmQuery } from "../../redux/registryWardsApi";

// ONE CLOCK. This page kept its own copy that did `value.slice(0, 19)`,
// which chops the Z off a UTC timestamp and prints it as if it were the
// reader's own clock - two hours behind, every time (owner, 11 October
// 2026). The shared formatter converts instead of truncating.
import { formatSastDateTime as formatUpdatedAt } from "../../utils/formatSastDateTime";
const EMPTY_ROWS = [];

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

function getUpdatedAtMs(value) {
  if (!value || value === "NAv") return 0;

  if (typeof value?.toDate === "function") {
    const ms = value.toDate().getTime();
    return Number.isFinite(ms) ? ms : 0;
  }

  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
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

function getWardNumberDisplay(wardPcode = "") {
  const wardNumber = getWardNumberFromPcode(wardPcode);
  return wardNumber > 0 ? wardNumber : "NAv";
}

function getSelectedWardPcodeFromGeo(geoState) {
  const selectedWard = geoState?.selectedWard || null;

  return selectedWard?.id || selectedWard?.pcode || selectedWard?.wardPcode || "";
}

function buildRegistryWardSelection(ward, fallbackWardPcode = "") {
  const wardPcode = ward?.wardPcode || ward?.pcode || ward?.id || fallbackWardPcode || "";

  if (!wardPcode) return null;

  const wardNumber = ward?.wardNumber || ward?.code || getWardNumberFromPcode(wardPcode) || "NAv";

  return {
    ...(ward || {}),
    id: wardPcode,
    pcode: wardPcode,
    wardPcode,
    code: wardNumber,
    wardNumber,
    name: ward?.wardName || ward?.name || `Ward ${wardNumber}`,
  };
}

const EMPTY_ACCOUNT_FILTERS = {
  premiseAddress: "",
  erfNo: "",
  owner: "",
  ownerType: "ALL",
  accountSearch: "",
  accountCountMode: "ALL",
  meterSearch: "",
  meterCountMode: "ALL",
  historyStatus: "ALL",
};

function getOwnerTypeLabel(ownerType) {
  if (ownerType === "NATURAL_PERSON") return "Natural Person";
  if (ownerType === "JURISTIC_PERSON") return "Juristic Person";
  return ownerType || "NAv";
}

function getSortValue(row, key) {
  if (key === "premiseAddress") return row.premiseAddress || "";
  if (key === "ward") return getWardNumberFromPcode(row.wardPcode);
  if (key === "erfNo") return row.erfNo || "";
  if (key === "owner") return row.ownerLabel || "";
  if (key === "ownerType") return row.ownerType || "";
  if (key === "accounts") return row.accountCount || 0;
  if (key === "meters") return row.meterCount || 0;
  if (key === "history") return row.historySortValue || 0;
  if (key === "updatedAt") return getUpdatedAtMs(row.updatedAt);

  return "";
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

function CountPill({ count, label, onClick }) {
  return (
    <button
      type="button"
      style={styles.countPill}
      onClick={onClick}
      title={label || "View linked records"}
      aria-label={label || "View linked records"}
    >
      {formatNumber(count)}
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
 // Preserve the original index used by parallel accountMasterIds references.
 const records = rows.map((source, sourceIndex) => ({ source, sourceIndex }));
 const tableColumns = columns.map(column => ({ ...column, filter: "text", value: record => column.render(record.source, record.sourceIndex), render: record => column.render(record.source, record.sourceIndex) }));
 const title = columns.some(column => column.key === "accountNo") ? "Linked accounts" : "Linked meters";
 return <IrepsTable
                title={title}
                rows={records}
                columns={tableColumns}
                rowKey={record => record.source.id || record.sourceIndex}
                emptyText={emptyText}
                downloads={{
                  fileBaseName: title.replaceAll(" ", "_"),
                  scope: {
                    label: "Selected premise"
                  }
                }}
              />;
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

const EMPTY_UPDATED_AT_FILTER = {
  mode: "ALL",
  startDate: "",
  endDate: "",
};

function getUpdatedAtDate(value) {
  if (!value || value === "NAv") return null;

  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value?.seconds === "number") {
    const date = new Date(value.seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function matchesUpdatedAtFilter(value, filter = EMPTY_UPDATED_AT_FILTER) {
  if (!filter || filter.mode === "ALL") return true;

  const rowDate = getUpdatedAtDate(value);
  if (!rowDate) return false;

  const { start, end } = getUpdatedAtFilterRange(filter);

  if (start && rowDate < start) return false;
  if (end && rowDate > end) return false;

  return true;
}

export default function AccountsRegistryPage() {
  const { activeWorkbase, role } = useAuth();
  const { geoState, updateGeo } = useGeo();

  const selectedWardPcode = getSelectedWardPcodeFromGeo(geoState);

  const [filters, setFilters] = useState(EMPTY_ACCOUNT_FILTERS);

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

  const selectedWard = useMemo(() => {
    const registryWard = wardRows.find((ward) => ward.wardPcode === selectedWardPcode) || null;
    return buildRegistryWardSelection(registryWard, selectedWardPcode);
  }, [wardRows, selectedWardPcode]);

  const effectiveSelectedWardPcode = selectedWard?.wardPcode || "";

  const {
    data: accountRows = EMPTY_ROWS,
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
      return accumulator;
    },
    {
      accounts: 0,
      meters: 0,
      naturalOwners: 0,
      juristicOwners: 0,
    },
  );

  const filterRegistryRows = useCallback((rows, tableFilters) => {
    const filters = {
      ...EMPTY_ACCOUNT_FILTERS,
      ...tableFilters
    };
    for (const key of Object.keys(EMPTY_ACCOUNT_FILTERS)) {
      if (EMPTY_ACCOUNT_FILTERS[key] === "ALL" && !filters[key]) filters[key] = "ALL";
    }
    const updatedAtFilter = tableFilters.updatedAt || EMPTY_UPDATED_AT_FILTER;
    return rows.filter(row => {
      const accountSearchMatch = !filters.accountSearch ? true : row.accounts.some(account => includesText(account.accountNo, filters.accountSearch));
      const meterSearchMatch = !filters.meterSearch ? true : row.meters.some(meter => includesText(meter.meterNo, filters.meterSearch) || includesText(meter.meterId, filters.meterSearch));
      return includesText(row.premiseAddress, filters.premiseAddress) && includesText(row.erfNo, filters.erfNo) && includesText(row.ownerLabel, filters.owner) && (filters.ownerType === "ALL" || row.ownerType === filters.ownerType) && accountSearchMatch && countFilterMatches(row.accountCount, filters.accountCountMode) && meterSearchMatch && countFilterMatches(row.meterCount, filters.meterCountMode) && (filters.historyStatus === "ALL" || row.historyStatus === filters.historyStatus) && matchesUpdatedAtFilter(row.updatedAt, updatedAtFilter);
    });
  }, []);

  const filteredRows = useMemo(() => filterRegistryRows(accountRows, filters), [accountRows, filters, filterRegistryRows]);

  const quickDownloadColumns = useMemo(
    () => [
      {
        header: "Premise Address",
        value: (row) => {
          const address = row.premiseAddress || "NAv";
          const premiseId = row.premiseId || "NAv";
          return `${address}\n${premiseId}`;
        },
      },
      {
        header: "Ward",
        value: (row) => getWardNumberDisplay(row.wardPcode),
      },
      {
        header: "ERF No",
        value: (row) => row.erfNo || "NAv",
      },
      {
        header: "Owner",
        value: (row) => row.ownerLabel || "NAv",
      },
      {
        header: "Owner Type",
        value: (row) => getOwnerTypeLabel(row.ownerType),
      },
      {
        header: "Accounts",
        value: (row) => row.accountCount || 0,
      },
      {
        header: "Meters",
        value: (row) => row.meterCount || 0,
      },
      {
        header: "History",
        value: (row) => row.historyStatus === "HAS_HISTORY" ? "Has history" : "No history",
      },
      {
        header: "updatedAt",
        value: (row) => formatUpdatedAt(row.updatedAt),
      },
    ],
    [],
  );

  const quickDownloadScope = useMemo(
    () => ({
      lmName: activeWorkbaseName,
      lmPcode: activeLmPcode || "NAv",
      wardLabel: getWardLabel(selectedWard),
      wardPcode: effectiveSelectedWardPcode || "NAv",
    }),
    [activeWorkbaseName, activeLmPcode, selectedWard, effectiveSelectedWardPcode],
  );

  function updateFilter(key, value) {

    setFilters((current) => ({ ...current, [key]: value }));
  }

  function resetAccountRegistryControls() {
    setFilters(EMPTY_ACCOUNT_FILTERS);

  }

  function handleWardChange(value) {
    const nextWard = wardRows.find((ward) => ward.wardPcode === value) || null;

    resetAccountRegistryControls();

    updateGeo({
      selectedWard: buildRegistryWardSelection(nextWard, value),
      lastSelectionType: value ? "WARD" : null,
    });
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

  const visiblePremiseSummary = !effectiveSelectedWardPcode
    ? "No ward selected"
    : filteredRows.length === accountRows.length
      ? `Showing ${formatNumber(accountRows.length)} account registry premise(s)`
      : `Showing ${formatNumber(filteredRows.length)} of ${formatNumber(accountRows.length)} account registry premise(s)`;

  const registryColumns = [{
    key: "premiseAddress",
    label: "Premise Address",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "premiseAddress"),
    sortValue: row => getSortValue(row, "premiseAddress"),
    render: row => {
      return <><strong>{row.premiseAddress}</strong>
                              <div className="muted" style={styles.smallMuted}>
                                {row.premiseId}
                              </div></>;
    }
  }, {
    key: "ward",
    label: "Ward",
    filter: null,
    sortable: true,
    value: row => getSortValue(row, "ward"),
    sortValue: row => getSortValue(row, "ward"),
    render: row => {
      return <>{getWardNumberDisplay(row.wardPcode)}</>;
    },
    renderFilter: () => <><FilterSelect aria-label="Registry ward scope" value={effectiveSelectedWardPcode} onChange={handleWardChange}>
                            <option value="">Select ward</option>
                            {wardRows.map(ward => <option key={ward.wardPcode} value={ward.wardPcode}>
                                Ward {ward.wardNumber}
                              </option>)}
                          </FilterSelect></>,
    isFilterActive: () => false
  }, {
    key: "erfNo",
    label: "ERF No",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "erfNo"),
    sortValue: row => getSortValue(row, "erfNo"),
    render: row => {
      return <>{row.erfNo}</>;
    }
  }, {
    key: "owner",
    label: "Owner",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "owner"),
    sortValue: row => getSortValue(row, "owner"),
    render: row => {
      return <>{row.ownerLabel}</>;
    }
  }, {
    key: "ownerType",
    label: "Owner Type",
    filter: "select",
    sortable: true,
    value: row => getSortValue(row, "ownerType"),
    sortValue: row => getSortValue(row, "ownerType"),
    render: row => {
      return <>{getOwnerTypeLabel(row.ownerType)}</>;
    },
    filterAllValue: "ALL",
    filterOptions: [{
      value: "NATURAL_PERSON",
      label: "Natural Person"
    }, {
      value: "JURISTIC_PERSON",
      label: "Juristic Person"
    }]
  }, {
    key: "accounts",
    label: "Accounts",
    filter: null,
    sortable: true,
    value: row => getSortValue(row, "accounts"),
    sortValue: row => getSortValue(row, "accounts"),
    render: row => {
      return <><CountPill count={row.accountCount} label={row.accountCount === 1 ? "Account" : "Accounts"} onClick={() => openModal("accounts", row)} /></>;
    },
    renderFilter: () => <><div style={styles.pairedFilters}>
                            <FilterInput value={filters.accountSearch} onChange={value => updateFilter("accountSearch", value)} placeholder="Account no" style={styles.pairedFilterInput} />
                            <FilterSelect aria-label="Filter account count" value={filters.accountCountMode} onChange={value => updateFilter("accountCountMode", value)} style={styles.pairedFilterSelect}>
                              <option value="ALL">Any</option>
                              <option value="ZERO">0</option>
                              <option value="ONE">1</option>
                              <option value="MULTIPLE">2+</option>
                            </FilterSelect>
                          </div></>,
    isFilterActive: filters => Boolean(filters.accountSearch && filters.accountSearch !== "ALL") || Boolean(filters.accountCountMode && filters.accountCountMode !== "ALL")
  }, {
    key: "meters",
    label: "Meters",
    filter: null,
    sortable: true,
    value: row => getSortValue(row, "meters"),
    sortValue: row => getSortValue(row, "meters"),
    render: row => {
      return <><CountPill count={row.meterCount} label={row.meterCount === 1 ? "Meter" : "Meters"} onClick={() => openModal("meters", row)} /></>;
    },
    renderFilter: () => <><div style={styles.pairedFilters}>
                            <FilterInput value={filters.meterSearch} onChange={value => updateFilter("meterSearch", value)} placeholder="Meter no" style={styles.pairedFilterInput} />
                            <FilterSelect aria-label="Filter meter count" value={filters.meterCountMode} onChange={value => updateFilter("meterCountMode", value)} style={styles.pairedFilterSelect}>
                              <option value="ALL">Any</option>
                              <option value="ZERO">0</option>
                              <option value="ONE">1</option>
                              <option value="MULTIPLE">2+</option>
                            </FilterSelect>
                          </div></>,
    isFilterActive: filters => Boolean(filters.meterSearch && filters.meterSearch !== "ALL") || Boolean(filters.meterCountMode && filters.meterCountMode !== "ALL")
  }, {
    key: "historyStatus",
    label: "History",
    filter: "select",
    sortable: true,
    value: row => getSortValue(row, "history"),
    sortValue: row => getSortValue(row, "history"),
    render: row => {
      return <><button type="button" style={styles.textButton} onClick={() => openHistoryModal(row)}>
                                {row.historyStatus === "HAS_HISTORY" ? "View History" : "No History"}
                              </button></>;
    },
    filterAllValue: "ALL",
    filterOptions: [{
      value: "HAS_HISTORY",
      label: "Has history"
    }, {
      value: "NO_HISTORY",
      label: "No history"
    }]
  }, {
    key: "actions",
    label: "Actions",
    filter: null,
    sortable: false,
    value: row => getSortValue(row, "actions"),
    sortValue: row => getSortValue(row, "actions"),
    render: row => {
      return <><button type="button" style={styles.actionButton} onClick={() => openModal("details", row)}>
                                View Details
                              </button></>;
    }
  }, {
    key: "updatedAt",
    label: "updatedAt",
    filter: "date",
    sortable: true,
    value: row => getSortValue(row, "updatedAt"),
    sortValue: row => getSortValue(row, "updatedAt"),
    render: row => {
      return <>{formatUpdatedAt(row.updatedAt)}</>;
    }
  }];

  return (
    <>
      <header className="console-header" style={styles.fixedRegistryHeader}>
        <div>
          <h1>Account Registry</h1>

          <p className="muted">Showing read-only registry_accounts rows.</p>

          <Link className="text-link" to="/registries">
            ← Back to Registries
          </Link>
        </div>

        <div className="topbar-right">
          <div className="workbase-pill">{activeWorkbaseName}</div>
          <div className="role-pill">{role || "NAv"}</div>
          <div className="role-pill">
            {isFetching
              ? "Streaming..."
              : `${formatNumber(filteredRows.length)} account registry rows`}
          </div>

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
                Ward {ward.wardNumber}
              </option>
            ))}
          </select>
        </label>

        <div className="filter-summary">
          <strong>{getWardLabel(selectedWard)}</strong>
          <span>{visiblePremiseSummary}</span>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="stat-card">
          <span>Premises</span>
          <strong>{formatNumber(accountRows.length)}</strong>
        </div>

        <div className="stat-card">
          <span>Filtered Rows</span>
          <strong>{formatNumber(filteredRows.length)}</strong>
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
          <span>Natural Person Owners</span>
          <strong>{formatNumber(totals.naturalOwners)}</strong>
        </div>

        <div className="stat-card">
          <span>Juristic Person Owners</span>
          <strong>{formatNumber(totals.juristicOwners)}</strong>
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
          <>

            <div className="table-wrap">
              <IrepsTable
                key={`${activeLmPcode}:${effectiveSelectedWardPcode}`}
                title="Accounts Registry"
                rows={accountRows}
                columns={registryColumns}
                rowKey={row => row.id}
                filters={filters}
                onFiltersChange={setFilters}
                filteredRows={filteredRows}
                filterRows={filterRegistryRows}
                defaultSort={{
                  key: "updatedAt",
                  direction: "desc"
                }}
                downloads={{
                  registryName: "Account Registry",
                  rowsLabel: "account registry rows",
                  columns: quickDownloadColumns,
                  fileBaseName: "accounts_registry",
                  scope: quickDownloadScope
                }}
              />
            </div>

          </>
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
  fixedRegistryHeader: {
    position: "sticky",
    top: 0,
    zIndex: 30,
    background: "#f8fafc",
    paddingTop: "0.35rem",
    paddingBottom: "0.85rem",
    boxShadow: "0 10px 24px rgba(15, 23, 42, 0.08)",
  },

  pairedFilters: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 7fr) minmax(0, 3fr)",
    gap: "0.35rem",
    alignItems: "end",
    marginTop: "0.4rem",
  },
  pairedFilterInput: {
    minWidth: 0,
    marginTop: 0,
  },
  pairedFilterSelect: {
    minWidth: 0,
    marginTop: 0,
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
