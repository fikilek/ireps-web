/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../../auth/useAuth";
import { useGetDemoSalesByLmPcodeQuery } from "../../redux/demoSalesApi";
import { useGetGeoFencesByLmQuery } from "../../redux/mapGeofencesApi";
import {
  useGetSalesOperationalStatsByLmQuery,
} from "../../redux/salesTargetedBatchApi";
import {
  ChartCard,
  HorizontalBarChart,
  PieChart,
  StackedBarChart,
} from "./stats/SalesStatsCharts";
import {
  ALL_FILTER,
  buildBatchPerformance,
  buildCategoryDistribution,
  buildCategoryMatrix,
  buildGeofenceOperationalStats,
  buildSalesPopulationRows,
  buildTargetedDashboardRows,
  cleanText,
  formatNumber,
  formatPercent,
  getActiveLmPcode,
  getActiveWorkbaseName,
  sortCategories,
  summarizeTargetedRows,
} from "./stats/salesStatsModel";

function uniqueSorted(values = []) {
  return Array.from(
    new Set(values.map(cleanText).filter(Boolean)),
  ).sort((left, right) =>
    left.localeCompare(right, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

function matchesGeofence(row, geofenceId) {
  if (geofenceId === ALL_FILTER) return true;

  return (Array.isArray(row?.geofenceRefs) ? row.geofenceRefs : []).some(
    (reference) => cleanText(reference?.id) === geofenceId,
  );
}

function getCountMap(rows, keyAccessor, valueAccessor = () => 1) {
  return rows.reduce((accumulator, row) => {
    const key = cleanText(keyAccessor(row)) || "NAv";
    accumulator[key] =
      Number(accumulator[key] || 0) + Number(valueAccessor(row) || 0);
    return accumulator;
  }, {});
}

function countMapToChartData(countMap = {}) {
  return Object.entries(countMap)
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value);
}

function KpiCard({ label, value, helper, tone = "default" }) {
  return (
    <article
      style={{
        ...styles.kpiCard,
        ...(tone === "positive" ? styles.kpiCardPositive : null),
        ...(tone === "warning" ? styles.kpiCardWarning : null),
      }}
    >
      <span style={styles.kpiLabel}>{label}</span>
      <strong style={styles.kpiValue}>{value}</strong>
      <span style={styles.kpiHelper}>{helper}</span>
    </article>
  );
}

function SectionHeader({ eyebrow, title, description, action }) {
  return (
    <div style={styles.sectionHeader}>
      <div>
        <p style={styles.sectionEyebrow}>{eyebrow}</p>
        <h2 style={styles.sectionTitle}>{title}</h2>
        {description ? (
          <p style={styles.sectionDescription}>{description}</p>
        ) : null}
      </div>

      {action || null}
    </div>
  );
}

function Th({ children }) {
  return <th style={styles.th}>{children}</th>;
}

function Td({ children, colSpan }) {
  return (
    <td style={styles.td} colSpan={colSpan}>
      {children}
    </td>
  );
}

function CategoryTable({ rows = [] }) {
  const total = rows.reduce((sum, row) => sum + Number(row.count || 0), 0);

  return (
    <div style={styles.tableWrap}>
      <table style={styles.table}>
        <thead>
          <tr>
            <Th>Sales Category</Th>
            <Th>Meter Count</Th>
            <Th>Share of Total</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <Td colSpan={3}>No Sales Category records match the filters.</Td>
            </tr>
          ) : null}

          {rows.map((row) => (
            <tr key={row.category}>
              <Td>
                <strong style={styles.primaryCell}>{row.category}</strong>
              </Td>
              <Td>{formatNumber(row.count)}</Td>
              <Td>{formatPercent(row.percentage)}</Td>
            </tr>
          ))}

          {rows.length > 0 ? (
            <tr>
              <Td>
                <strong>Total</strong>
              </Td>
              <Td>
                <strong>{formatNumber(total)}</strong>
              </Td>
              <Td>
                <strong>100.0%</strong>
              </Td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function MatrixTable({
  matrix,
  groupLabel,
  selectedId,
  onSelect,
}) {
  const categories = matrix?.categories || [];
  const rows = matrix?.rows || [];

  return (
    <div style={styles.tableWrap}>
      <table style={{ ...styles.table, minWidth: 1180 }}>
        <thead>
          <tr>
            <Th>{groupLabel}</Th>
            {categories.map((category) => (
              <Th key={category}>{category}</Th>
            ))}
            <Th>Total</Th>
            <Th>Focus</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <Td colSpan={categories.length + 3}>
                No distribution rows match the selected filters.
              </Td>
            </tr>
          ) : null}

          {rows.map((row) => (
            <tr
              key={row.id}
              style={selectedId === row.id ? styles.selectedTableRow : null}
            >
              <Td>
                <strong style={styles.primaryCell}>{row.name}</strong>
              </Td>
              {categories.map((category) => (
                <Td key={`${row.id}-${category}`}>
                  {formatNumber(row?.categories?.[category] || 0)}
                </Td>
              ))}
              <Td>
                <strong>{formatNumber(row.total)}</strong>
              </Td>
              <Td>
                <button
                  type="button"
                  style={styles.focusButton}
                  onClick={() => onSelect(row.id)}
                >
                  View
                </button>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SalesStatsPage() {
  const { activeWorkbase } = useAuth();
  const activeLmPcode = getActiveLmPcode(activeWorkbase);
  const activeWorkbaseName = getActiveWorkbaseName(activeWorkbase);

  const {
    data: salesRows = [],
    isLoading: salesLoading,
    isFetching: salesFetching,
    error: salesError,
  } = useGetDemoSalesByLmPcodeQuery(activeLmPcode, {
    skip: !activeLmPcode,
  });

  const {
    data: geofences = [],
    isLoading: geofencesLoading,
    isFetching: geofencesFetching,
    error: geofencesError,
  } = useGetGeoFencesByLmQuery(activeLmPcode, {
    skip: !activeLmPcode,
  });

  const {
    data: operationalStatsData,
    isLoading: operationalStatsLoading,
    isFetching: operationalStatsFetching,
    error: operationalStatsQueryError,
  } = useGetSalesOperationalStatsByLmQuery(activeLmPcode, {
    skip: !activeLmPcode,
  });

  const batches = operationalStatsData?.batches || [];
  const normalizedTargetedRows = operationalStatsData?.rows || [];
  const operationalStatsSync = operationalStatsData?.sync || {
    status: activeLmPcode ? "syncing" : "ready",
    error: null,
  };

  const [salesPeriodFilter, setSalesPeriodFilter] = useState(ALL_FILTER);
  const [batchFilter, setBatchFilter] = useState(ALL_FILTER);
  const [wardFilter, setWardFilter] = useState(ALL_FILTER);
  const [geofenceFilter, setGeofenceFilter] = useState(ALL_FILTER);
  const [allocationFilter, setAllocationFilter] = useState(ALL_FILTER);
  const [executionFilter, setExecutionFilter] = useState(ALL_FILTER);
  const [categoryFilter, setCategoryFilter] = useState(ALL_FILTER);

  const [wardChartMode, setWardChartMode] = useState("COUNT");
  const [geofenceChartMode, setGeofenceChartMode] = useState("COUNT");
  const [selectedWardId, setSelectedWardId] = useState("");
  const [selectedGeofenceId, setSelectedGeofenceId] = useState("");

  const geofenceNameById = useMemo(() => {
    const result = Object.fromEntries(
      geofences.map((geofence) => [geofence.id, geofence.name]),
    );

    salesRows.forEach((sales) => {
      (Array.isArray(sales?.geofenceRefs) ? sales.geofenceRefs : []).forEach(
        (reference) => {
          const id = cleanText(reference?.id);
          const name = cleanText(reference?.name);
          if (id && name && !result[id]) result[id] = name;
        },
      );
    });

    return result;
  }, [geofences, salesRows]);

  const targetedRows = useMemo(
    () =>
      buildTargetedDashboardRows({
        normalizedRows: normalizedTargetedRows,
        geofenceNameById,
      }),
    [normalizedTargetedRows, geofenceNameById],
  );

  const salesPopulationRows = useMemo(
    () =>
      buildSalesPopulationRows({
        salesRows,
        geofenceNameById,
      }),
    [salesRows, geofenceNameById],
  );

  const filterOptions = useMemo(() => {
    const geofenceOptions = new Map(
      geofences.map((geofence) => [geofence.id, geofence.name]),
    );

    salesPopulationRows.forEach((row) => {
      row.geofenceRefs.forEach((reference) => {
        geofenceOptions.set(reference.id, reference.name);
      });
    });

    const allocationOptions = new Map();
    targetedRows.forEach((row) => {
      allocationOptions.set(row.allocation.key, row.allocation.label);
    });

    return {
      salesPeriods: uniqueSorted([
        ...salesPopulationRows.map((row) => row.salesPeriod),
        ...targetedRows.map((row) => row.salesPeriod),
      ]),
      batches: [...batches].sort((left, right) =>
        String(left.id).localeCompare(String(right.id)),
      ),
      wards: uniqueSorted([
        ...salesPopulationRows.map((row) => row.ward),
        ...targetedRows.map((row) => row.ward),
      ]),
      geofences: Array.from(geofenceOptions.entries())
        .map(([id, name]) => ({ id, name }))
        .sort((left, right) =>
          String(left.name).localeCompare(String(right.name), undefined, {
            numeric: true,
            sensitivity: "base",
          }),
        ),
      allocations: Array.from(allocationOptions.entries())
        .map(([key, label]) => ({ key, label }))
        .sort((left, right) => String(left.label).localeCompare(String(right.label))),
      executions: uniqueSorted(
        targetedRows.map((row) => row.executionStatus),
      ),
      categories: sortCategories(
        salesPopulationRows.map((row) => row.category),
      ),
    };
  }, [geofences, salesPopulationRows, targetedRows, batches]);

  const filteredTargetedRows = useMemo(() => {
    return targetedRows.filter((row) => {
      if (
        salesPeriodFilter !== ALL_FILTER &&
        row.salesPeriod !== salesPeriodFilter
      ) {
        return false;
      }
      if (batchFilter !== ALL_FILTER && row.tbId !== batchFilter) return false;
      if (wardFilter !== ALL_FILTER && row.ward !== wardFilter) return false;
      if (!matchesGeofence(row, geofenceFilter)) return false;
      if (
        allocationFilter !== ALL_FILTER &&
        row.allocation.key !== allocationFilter
      ) {
        return false;
      }
      if (
        executionFilter !== ALL_FILTER &&
        row.executionStatus !== executionFilter
      ) {
        return false;
      }
      if (categoryFilter !== ALL_FILTER && row.category !== categoryFilter) {
        return false;
      }

      return true;
    });
  }, [
    targetedRows,
    salesPeriodFilter,
    batchFilter,
    wardFilter,
    geofenceFilter,
    allocationFilter,
    executionFilter,
    categoryFilter,
  ]);

  const filteredSalesRows = useMemo(() => {
    const baseRows = salesPopulationRows.filter((row) => {
      if (
        salesPeriodFilter !== ALL_FILTER &&
        row.salesPeriod !== salesPeriodFilter
      ) {
        return false;
      }
      if (wardFilter !== ALL_FILTER && row.ward !== wardFilter) return false;
      if (!matchesGeofence(row, geofenceFilter)) return false;
      if (categoryFilter !== ALL_FILTER && row.category !== categoryFilter) {
        return false;
      }

      return true;
    });

    const hasTargetSpecificFilter =
      batchFilter !== ALL_FILTER ||
      allocationFilter !== ALL_FILTER ||
      executionFilter !== ALL_FILTER;

    if (!hasTargetSpecificFilter) return baseRows;

    const allowedSalesIds = new Set(
      filteredTargetedRows.map((row) => row.salesId),
    );

    return baseRows.filter((row) => allowedSalesIds.has(row.id));
  }, [
    salesPopulationRows,
    filteredTargetedRows,
    salesPeriodFilter,
    batchFilter,
    wardFilter,
    geofenceFilter,
    allocationFilter,
    executionFilter,
    categoryFilter,
  ]);

  const summary = useMemo(
    () => summarizeTargetedRows(filteredTargetedRows),
    [filteredTargetedRows],
  );

  const categoryDistribution = useMemo(
    () => buildCategoryDistribution(filteredSalesRows),
    [filteredSalesRows],
  );

  const wardMatrix = useMemo(
    () =>
      buildCategoryMatrix(filteredSalesRows, (row) => [
        {
          id: row.ward,
          name: row.ward,
        },
      ]),
    [filteredSalesRows],
  );

  const geofenceMatrix = useMemo(
    () =>
      buildCategoryMatrix(
        filteredSalesRows,
        (row) => row.geofenceRefs,
      ),
    [filteredSalesRows],
  );

  useEffect(() => {
    if (
      !selectedWardId ||
      !wardMatrix.rows.some((row) => row.id === selectedWardId)
    ) {
      setSelectedWardId(wardMatrix.rows[0]?.id || "");
    }
  }, [wardMatrix, selectedWardId]);

  useEffect(() => {
    if (
      !selectedGeofenceId ||
      !geofenceMatrix.rows.some((row) => row.id === selectedGeofenceId)
    ) {
      setSelectedGeofenceId(geofenceMatrix.rows[0]?.id || "");
    }
  }, [geofenceMatrix, selectedGeofenceId]);

  const selectedWard =
    wardMatrix.rows.find((row) => row.id === selectedWardId) || null;
  const selectedGeofence =
    geofenceMatrix.rows.find((row) => row.id === selectedGeofenceId) || null;

  const selectedWardPie = useMemo(
    () =>
      (selectedWard ? wardMatrix.categories : []).map((category) => ({
        label: category,
        value: Number(selectedWard?.categories?.[category] || 0),
      })),
    [selectedWard, wardMatrix.categories],
  );

  const selectedGeofencePie = useMemo(
    () =>
      (selectedGeofence ? geofenceMatrix.categories : []).map((category) => ({
        label: category,
        value: Number(selectedGeofence?.categories?.[category] || 0),
      })),
    [selectedGeofence, geofenceMatrix.categories],
  );

  const noAccessByWard = useMemo(
    () =>
      countMapToChartData(
        getCountMap(
          filteredTargetedRows,
          (row) => row.ward,
          (row) => row.noAccessCount,
        ),
      ),
    [filteredTargetedRows],
  );

  const geofenceOperational = useMemo(
    () =>
      buildGeofenceOperationalStats({
        salesRows: filteredSalesRows,
        targetedRows: filteredTargetedRows,
      }),
    [filteredSalesRows, filteredTargetedRows],
  );

  const geofenceExecutionRows = useMemo(
    () =>
      geofenceOperational.map((row) => ({
        id: row.id,
        name: row.name,
        total: row.targetedRows,
        categories: {
          "Not Started": row.notStarted,
          "In Progress": row.inProgress,
          Completed: row.completed,
        },
      })),
    [geofenceOperational],
  );

  const geofenceNoAccess = useMemo(
    () =>
      geofenceOperational
        .map((row) => ({
          label: row.name,
          value: row.noAccessAttempts,
        }))
        .sort((left, right) => right.value - left.value),
    [geofenceOperational],
  );

  const batchPerformance = useMemo(
    () => buildBatchPerformance(filteredTargetedRows),
    [filteredTargetedRows],
  );

  const operationalStatsSettled = ["ready", "error"].includes(
    operationalStatsSync?.status,
  );
  const allReady =
    !salesLoading &&
    !salesFetching &&
    !geofencesLoading &&
    !geofencesFetching &&
    !operationalStatsLoading &&
    !operationalStatsFetching &&
    operationalStatsSettled;

  const displayError =
    operationalStatsSync?.error?.message ||
    operationalStatsQueryError?.error ||
    operationalStatsQueryError?.message ||
    salesError?.error ||
    salesError?.message ||
    geofencesError?.error ||
    geofencesError?.message ||
    "";

  function clearFilters() {
    setSalesPeriodFilter(ALL_FILTER);
    setBatchFilter(ALL_FILTER);
    setWardFilter(ALL_FILTER);
    setGeofenceFilter(ALL_FILTER);
    setAllocationFilter(ALL_FILTER);
    setExecutionFilter(ALL_FILTER);
    setCategoryFilter(ALL_FILTER);
  }

  return (
    <section style={styles.page}>
      <header style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Sales / Stats</p>
          <h1 style={styles.title}>Sales Dashboard</h1>
          <p style={styles.subtitle}>
            Live Sales Category distribution, Targeted Batch execution,
            field-data matching, ward performance and geofence statistics.
          </p>
        </div>

        <div style={styles.liveBadge}>
          <span style={styles.liveDot} />
          {allReady ? "Live dashboard" : "Joining live dashboard data..."}
        </div>
      </header>

      {!activeLmPcode ? (
        <div style={styles.notice}>
          Activate a Local Municipality workbase before opening Sales Stats.
        </div>
      ) : null}

      {displayError ? <div style={styles.errorState}>{displayError}</div> : null}

      <section style={styles.filtersPanel}>
        <div style={styles.filtersHeader}>
          <div>
            <h2 style={styles.filtersTitle}>Dashboard Filters</h2>
            <p style={styles.filtersSubtitle}>
              Every KPI, table and chart responds to these filters.
            </p>
          </div>
          <strong style={styles.workbaseBadge}>{activeWorkbaseName}</strong>
        </div>

        <div style={styles.filtersGrid}>
          <label style={styles.filterField}>
            <span style={styles.filterLabel}>Sales Period</span>
            <select
              value={salesPeriodFilter}
              onChange={(event) => setSalesPeriodFilter(event.target.value)}
              style={styles.filterInput}
            >
              <option value={ALL_FILTER}>All Sales Periods</option>
              {filterOptions.salesPeriods.map((period) => (
                <option key={period} value={period}>
                  {period}
                </option>
              ))}
            </select>
          </label>

          <label style={styles.filterField}>
            <span style={styles.filterLabel}>Targeted Batch</span>
            <select
              value={batchFilter}
              onChange={(event) => setBatchFilter(event.target.value)}
              style={styles.filterInput}
            >
              <option value={ALL_FILTER}>All Targeted Batches</option>
              {filterOptions.batches.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.id}
                </option>
              ))}
            </select>
          </label>

          <label style={styles.filterField}>
            <span style={styles.filterLabel}>Ward</span>
            <select
              value={wardFilter}
              onChange={(event) => setWardFilter(event.target.value)}
              style={styles.filterInput}
            >
              <option value={ALL_FILTER}>All Wards</option>
              {filterOptions.wards.map((ward) => (
                <option key={ward} value={ward}>
                  {ward}
                </option>
              ))}
            </select>
          </label>

          <label style={styles.filterField}>
            <span style={styles.filterLabel}>Geofence</span>
            <select
              value={geofenceFilter}
              onChange={(event) => setGeofenceFilter(event.target.value)}
              style={styles.filterInput}
            >
              <option value={ALL_FILTER}>All Geofences</option>
              {filterOptions.geofences.map((geofence) => (
                <option key={geofence.id} value={geofence.id}>
                  {geofence.name}
                </option>
              ))}
            </select>
          </label>

          <label style={styles.filterField}>
            <span style={styles.filterLabel}>Allocated To</span>
            <select
              value={allocationFilter}
              onChange={(event) => setAllocationFilter(event.target.value)}
              style={styles.filterInput}
            >
              <option value={ALL_FILTER}>All Allocation Targets</option>
              {filterOptions.allocations.map((allocation) => (
                <option key={allocation.key} value={allocation.key}>
                  {allocation.label}
                </option>
              ))}
            </select>
          </label>

          <label style={styles.filterField}>
            <span style={styles.filterLabel}>Execution Status</span>
            <select
              value={executionFilter}
              onChange={(event) => setExecutionFilter(event.target.value)}
              style={styles.filterInput}
            >
              <option value={ALL_FILTER}>All Execution States</option>
              {filterOptions.executions.map((status) => (
                <option key={status} value={status}>
                  {status.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>

          <label style={styles.filterField}>
            <span style={styles.filterLabel}>Sales Category</span>
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              style={styles.filterInput}
            >
              <option value={ALL_FILTER}>All Sales Categories</option>
              {filterOptions.categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>

          <button type="button" style={styles.clearButton} onClick={clearFilters}>
            Clear Filters
          </button>
        </div>
      </section>

      <div style={styles.kpiGrid}>
        <KpiCard
          label="Targeted Batches"
          value={formatNumber(summary.targetedBatches)}
          helper="Permanent batches in scope"
        />
        <KpiCard
          label="Targeted Rows"
          value={formatNumber(summary.totalRows)}
          helper="Filtered fieldwork rows"
        />
        <KpiCard
          label="Completed Rows"
          value={formatNumber(summary.completed)}
          helper="Completed in the field"
          tone="positive"
        />
        <KpiCard
          label="Completion Rate"
          value={formatPercent(summary.completionRate)}
          helper="Completed ÷ targeted rows"
          tone="positive"
        />
        <KpiCard
          label="Meters Discovered"
          value={formatNumber(summary.metersDiscovered)}
          helper="fieldWork.meterId linked"
        />
        <KpiCard
          label="Meter Match Rate"
          value={formatPercent(summary.meterMatchRate)}
          helper="TRUE ÷ (TRUE + FALSE)"
        />
        <KpiCard
          label="Address Match Rate"
          value={formatPercent(summary.addressMatchRate)}
          helper="strNo + strName only"
        />
        <KpiCard
          label="No Access Attempts"
          value={formatNumber(summary.noAccessAttempts)}
          helper="All recorded attempts"
          tone="warning"
        />
      </div>

      <section style={styles.section}>
        <SectionHeader
          eyebrow="Operational overview"
          title="Targeted Batch Field Outcomes"
          description="Progress, field matching and No Access results from the live Targeted Batch records."
        />

        <div style={styles.chartGrid}>
          <ChartCard title="Execution Progress" subtitle="Targeted rows by current execution state.">
            <HorizontalBarChart
              data={[
                { label: "Not Started", value: summary.notStarted },
                { label: "In Progress", value: summary.inProgress },
                { label: "Completed", value: summary.completed },
              ]}
            />
          </ChartCard>

          <ChartCard title="Meter Match Outcomes" subtitle="Original Sales meter versus field-confirmed meter.">
            <HorizontalBarChart
              data={[
                { label: "TRUE", value: summary.meterTrue },
                { label: "FALSE", value: summary.meterFalse },
                { label: "PENDING", value: summary.meterPending },
              ]}
            />
          </ChartCard>

          <ChartCard title="Address Match Outcomes" subtitle="Comparison uses street number and street name only.">
            <HorizontalBarChart
              data={[
                { label: "TRUE", value: summary.addressTrue },
                { label: "FALSE", value: summary.addressFalse },
                { label: "PENDING", value: summary.addressPending },
              ]}
            />
          </ChartCard>

          <ChartCard title="No Access by Ward" subtitle="Sum of all recorded No Access attempts.">
            <HorizontalBarChart data={noAccessByWard} />
          </ChartCard>
        </div>
      </section>

      <section style={styles.section}>
        <SectionHeader
          eyebrow="Sales Categories"
          title="Overall Sales Category Distribution"
          description={`${formatNumber(filteredSalesRows.length)} Sales meters are included in the current dashboard population.`}
        />

        <div style={styles.categoryLayout}>
          <article style={styles.tableCard}>
            <CategoryTable rows={categoryDistribution} />
          </article>

          <ChartCard title="Meters by Sales Category" subtitle="Horizontal comparison of the filtered category counts.">
            <HorizontalBarChart
              data={categoryDistribution.map((row) => ({
                label: row.category,
                value: row.count,
              }))}
            />
          </ChartCard>

          <ChartCard title="Sales Category Share" subtitle="Percentage contribution to the filtered Sales population.">
            <PieChart
              data={categoryDistribution.map((row) => ({
                label: row.category,
                value: row.count,
              }))}
            />
          </ChartCard>
        </div>
      </section>

      <section style={styles.section}>
        <SectionHeader
          eyebrow="Ward distribution"
          title="Sales Categories by Ward"
          description="Every ward in the filtered Sales population is included; unassigned records remain visible."
          action={
            <select
              value={wardChartMode}
              onChange={(event) => setWardChartMode(event.target.value)}
              style={styles.modeSelect}
            >
              <option value="COUNT">Meter Count</option>
              <option value="PERCENT">Percentage Distribution</option>
            </select>
          }
        />

        <article style={styles.tableCard}>
          <MatrixTable
            matrix={wardMatrix}
            groupLabel="Ward"
            selectedId={selectedWardId}
            onSelect={setSelectedWardId}
          />
        </article>

        <div style={styles.twoColumnGrid}>
          <ChartCard title="Ward Category Composition" subtitle="Stacked Sales Category distribution for every visible ward.">
            <StackedBarChart
              rows={wardMatrix.rows}
              categories={wardMatrix.categories}
              mode={wardChartMode}
            />
          </ChartCard>

          <ChartCard
            title={`${selectedWard?.name || "Selected Ward"} — Category Share`}
            subtitle="Click View in the ward table to focus this pie chart."
          >
            <PieChart data={selectedWardPie} />
          </ChartCard>
        </div>
      </section>

      <section style={styles.section}>
        <SectionHeader
          eyebrow="Geofence distribution"
          title="Sales Statistics by Geofence"
          description="Geofence membership comes from the Sales geofenceRefs linkage. Unlinked records remain under Geofence Not Assigned."
          action={
            <select
              value={geofenceChartMode}
              onChange={(event) => setGeofenceChartMode(event.target.value)}
              style={styles.modeSelect}
            >
              <option value="COUNT">Meter Count</option>
              <option value="PERCENT">Percentage Distribution</option>
            </select>
          }
        />

        <article style={styles.tableCard}>
          <div style={styles.tableWrap}>
            <table style={{ ...styles.table, minWidth: 1240 }}>
              <thead>
                <tr>
                  <Th>Geofence</Th>
                  <Th>Wards</Th>
                  <Th>Sales Meters</Th>
                  <Th>Targeted Rows</Th>
                  <Th>Completed</Th>
                  <Th>Completion %</Th>
                  <Th>Meter Match %</Th>
                  <Th>Address Match %</Th>
                  <Th>NA Attempts</Th>
                  <Th>Focus</Th>
                </tr>
              </thead>
              <tbody>
                {geofenceOperational.length === 0 ? (
                  <tr>
                    <Td colSpan={10}>
                      No geofence statistics match the selected filters.
                    </Td>
                  </tr>
                ) : null}

                {geofenceOperational.map((row) => (
                  <tr
                    key={row.id}
                    style={
                      selectedGeofenceId === row.id
                        ? styles.selectedTableRow
                        : null
                    }
                  >
                    <Td>
                      <strong style={styles.primaryCell}>{row.name}</strong>
                    </Td>
                    <Td>{row.wards || "NAv"}</Td>
                    <Td>{formatNumber(row.salesMeters)}</Td>
                    <Td>{formatNumber(row.targetedRows)}</Td>
                    <Td>{formatNumber(row.completed)}</Td>
                    <Td>{formatPercent(row.completionRate)}</Td>
                    <Td>{formatPercent(row.meterMatchRate)}</Td>
                    <Td>{formatPercent(row.addressMatchRate)}</Td>
                    <Td>{formatNumber(row.noAccessAttempts)}</Td>
                    <Td>
                      <button
                        type="button"
                        style={styles.focusButton}
                        onClick={() => setSelectedGeofenceId(row.id)}
                      >
                        View
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article style={styles.tableCard}>
          <MatrixTable
            matrix={geofenceMatrix}
            groupLabel="Geofence"
            selectedId={selectedGeofenceId}
            onSelect={setSelectedGeofenceId}
          />
        </article>

        <div style={styles.twoColumnGrid}>
          <ChartCard title="Geofence Category Composition" subtitle="Stacked Sales Category distribution for every visible geofence.">
            <StackedBarChart
              rows={geofenceMatrix.rows}
              categories={geofenceMatrix.categories}
              mode={geofenceChartMode}
            />
          </ChartCard>

          <ChartCard
            title={`${selectedGeofence?.name || "Selected Geofence"} — Category Share`}
            subtitle="Click View in either geofence table to focus this pie chart."
          >
            <PieChart data={selectedGeofencePie} />
          </ChartCard>

          <ChartCard title="Execution by Geofence" subtitle="Not Started, In Progress and Completed Targeted Batch rows.">
            <StackedBarChart
              rows={geofenceExecutionRows}
              categories={["Not Started", "In Progress", "Completed"]}
              mode="COUNT"
            />
          </ChartCard>

          <ChartCard title="No Access by Geofence" subtitle="Total recorded attempts for Targeted Batch rows.">
            <HorizontalBarChart data={geofenceNoAccess} />
          </ChartCard>
        </div>

        <p style={styles.dataNote}>
          A Sales meter linked to more than one geofence contributes to each linked geofence. The overall Sales meter KPI remains a unique-meter count.
        </p>
      </section>

      <section style={styles.section}>
        <SectionHeader
          eyebrow="Targeted Batch performance"
          title="Batch Performance Register"
          description="One live summary row per Targeted Batch represented by the current dashboard filters."
        />

        <article style={styles.tableCard}>
          <div style={styles.tableWrap}>
            <table style={{ ...styles.table, minWidth: 1260 }}>
              <thead>
                <tr>
                  <Th>Targeted Batch</Th>
                  <Th>Ward</Th>
                  <Th>Allocated To</Th>
                  <Th>Total</Th>
                  <Th>Completed</Th>
                  <Th>Completion %</Th>
                  <Th>Meter Match %</Th>
                  <Th>Address Match %</Th>
                  <Th>NA Attempts</Th>
                  <Th>Action</Th>
                </tr>
              </thead>
              <tbody>
                {batchPerformance.length === 0 ? (
                  <tr>
                    <Td colSpan={10}>
                      No Targeted Batch rows match the dashboard filters.
                    </Td>
                  </tr>
                ) : null}

                {batchPerformance.map((row) => (
                  <tr key={row.id}>
                    <Td>
                      <strong style={styles.primaryCell}>{row.id}</strong>
                    </Td>
                    <Td>{row.ward}</Td>
                    <Td>{row.allocatedTo}</Td>
                    <Td>{formatNumber(row.total)}</Td>
                    <Td>{formatNumber(row.completed)}</Td>
                    <Td>{formatPercent(row.completionRate)}</Td>
                    <Td>{formatPercent(row.meterMatchRate)}</Td>
                    <Td>{formatPercent(row.addressMatchRate)}</Td>
                    <Td>{formatNumber(row.noAccessAttempts)}</Td>
                    <Td>
                      <Link
                        to={`/sales/reporting/${encodeURIComponent(row.id)}`}
                        style={styles.openReportButton}
                      >
                        Open Report
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </section>
  );
}

const styles = {
  page: {
    display: "grid",
    gap: 20,
    minWidth: 0,
  },

  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 18,
    flexWrap: "wrap",
  },

  eyebrow: {
    margin: 0,
    color: "#2563eb",
    fontSize: 12,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },

  title: {
    margin: "4px 0 0",
    color: "#0f172a",
    fontSize: 32,
    lineHeight: 1.1,
  },

  subtitle: {
    maxWidth: 820,
    margin: "8px 0 0",
    color: "#64748b",
    fontSize: 14,
    fontWeight: 600,
    lineHeight: 1.6,
  },

  liveBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    border: "1px solid #bbf7d0",
    background: "#f0fdf4",
    color: "#166534",
    padding: "9px 12px",
    fontSize: 11,
    fontWeight: 900,
  },

  liveDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#16a34a",
  },

  notice: {
    borderRadius: 14,
    border: "1px solid #fde68a",
    background: "#fffbeb",
    color: "#92400e",
    padding: 14,
    fontWeight: 800,
  },

  errorState: {
    borderRadius: 14,
    border: "1px solid #fecaca",
    background: "#fef2f2",
    color: "#991b1b",
    padding: 14,
    fontWeight: 800,
  },

  filtersPanel: {
    borderRadius: 18,
    border: "1px solid #dbeafe",
    background: "#eff6ff",
    overflow: "hidden",
  },

  filtersHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    padding: 16,
    borderBottom: "1px solid #bfdbfe",
  },

  filtersTitle: {
    margin: 0,
    color: "#0f172a",
    fontSize: 16,
  },

  filtersSubtitle: {
    margin: "4px 0 0",
    color: "#64748b",
    fontSize: 11,
    fontWeight: 700,
  },

  workbaseBadge: {
    borderRadius: 999,
    background: "#dbeafe",
    color: "#1d4ed8",
    padding: "7px 10px",
    fontSize: 10,
  },

  filtersGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 10,
    padding: 16,
  },

  filterField: {
    display: "grid",
    gap: 5,
  },

  filterLabel: {
    color: "#475569",
    fontSize: 10,
    fontWeight: 900,
    textTransform: "uppercase",
  },

  filterInput: {
    minHeight: 40,
    width: "100%",
    borderRadius: 10,
    border: "1px solid #bfdbfe",
    background: "#ffffff",
    color: "#0f172a",
    padding: "8px 10px",
    fontSize: 11,
    fontWeight: 700,
    boxSizing: "border-box",
  },

  clearButton: {
    minHeight: 40,
    alignSelf: "end",
    borderRadius: 10,
    border: 0,
    background: "#0f172a",
    color: "#ffffff",
    padding: "8px 14px",
    fontSize: 11,
    fontWeight: 900,
    cursor: "pointer",
  },

  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 12,
  },

  kpiCard: {
    borderRadius: 16,
    border: "1px solid #e2e8f0",
    background: "#ffffff",
    padding: 16,
    display: "grid",
    gap: 4,
  },

  kpiCardPositive: {
    borderColor: "#bbf7d0",
    background: "#f0fdf4",
  },

  kpiCardWarning: {
    borderColor: "#fed7aa",
    background: "#fff7ed",
  },

  kpiLabel: {
    color: "#64748b",
    fontSize: 10,
    fontWeight: 900,
    textTransform: "uppercase",
  },

  kpiValue: {
    color: "#0f172a",
    fontSize: 25,
    lineHeight: 1.1,
  },

  kpiHelper: {
    color: "#94a3b8",
    fontSize: 10,
    fontWeight: 700,
  },

  section: {
    display: "grid",
    gap: 14,
    minWidth: 0,
  },

  sectionHeader: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 14,
    flexWrap: "wrap",
  },

  sectionEyebrow: {
    margin: 0,
    color: "#2563eb",
    fontSize: 10,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },

  sectionTitle: {
    margin: "3px 0 0",
    color: "#0f172a",
    fontSize: 21,
  },

  sectionDescription: {
    maxWidth: 820,
    margin: "6px 0 0",
    color: "#64748b",
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1.5,
  },

  chartGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
    gap: 14,
  },

  twoColumnGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
    gap: 14,
  },

  categoryLayout: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))",
    gap: 14,
  },

  tableCard: {
    minWidth: 0,
    borderRadius: 18,
    border: "1px solid #e2e8f0",
    background: "#ffffff",
    overflow: "hidden",
  },

  tableWrap: {
    width: "100%",
    overflowX: "auto",
  },

  table: {
    width: "100%",
    borderCollapse: "collapse",
  },

  th: {
    padding: "11px 12px",
    borderBottom: "1px solid #cbd5e1",
    background: "#f8fafc",
    color: "#475569",
    fontSize: 9,
    fontWeight: 900,
    textAlign: "left",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  },

  td: {
    padding: "12px",
    borderBottom: "1px solid #e2e8f0",
    color: "#334155",
    fontSize: 10,
    fontWeight: 700,
    verticalAlign: "top",
  },

  primaryCell: {
    color: "#0f172a",
  },

  selectedTableRow: {
    background: "#eff6ff",
  },

  focusButton: {
    minHeight: 30,
    borderRadius: 9,
    border: "1px solid #bfdbfe",
    background: "#eff6ff",
    color: "#1d4ed8",
    padding: "5px 9px",
    fontSize: 9,
    fontWeight: 900,
    cursor: "pointer",
  },

  badge: {
    display: "inline-flex",
    borderRadius: 999,
    padding: "5px 8px",
    fontSize: 9,
    fontWeight: 900,
  },

  badgeSuccess: {
    background: "#dcfce7",
    color: "#166534",
  },

  badgeDanger: {
    background: "#fee2e2",
    color: "#991b1b",
  },

  badgeNeutral: {
    background: "#f1f5f9",
    color: "#64748b",
  },

  modeSelect: {
    minHeight: 38,
    borderRadius: 10,
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#0f172a",
    padding: "7px 10px",
    fontSize: 10,
    fontWeight: 800,
  },

  dataNote: {
    margin: 0,
    color: "#64748b",
    fontSize: 10,
    fontWeight: 700,
    lineHeight: 1.5,
  },

  openReportButton: {
    display: "inline-flex",
    minHeight: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
    background: "#0f172a",
    color: "#ffffff",
    padding: "6px 10px",
    fontSize: 9,
    fontWeight: 900,
    textDecoration: "none",
    whiteSpace: "nowrap",
  },
};
