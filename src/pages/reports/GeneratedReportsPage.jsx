import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  authorizeGeneratedReportDownload,
  deleteGeneratedReport,
  listGeneratedReportsPage,
} from "../../utils/reportPlatform/generatedReportsClient.js";

const PAGE_SIZE = 50;

function formatDateTime(value) {
  if (!value) return "NAv";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "NAv";
  return date.toLocaleString();
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "NAv";
  if (bytes < 1024) return `${bytes.toLocaleString()} B`;

  const units = ["KB", "MB", "GB"];
  let amount = bytes / 1024;
  let unitIndex = 0;

  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }

  return `${amount.toLocaleString(undefined, {
    maximumFractionDigits: amount >= 10 ? 1 : 2,
  })} ${units[unitIndex]}`;
}

function reportIdentity(report) {
  return report?.lifecycle?.reportId || report?.report?.fileName || "unknown-report";
}

function startBrowserDownload(downloadUrl) {
  if (typeof document === "undefined") {
    throw new Error("A browser is required to download this report.");
  }

  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.style.display = "none";
  document.body.appendChild(anchor);

  try {
    anchor.click();
  } finally {
    anchor.remove();
  }
}

function errorMessage(error, fallback) {
  const message = String(error?.message || "").trim();
  return message || fallback;
}

