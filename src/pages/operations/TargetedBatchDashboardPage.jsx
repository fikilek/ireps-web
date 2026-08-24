/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../../auth/useAuth";
import TargetedBatchDashboardCard from "./targeted-batches/dashboard/TargetedBatchDashboardCard";
import useTargetedBatchDashboardData from "./targeted-batches/dashboard/useTargetedBatchDashboardData";
import {
  getActiveLmName,
  getActiveLmPcode,
  getBatchAllocationStatus,
  getBatchExecutionStatus,
  TB_DASHBOARD_FILTER_ALL,
} from "./targeted-batches/dashboard/targetedBatchDashboardModel";
import styles from "./targeted-batches/dashboard/targetedBatchDashboardStyles";

export default function TargetedBatchDashboardPage() {
  const { activeWorkbase } = useAuth();
  const lmPcode = getActiveLmPcode(activeWorkbase);
  const lmName = getActiveLmName(activeWorkbase);

  const [allocationFilter, setAllocationFilter] = useState(
    TB_DASHBOARD_FILTER_ALL,
  );
  const [executionFilter, setExecutionFilter] = useState(
    TB_DASHBOARD_FILTER_ALL,
  );

  const {
    batches,
    metricsByTbId,
    integrityByTbId,
    isLoading,
    loadError,
  } = useTargetedBatchDashboardData({ lmPcode });

  const allocationOptions = useMemo(
    () =>
      Array.from(
        new Set(batches.map(getBatchAllocationStatus)),
      ).sort(),
    [batches],
  );

  const executionOptions = useMemo(
    () =>
      Array.from(
        new Set(batches.map(getBatchExecutionStatus)),
      ).sort(),
    [batches],
  );

  const visibleBatches = useMemo(
    () =>
      batches.filter((batch) => {
        const allocationMatches =
          allocationFilter === TB_DASHBOARD_FILTER_ALL ||
          getBatchAllocationStatus(batch) === allocationFilter;
        const executionMatches =
          executionFilter === TB_DASHBOARD_FILTER_ALL ||
          getBatchExecutionStatus(batch) === executionFilter;

        return allocationMatches && executionMatches;
      }),
    [batches, allocationFilter, executionFilter],
  );

  return (
    <section style={styles.page}>
      <div style={styles.hero}>
        <div>
          <p style={styles.eyebrow}>Operations / TB Dashboard</p>
          <h2 style={styles.title}>Targeted Batch Dashboard</h2>
          <p style={styles.description}>
            Live permanent Targeted Batch cards for {lmName} ({lmPcode || "NAv"}).
            Each card uses the matching Sales Targeted Batch reference to track
            original meters, meters found, meter mismatches, linked premises and
            historical No Access attempts.
          </p>
        </div>

        <div style={styles.heroActions}>
          <span style={styles.heroBadge}>LIVE FIRESTORE</span>
          <Link
            to="/operations/targeted-batches"
            style={styles.heroLink}
          >
            Open TB Register
          </Link>
        </div>
      </div>

      <div style={styles.filterPanel}>
        <div>
          <p style={styles.sectionMiniTitle}>Dashboard filters</p>
          <p style={styles.mutedText}>
            Filter the live cards by whole-batch allocation and execution state.
          </p>
        </div>

        <div style={styles.filterControls}>
          <select
            value={allocationFilter}
            onChange={(event) =>
              setAllocationFilter(event.target.value)
            }
            style={styles.filterInput}
          >
            <option value={TB_DASHBOARD_FILTER_ALL}>
              All Allocation States
            </option>
            {allocationOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>

          <select
            value={executionFilter}
            onChange={(event) =>
              setExecutionFilter(event.target.value)
            }
            style={styles.filterInput}
          >
            <option value={TB_DASHBOARD_FILTER_ALL}>
              All Execution States
            </option>
            {executionOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!lmPcode ? (
        <div style={styles.errorNotice}>
          Activate a Local Municipality workbase to load the TB Dashboard.
        </div>
      ) : null}

      {loadError ? (
        <div style={styles.errorNotice}>{loadError}</div>
      ) : null}

      <div style={styles.dashboardGrid}>
        {isLoading ? (
          <article style={styles.emptyCard}>
            Connecting to permanent Targeted Batch dashboard streams...
          </article>
        ) : null}

        {!isLoading && !loadError && visibleBatches.length === 0 ? (
          <article style={styles.emptyCard}>
            No permanent Targeted Batch cards match the current filters.
          </article>
        ) : null}

        {!isLoading
          ? visibleBatches.map((batch) => (
              <TargetedBatchDashboardCard
                key={batch.id}
                batch={batch}
                metrics={metricsByTbId[batch.id]}
                integrity={integrityByTbId[batch.id]}
              />
            ))
          : null}
      </div>
    </section>
  );
}
