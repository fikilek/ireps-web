/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { Link, useParams } from "react-router-dom";

import TargetedBatchDashboardCard from "./targeted-batches/dashboard/TargetedBatchDashboardCard";
import useTargetedBatchDashboardData from "./targeted-batches/dashboard/useTargetedBatchDashboardData";
import styles from "./targeted-batches/dashboard/targetedBatchDashboardStyles";

export default function TargetedBatchDetailDashboardPage() {
  const { tbId = "" } = useParams();
  const decodedTbId = decodeURIComponent(tbId);

  const {
    batch,
    metrics,
    integrity,
    isLoading,
    loadError,
  } = useTargetedBatchDashboardData({ tbId: decodedTbId });

  return (
    <section style={styles.page}>
      <div style={styles.hero}>
        <div>
          <p style={styles.eyebrow}>
            Operations / TB Dashboard / Batch
          </p>
          <h2 style={styles.title}>
            {decodedTbId || "Targeted Batch Dashboard"}
          </h2>
          <p style={styles.description}>
            Live operational dashboard for one permanent Targeted Batch using
            the canonical Sales Targeted Batch field-work projection.
          </p>
        </div>

        <div style={styles.heroActions}>
          <span style={styles.heroBadge}>LIVE FIRESTORE</span>
          <Link to="/operations/tb-dashboard" style={styles.heroLink}>
            Back to TB Dashboard
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div style={styles.notice}>
          Loading the permanent Targeted Batch dashboard...
        </div>
      ) : null}

      {loadError ? (
        <div style={styles.errorNotice}>{loadError}</div>
      ) : null}

      {!isLoading && !loadError && !batch ? (
        <div style={styles.errorNotice}>
          Permanent Targeted Batch {decodedTbId} was not found.
        </div>
      ) : null}

      {!isLoading && batch ? (
        <div style={styles.detailCardWrap}>
          <TargetedBatchDashboardCard
            batch={batch}
            metrics={metrics}
            integrity={integrity}
            showDashboardAction={false}
          />
        </div>
      ) : null}
    </section>
  );
}