export default function GeneratedReportsPage() {
  const [reports, setReports] = useState([]);
  const [nextPageToken, setNextPageToken] = useState(null);
  const [currentPageToken, setCurrentPageToken] = useState(null);
  const [previousPageTokens, setPreviousPageTokens] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [actionState, setActionState] = useState({ reportId: null, action: null });
  const [actionMessage, setActionMessage] = useState("");

  useEffect(() => {
    let active = true;

    listGeneratedReportsPage({ pageSize: PAGE_SIZE })
      .then((result) => {
        if (!active) return;
        setReports(result.reports);
        setNextPageToken(result.nextPageToken);
        setPageError("");
      })
      .catch((error) => {
        if (!active) return;
        setPageError(
          errorMessage(error, "Generated Reports could not be loaded."),
        );
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const sortedReports = useMemo(() => {
    return [...reports].sort((left, right) => {
      const leftTime = new Date(left?.lifecycle?.createdAt || 0).getTime();
      const rightTime = new Date(right?.lifecycle?.createdAt || 0).getTime();
      return rightTime - leftTime;
    });
  }, [reports]);

  async function loadPage(pageToken, previousTokens) {
    setIsLoading(true);
    setPageError("");
    setActionMessage("");

    try {
      const result = await listGeneratedReportsPage({
        pageSize: PAGE_SIZE,
        pageToken,
      });
      setReports(result.reports);
      setNextPageToken(result.nextPageToken);
      setCurrentPageToken(pageToken || null);
      setPreviousPageTokens(previousTokens);
    } catch (error) {
      setPageError(
        errorMessage(error, "Generated Reports could not be loaded."),
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRefresh() {
    await loadPage(currentPageToken, previousPageTokens);
  }

  async function handleNextPage() {
    if (!nextPageToken || isLoading) return;

    await loadPage(nextPageToken, [
      ...previousPageTokens,
      currentPageToken,
    ]);
  }

  async function handlePreviousPage() {
    if (previousPageTokens.length === 0 || isLoading) return;

    const nextHistory = previousPageTokens.slice(0, -1);
    const previousToken = previousPageTokens.at(-1) || null;
    await loadPage(previousToken, nextHistory);
  }

  async function handleDownload(report) {
    const reportId = reportIdentity(report);
    setActionState({ reportId, action: "DOWNLOAD" });
    setActionMessage("");

    try {
      const authorization = await authorizeGeneratedReportDownload(report);
      startBrowserDownload(authorization.downloadUrl);
      setActionMessage(
        `Download authorized for ${authorization.fileName}. The link expires in about 5 minutes.`,
      );
    } catch (error) {
      setActionMessage(
        errorMessage(error, "The generated report could not be downloaded."),
      );
    } finally {
      setActionState({ reportId: null, action: null });
    }
  }

  async function handleDelete(report) {
    const reportName = report?.report?.reportName || report?.report?.fileName || "this report";

    if (
      typeof window !== "undefined" &&
      !window.confirm(`Delete ${reportName}? This cannot be undone.`)
    ) {
      return;
    }

    const reportId = reportIdentity(report);
    setActionState({ reportId, action: "DELETE" });
    setActionMessage("");

    try {
      await deleteGeneratedReport(report);
      await loadPage(currentPageToken, previousPageTokens);
      setActionMessage(`${reportName} was deleted.`);
    } catch (error) {
      setActionMessage(
        errorMessage(error, "The generated report could not be deleted."),
      );
    } finally {
      setActionState({ reportId: null, action: null });
    }
  }

  return (
    <>
      <header className="console-header">
        <div>
          <p className="eyebrow">Reports</p>
          <h1>Generated Reports</h1>
          <p className="muted">
            Your managed report artifacts. Reports remain available for up to 3 days,
            then expire automatically.
          </p>
          <Link className="text-link" to="/reports">
            ← Back to Reports
          </Link>
        </div>

        <div className="topbar-right">
          <div className="role-pill">
            {isLoading
              ? "Loading..."
              : `${sortedReports.length.toLocaleString()} reports on this page`}
          </div>
          <button
            type="button"
            className="ghost-button"
            onClick={handleRefresh}
            disabled={isLoading}
          >
            Refresh
          </button>
        </div>
      </header>

      {actionMessage ? (
        <section className="panel" style={styles.messagePanel}>
          {actionMessage}
        </section>
      ) : null}

      <section className="table-panel">
        {pageError ? (
          <div className="empty-state error-box">
            <h2>Could not load Generated Reports</h2>
            <p className="muted">{pageError}</p>
            <button
              type="button"
              className="ghost-button"
              onClick={handleRefresh}
            >
              Try Again
            </button>
          </div>
        ) : null}

        {!pageError && !isLoading && sortedReports.length === 0 ? (
          <div className="empty-state">
            <h2>No generated reports yet</h2>
            <p className="muted">
              Managed Full Downloads will appear here after they are generated.
            </p>
          </div>
        ) : null}

        {!pageError && sortedReports.length > 0 ? (
          <div style={styles.tableScroller}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.headerCell}>Report</th>
                  <th style={styles.headerCell}>Type</th>
                  <th style={styles.headerCell}>Format</th>
                  <th style={styles.headerCell}>Items</th>
                  <th style={styles.headerCell}>File Name</th>
                  <th style={styles.headerCell}>Size</th>
                  <th style={styles.headerCell}>Created</th>
                  <th style={styles.headerCell}>Expires</th>
                  <th style={styles.headerCell}>Status</th>
                  <th style={styles.headerCell}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedReports.map((entry) => {
                  const report = entry?.report || {};
                  const lifecycle = entry?.lifecycle || {};
                  const reportId = reportIdentity(entry);
                  const isDownloading =
                    actionState.reportId === reportId &&
                    actionState.action === "DOWNLOAD";
                  const isDeleting =
                    actionState.reportId === reportId &&
                    actionState.action === "DELETE";
                  const busy = Boolean(actionState.reportId);

                  return (
                    <tr key={reportId}>
                      <td style={styles.cell}>
                        <strong>{report.reportName || "Generated Report"}</strong>
                      </td>
                      <td style={styles.cell}>{report.reportType || "NAv"}</td>
                      <td style={styles.cell}>{report.format || "NAv"}</td>
                      <td style={styles.numericCell}>
                        {Number(report.itemCount || 0).toLocaleString()}
                      </td>
                      <td style={styles.cell}>{report.fileName || "NAv"}</td>
                      <td style={styles.cell}>
                        {formatBytes(lifecycle.actualSize)}
                      </td>
                      <td style={styles.cell}>
                        {formatDateTime(lifecycle.createdAt)}
                      </td>
                      <td style={styles.cell}>
                        {formatDateTime(lifecycle.expiresAt)}
                      </td>
                      <td style={styles.cell}>
                        <span style={styles.statusBadge}>
                          {lifecycle.status || "NAv"}
                        </span>
                      </td>
                      <td style={styles.cell}>
                        <div style={styles.actions}>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => handleDownload(entry)}
                            disabled={busy}
                          >
                            {isDownloading ? "Authorizing..." : "Download"}
                          </button>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => handleDelete(entry)}
                            disabled={busy}
                          >
                            {isDeleting ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        <div style={styles.pagination}>
          <button
            type="button"
            className="ghost-button"
            onClick={handlePreviousPage}
            disabled={isLoading || previousPageTokens.length === 0}
          >
            Previous
          </button>

          <span className="muted">
            {previousPageTokens.length + 1}
          </span>

          <button
            type="button"
            className="ghost-button"
            onClick={handleNextPage}
            disabled={isLoading || !nextPageToken}
          >
            Next
          </button>
        </div>
      </section>
    </>
  );
}

const styles = {
  messagePanel: {
    marginBottom: "1rem",
    padding: "0.85rem 1rem",
  },
  tableScroller: {
    width: "100%",
    overflowX: "auto",
  },
  table: {
    width: "100%",
    minWidth: "1180px",
    borderCollapse: "collapse",
  },
  headerCell: {
    textAlign: "left",
    padding: "0.75rem",
    borderBottom: "1px solid #cbd5e1",
    whiteSpace: "nowrap",
  },
  cell: {
    padding: "0.75rem",
    borderBottom: "1px solid #e2e8f0",
    verticalAlign: "top",
  },
  numericCell: {
    padding: "0.75rem",
    borderBottom: "1px solid #e2e8f0",
    textAlign: "right",
    verticalAlign: "top",
  },
  statusBadge: {
    display: "inline-flex",
    alignItems: "center",
    border: "1px solid #cbd5e1",
    borderRadius: "999px",
    padding: "0.2rem 0.5rem",
    fontSize: "0.75rem",
    fontWeight: 800,
  },
  actions: {
    display: "flex",
    gap: "0.5rem",
    flexWrap: "wrap",
  },
  pagination: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "0.75rem",
    paddingTop: "1rem",
  },
};
