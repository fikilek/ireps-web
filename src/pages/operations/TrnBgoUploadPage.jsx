import { useState, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import * as XLSX from "xlsx";

import { useAuth } from "../../auth/useAuth";
import { useGeo } from "@/context/GeoContext";
import IrepsTable from "../../components/table/IrepsTable";

const VALID_EXTENSIONS = ["csv", "xlsx", "xls", "xml"];

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("en-ZA") : "0";
}

function resolveWorkbase(auth = {}, geoState = {}) {
  const candidate =
    auth?.activeWorkbase ||
    auth?.profile?.access?.activeWorkbase ||
    auth?.profile?.activeWorkbase ||
    auth?.activeLm ||
    (Array.isArray(auth?.workbases) && auth.workbases[0]) ||
    (Array.isArray(auth?.profile?.access?.workbases) && auth.profile.access.workbases[0]) ||
    geoState?.selectedLm ||
    null;

  const pcode = String(
    candidate?.lmPcode ||
      candidate?.pcode ||
      candidate?.id ||
      candidate?.localMunicipalityId ||
      "",
  ).trim();

  const lmName = String(
    candidate?.name ||
      candidate?.lmName ||
      candidate?.id ||
      candidate?.pcode ||
      "NAv",
  ).trim();

  return {
    lmPcode: pcode === "NAv" ? "" : pcode,
    lmName,
  };
}

export default function TrnBgoUploadPage() {
  const auth = useAuth();
  const { geoState } = useGeo();
  const { lmPcode, lmName } = useMemo(
    () => resolveWorkbase(auth, geoState),
    [auth, geoState],
  );

  const fileInputRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileError, setFileError] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [parsedRows, setParsedRows] = useState([]);
  const [detectedHeaders, setDetectedHeaders] = useState([]);

  // Handle file selection and Step 1 validation
  const handleFileChange = (file) => {
    setFileError("");
    setParsedRows([]);
    setDetectedHeaders([]);

    if (!file) {
      setSelectedFile(null);
      return;
    }

    const fileName = file.name || "";
    const ext = fileName.split(".").pop().toLowerCase();

    // Step 1 Validation: Check file extension
    if (!VALID_EXTENSIONS.includes(ext)) {
      setFileError(
        `Validation Failed: The file "${fileName}" is not supported. The file must be either a CSV or an Excel file (.csv, .xlsx, .xls, .xml).`
      );
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setSelectedFile(file);
    parseFile(file);
  };

  // Parse CSV or Excel file contents into JSON
  const parseFile = (file) => {
    setIsParsing(true);
    setFileError("");

    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array" });

        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
          setFileError("Validation Failed: The workbook contains no worksheets.");
          setIsParsing(false);
          return;
        }

        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rawJson = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

        if (!rawJson || rawJson.length === 0) {
          setFileError("Validation Failed: The file was parsed successfully but contains no data rows.");
          setIsParsing(false);
          return;
        }

        // Detect all unique headers from rows
        const headersSet = new Set();
        rawJson.forEach((row) => {
          Object.keys(row).forEach((k) => headersSet.add(k));
        });
        const headers = Array.from(headersSet);

        // Normalize rows with index
        const indexedRows = rawJson.map((row, idx) => ({
          _rowNo: idx + 1,
          ...row,
        }));

        setDetectedHeaders(headers);
        setParsedRows(indexedRows);
      } catch (err) {
        setFileError(`Failed to parse file: ${err?.message || "Unknown format error"}`);
      } finally {
        setIsParsing(false);
      }
    };

    reader.onerror = () => {
      setFileError("Failed to read file from disk.");
      setIsParsing(false);
    };

    reader.readAsArrayBuffer(file);
  };

  const handleReset = () => {
    setSelectedFile(null);
    setParsedRows([]);
    setDetectedHeaders([]);
    setFileError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Build IrepsTable columns dynamically from detected headers
  const columns = useMemo(() => {
    if (parsedRows.length === 0) return [];

    // Helper to find header case-insensitively
    const findHeader = (patterns) => {
      return detectedHeaders.find((h) =>
        patterns.some((p) => h.toLowerCase().replace(/[^a-z0-9]/g, "") === p)
      );
    };

    const meterNoKey = findHeader(["meterno", "meter", "meternumber", "astno"]);
    const accountNoKey = findHeader(["accountno", "linkedaccountno", "account", "accno"]);
    const addressKey = findHeader(["premiseaddress", "address", "streetaddress", "street"]);
    const erfNoKey = findHeader(["erfno", "erf", "erfnumber"]);
    const wardNoKey = findHeader(["wardno", "ward", "wardpcode"]);
    const reasonKey = findHeader(["actionreason", "reason", "comments", "words"]);
    const statusKey = findHeader(["meterstatus", "status", "state"]);

    const cols = [
      {
        key: "_rowNo",
        label: "#",
        width: 50,
        filter: null,
        sortable: true,
        value: (r) => String(r._rowNo),
        sortValue: (r) => r._rowNo,
        render: (r) => <strong>{r._rowNo}</strong>,
      },
    ];

    if (meterNoKey) {
      cols.push({
        key: meterNoKey,
        label: "Meter No",
        width: 140,
        filter: "text",
        sortable: true,
        value: (r) => String(r[meterNoKey] || ""),
        sortValue: (r) => String(r[meterNoKey] || ""),
        render: (r) => (
          <span style={styles.meterNoCell}>
            {String(r[meterNoKey] || "NAv")}
          </span>
        ),
      });
    }

    if (accountNoKey) {
      cols.push({
        key: accountNoKey,
        label: "Account No",
        width: 120,
        filter: "text",
        sortable: true,
        value: (r) => String(r[accountNoKey] || ""),
        sortValue: (r) => String(r[accountNoKey] || ""),
        render: (r) => <span style={{ fontSize: 12 }}>{String(r[accountNoKey] || "NAv")}</span>,
      });
    }

    if (addressKey) {
      cols.push({
        key: addressKey,
        label: "Premise Address",
        filter: "text",
        sortable: true,
        value: (r) => String(r[addressKey] || ""),
        sortValue: (r) => String(r[addressKey] || ""),
        render: (r) => (
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: "#0f172a" }}>
              {String(r[addressKey] || "NAv")}
            </div>
            {erfNoKey && r[erfNoKey] ? (
              <div style={{ fontSize: 11, color: "#64748b" }}>ERF: {String(r[erfNoKey])}</div>
            ) : null}
          </div>
        ),
      });
    }

    if (wardNoKey) {
      cols.push({
        key: wardNoKey,
        label: "Ward",
        width: 100,
        filter: "text",
        sortable: true,
        value: (r) => String(r[wardNoKey] || ""),
        sortValue: (r) => String(r[wardNoKey] || ""),
        render: (r) => <span>{String(r[wardNoKey] || "NAv")}</span>,
      });
    }

    if (statusKey) {
      cols.push({
        key: statusKey,
        label: "File Status",
        width: 120,
        filter: "select",
        sortable: true,
        value: (r) => String(r[statusKey] || ""),
        sortValue: (r) => String(r[statusKey] || ""),
        render: (r) => {
          const val = String(r[statusKey] || "NAv").toUpperCase();
          const isConn = val === "CONNECTED";
          return (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "2px 8px",
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 800,
                background: isConn ? "#ecfdf5" : "#f1f5f9",
                color: isConn ? "#047857" : "#475569",
                border: `1px solid ${isConn ? "#a7f3d0" : "#cbd5e1"}`,
              }}
            >
              {val}
            </span>
          );
        },
      });
    }

    if (reasonKey) {
      cols.push({
        key: reasonKey,
        label: "Action Reason",
        filter: "text",
        sortable: true,
        value: (r) => String(r[reasonKey] || ""),
        sortValue: (r) => String(r[reasonKey] || ""),
        render: (r) => <span style={{ fontSize: 12, color: "#475569" }}>{String(r[reasonKey] || "NAv")}</span>,
      });
    }

    // Add any remaining unmapped columns from file
    const mappedKeys = new Set([
      meterNoKey,
      accountNoKey,
      addressKey,
      erfNoKey,
      wardNoKey,
      statusKey,
      reasonKey,
    ].filter(Boolean));

    detectedHeaders.forEach((header) => {
      if (!mappedKeys.has(header)) {
        cols.push({
          key: header,
          label: header,
          filter: "text",
          sortable: true,
          value: (r) => String(r[header] || ""),
          sortValue: (r) => String(r[header] || ""),
          render: (r) => <span style={{ fontSize: 12 }}>{String(r[header] || "")}</span>,
        });
      }
    });

    return cols;
  }, [detectedHeaders, parsedRows]);

  return (
    <section style={styles.page}>
      {/* Top Header */}
      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>
            <Link to="/operations/trn-bgo" style={styles.breadcrumbLink}>
              Operations / TRN BGO Register
            </Link>{" "}
            / File Upload
          </p>
          <div style={styles.titleHelpRow}>
            <h2 style={styles.title}>TRN BGO File Upload</h2>
            <div style={styles.lmHeaderPill}>
              <span style={styles.lmHeaderDot} />
              <span style={styles.lmHeaderLabel}>Local Municipality:</span>
              <strong style={styles.lmHeaderValue}>{lmName || lmPcode || "Active Municipality"}</strong>
              {lmPcode ? <span style={styles.lmHeaderPcode}>({lmPcode})</span> : null}
            </div>
          </div>
          <p style={styles.subtitle}>
            Step 1: Upload an external meter instruction file (CSV or Excel) to inspect its constituent rows before validation and batching.
          </p>
        </div>

        <div style={styles.headerActions}>
          <Link to="/operations/trn-bgo" style={styles.secondaryLinkButton}>
            ← Back to TRN BGO Register
          </Link>
          <Link to="/operations/trn-bgo/dashboard" style={styles.secondaryLinkButton}>
            TRN BGO Dashboard
          </Link>
        </div>
      </div>

      {/* Step 1: Upload Card (when no rows parsed yet) */}
      {parsedRows.length === 0 ? (
        <div style={styles.uploadCard}>
          <div style={styles.uploadCardHeader}>
            <div>
              <h3 style={styles.uploadCardTitle}>Select File to Upload</h3>
              <p style={styles.uploadCardSubtitle}>
                Supported formats: <strong>CSV</strong> (<code>.csv</code>) or <strong>Excel</strong> (<code>.xlsx</code>, <code>.xls</code>, <code>.xml</code>).
              </p>
            </div>
          </div>

          {fileError ? (
            <div style={styles.errorNotice} role="alert">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <div>{fileError}</div>
            </div>
          ) : null}

          <div
            style={styles.dropzone}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                handleFileChange(e.dataTransfer.files[0]);
              }
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv, .xlsx, .xls, .xml, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel, text/csv"
              style={{ display: "none" }}
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  handleFileChange(e.target.files[0]);
                }
              }}
            />

            <div style={styles.dropzoneIcon}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>

            <p style={styles.dropzoneText}>
              <strong>Click to browse</strong> or drag & drop a meter file here
            </p>
            <p style={styles.dropzoneSubtext}>
              Strictly accepts CSV (.csv) or Excel (.xlsx, .xls, .xml)
            </p>
          </div>
        </div>
      ) : null}

      {/* Loading indicator */}
      {isParsing ? (
        <div style={styles.parsingNotice}>
          Parsing file contents... Please wait.
        </div>
      ) : null}

      {/* Step 1 Outcome: Display Parsed File Contents Table */}
      {parsedRows.length > 0 ? (
        <div style={styles.previewSection}>
          {/* File Meta Banner */}
          <div style={styles.fileSummaryBanner}>
            <div style={styles.fileMetaItem}>
              <span style={styles.fileMetaLabel}>File Name</span>
              <strong style={styles.fileMetaValue}>{selectedFile?.name || "Uploaded File"}</strong>
            </div>

            <div style={styles.fileMetaItem}>
              <span style={styles.fileMetaLabel}>Format</span>
              <strong style={styles.fileMetaValue}>
                {selectedFile?.name?.split(".").pop()?.toUpperCase() || "CSV"}
              </strong>
            </div>

            <div style={styles.fileMetaItem}>
              <span style={styles.fileMetaLabel}>File Size</span>
              <strong style={styles.fileMetaValue}>{formatBytes(selectedFile?.size)}</strong>
            </div>

            <div style={styles.fileMetaItem}>
              <span style={styles.fileMetaLabel}>Total Rows</span>
              <strong style={{ ...styles.fileMetaValue, color: "#2563eb" }}>
                {formatNumber(parsedRows.length)} Meters
              </strong>
            </div>

            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
              <button
                type="button"
                style={styles.resetButton}
                onClick={handleReset}
                title="Clear table and upload a different file"
              >
                Upload Different File
              </button>
            </div>
          </div>

          {/* IrepsTable displaying all rows */}
          <div style={styles.tablePanel}>
            <IrepsTable
              data={parsedRows}
              columns={columns}
              title={`Uploaded File Contents: ${selectedFile?.name || "File"} (${formatNumber(parsedRows.length)} Rows)`}
              pageSizeOptions={[10, 25, 50, 100]}
              defaultPageSize={25}
              emptyText="No data found in uploaded file."
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

const styles = {
  page: {
    padding: "24px 32px",
    display: "flex",
    flexDirection: "column",
    gap: 20,
    background: "#f8fafc",
    minHeight: "100vh",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  },
  eyebrow: {
    margin: "0 0 6px",
    fontSize: 12,
    fontWeight: 700,
    color: "#64748b",
  },
  breadcrumbLink: {
    color: "#2563eb",
    textDecoration: "none",
  },
  titleHelpRow: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    margin: "0 0 6px",
  },
  title: {
    margin: 0,
    fontSize: 24,
    fontWeight: 900,
    color: "#0f172a",
    letterSpacing: "-0.02em",
  },
  subtitle: {
    margin: 0,
    fontSize: 13,
    color: "#475569",
  },
  lmHeaderPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "4px 12px",
    borderRadius: 9999,
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    fontSize: 12,
    color: "#1e40af",
  },
  lmHeaderDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#2563eb",
  },
  lmHeaderLabel: {
    fontWeight: 600,
    color: "#475569",
  },
  lmHeaderValue: {
    fontWeight: 800,
    color: "#0f172a",
  },
  lmHeaderPcode: {
    color: "#64748b",
    fontWeight: 600,
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  secondaryLinkButton: {
    display: "inline-flex",
    alignItems: "center",
    padding: "8px 14px",
    borderRadius: 8,
    background: "#ffffff",
    color: "#334155",
    fontWeight: 700,
    fontSize: 13,
    textDecoration: "none",
    border: "1px solid #cbd5e1",
  },
  uploadCard: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    padding: 28,
    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
  },
  uploadCardHeader: {
    marginBottom: 20,
  },
  uploadCardTitle: {
    margin: "0 0 6px",
    fontSize: 18,
    fontWeight: 800,
    color: "#0f172a",
  },
  uploadCardSubtitle: {
    margin: 0,
    fontSize: 13,
    color: "#64748b",
  },
  dropzone: {
    border: "2px dashed #93c5fd",
    background: "#f0f7ff",
    borderRadius: 14,
    padding: "48px 24px",
    textAlign: "center",
    cursor: "pointer",
    transition: "border-color 0.2s, background 0.2s",
  },
  dropzoneIcon: {
    marginBottom: 14,
  },
  dropzoneText: {
    fontSize: 15,
    color: "#1e3a8a",
    margin: "0 0 6px",
  },
  dropzoneSubtext: {
    fontSize: 12,
    color: "#64748b",
    margin: 0,
  },
  errorNotice: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#b91c1c",
    padding: "14px 18px",
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 600,
    marginBottom: 20,
  },
  parsingNotice: {
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    color: "#1d4ed8",
    padding: "16px",
    borderRadius: 10,
    textAlign: "center",
    fontSize: 14,
    fontWeight: 700,
  },
  previewSection: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  fileSummaryBanner: {
    display: "flex",
    alignItems: "center",
    gap: 24,
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    padding: "16px 24px",
    flexWrap: "wrap",
    boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
  },
  fileMetaItem: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },
  fileMetaLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  fileMetaValue: {
    fontSize: 14,
    fontWeight: 800,
    color: "#0f172a",
  },
  resetButton: {
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    color: "#334155",
    padding: "8px 16px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
  },
  tablePanel: {
    background: "#ffffff",
    borderRadius: 14,
    border: "1px solid #e2e8f0",
    overflow: "hidden",
    boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
  },
  meterNoCell: {
    fontFamily: "monospace",
    fontWeight: 800,
    fontSize: 13,
    color: "#0f172a",
  },
};
