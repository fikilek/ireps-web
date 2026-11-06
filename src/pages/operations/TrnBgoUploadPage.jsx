import { useState, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import * as XLSX from "xlsx";
import { collection, query, where, getDocs } from "firebase/firestore";

import { db } from "../../firebase";
import { useAuth } from "../../auth/useAuth";
import { useGeo } from "@/context/GeoContext";
import IrepsTable from "../../components/table/IrepsTable";

// Validation Rule 4: Allowed file extensions
const VALID_EXTENSIONS = ["csv", "xlsx", "xls", "xml"];

// Validation Rule 2: Exact 12 official template column headers
export const OFFICIAL_HEADERS = [
  "rowNo",
  "meterNo",
  "meterPhase",
  "meterType",
  "linkedAccountNo",
  "premiseAddress",
  "premisePropertyType",
  "actionReason",
  "wardNo",
  "geofence",
  "meterStatus",
  "erfNo",
];

// Validation Rule 3: Row limits
export const MAX_UPLOAD_ROWS = 100;
export const MIN_UPLOAD_ROWS = 1;

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

// Chunk an array into sub-arrays of size N (Firestore 'in' operator max is 30)
function chunkArray(items, size = 30) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
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
  const [isValidating, setIsValidating] = useState(false);
  const [validationProgress, setValidationProgress] = useState("");
  const [parsedRows, setParsedRows] = useState([]);
  const [foundFilter, setFoundFilter] = useState("ALL"); // ALL, FOUND, NOT_FOUND
  const [lmFilter, setLmFilter] = useState("ALL"); // ALL, MATCH, MISMATCH

  // Handle file selection and multi-gate validation
  const handleFileChange = (file) => {
    setFileError("");
    setParsedRows([]);
    setFoundFilter("ALL");
    setLmFilter("ALL");

    if (!file) {
      setSelectedFile(null);
      return;
    }

    const fileName = file.name || "";
    const ext = fileName.split(".").pop().toLowerCase();

    // Gate 1: Check file extension
    if (!VALID_EXTENSIONS.includes(ext)) {
      setFileError(
        `Validation Failed: The file "${fileName}" is not supported. The file must be either a CSV or an Excel file (.csv, .xlsx, .xls, .xml).`
      );
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setSelectedFile(file);
    validateAndParseFile(file);
  };

  // Step 1 & 2 Multi-Gate Validation & ASTS Lookup
  const validateAndParseFile = async (file) => {
    setIsValidating(true);
    setValidationProgress("Reading and inspecting file structure...");
    setFileError("");

    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, {
          type: "array",
          cellText: false,
          cellDates: true,
          raw: false, // Preserves strings including leading zeroes
        });

        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
          setFileError("Validation Failed: The workbook contains no worksheets.");
          setIsValidating(false);
          return;
        }

        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        // Parse header row directly
        const sheetRows = XLSX.utils.sheet_to_json(worksheet, {
          header: 1,
          defval: "",
          blankrows: false,
        });

        if (!sheetRows || sheetRows.length === 0) {
          setFileError("Validation Failed: The file contains no data or headers.");
          setIsValidating(false);
          return;
        }

        const rawHeaderRow = (sheetRows[0] || []).map((h) => String(h || "").trim());

        // Gate 2: Exact Column Headers Parity (Exact names required)
        const missingHeaders = OFFICIAL_HEADERS.filter(
          (expected) => !rawHeaderRow.includes(expected)
        );
        const unexpectedHeaders = rawHeaderRow.filter(
          (actual) => actual && !OFFICIAL_HEADERS.includes(actual)
        );

        if (missingHeaders.length > 0 || unexpectedHeaders.length > 0) {
          const errorParts = [];
          if (missingHeaders.length > 0) {
            errorParts.push(`Missing required columns: [${missingHeaders.join(", ")}]`);
          }
          if (unexpectedHeaders.length > 0) {
            errorParts.push(`Unexpected extra columns: [${unexpectedHeaders.join(", ")}]`);
          }
          setFileError(
            `Validation Failed: Column headers must match the official template exactly (12 columns).\n${errorParts.join(" | ")}`
          );
          setIsValidating(false);
          return;
        }

        // Parse data rows as JSON using the header keys
        const rawDataRows = XLSX.utils.sheet_to_json(worksheet, {
          defval: "",
          raw: false,
        });

        // Gate 3: Row Count limits (1 to 100 rows)
        if (rawDataRows.length < MIN_UPLOAD_ROWS) {
          setFileError("Validation Failed: The uploaded file contains 0 meter rows.");
          setIsValidating(false);
          return;
        }

        if (rawDataRows.length > MAX_UPLOAD_ROWS) {
          setFileError(
            `Validation Failed: The file contains ${formatNumber(rawDataRows.length)} rows. Maximum allowed per upload file is ${MAX_UPLOAD_ROWS} meters.`
          );
          setIsValidating(false);
          return;
        }

        // Gate 4 & 5: Value Validation (No Blank Meter Numbers, No Duplicate Meters)
        const seenMeters = new Map();
        const seenRowNos = new Set();
        const parsedRowsDraft = [];

        for (let i = 0; i < rawDataRows.length; i++) {
          const rawRow = rawDataRows[i];
          const fileRowIdx = i + 1; // 1-based index

          // Meter Number: string trim, preserve leading zeros
          const meterNo = String(rawRow.meterNo || "").trim().toUpperCase();

          if (!meterNo) {
            setFileError(
              `Validation Failed: Row #${fileRowIdx} has an empty or blank meter number. 'meterNo' is mandatory for every row.`
            );
            setIsValidating(false);
            return;
          }

          if (seenMeters.has(meterNo)) {
            const prevRow = seenMeters.get(meterNo);
            setFileError(
              `Validation Failed: Duplicate meter number "${meterNo}" detected on row #${fileRowIdx} (already present on row #${prevRow}). Meter numbers must be unique within the file.`
            );
            setIsValidating(false);
            return;
          }
          seenMeters.set(meterNo, fileRowIdx);

          // rowNo sequence integrity: integer > 0 if provided, else auto-sequence
          let resolvedRowNo = fileRowIdx;
          if (rawRow.rowNo !== "" && rawRow.rowNo !== undefined) {
            const parsedNo = parseInt(String(rawRow.rowNo).trim(), 10);
            if (Number.isNaN(parsedNo) || parsedNo <= 0) {
              setFileError(
                `Validation Failed: Row #${fileRowIdx} has an invalid rowNo "${rawRow.rowNo}". rowNo must be a positive whole number.`
              );
              setIsValidating(false);
              return;
            }
            if (seenRowNos.has(parsedNo)) {
              setFileError(
                `Validation Failed: Duplicate rowNo "${parsedNo}" detected on row #${fileRowIdx}. rowNo must be unique.`
              );
              setIsValidating(false);
              return;
            }
            seenRowNos.add(parsedNo);
            resolvedRowNo = parsedNo;
          }

          parsedRowsDraft.push({
            _rowNo: resolvedRowNo,
            rowNo: resolvedRowNo,
            meterNo,
            meterPhase: String(rawRow.meterPhase || "").trim(),
            meterType: String(rawRow.meterType || "").trim(),
            linkedAccountNo: String(rawRow.linkedAccountNo || "").trim(),
            premiseAddress: String(rawRow.premiseAddress || "").trim(),
            premisePropertyType: String(rawRow.premisePropertyType || "").trim(),
            actionReason: String(rawRow.actionReason || "").trim(),
            wardNo: String(rawRow.wardNo || "").trim(),
            geofence: String(rawRow.geofence || "").trim(),
            meterStatus: String(rawRow.meterStatus || "").trim(),
            erfNo: String(rawRow.erfNo || "").trim(),
          });
        }

        // Gate 6: Query ASTS in Firestore (At least 1 meter must exist)
        setValidationProgress(
          `Verifying ${parsedRowsDraft.length} meters against authoritative asset database (asts)...`
        );

        const meterAstMap = new Map();
        const allMeterNos = parsedRowsDraft.map((r) => r.meterNo);
        const chunks = chunkArray(allMeterNos, 30);

        for (const chunk of chunks) {
          const astQuery = query(
            collection(db, "asts"),
            where("ast.astData.astNo", "in", chunk)
          );
          const snap = await getDocs(astQuery);
          snap.forEach((doc) => {
            const data = doc.data();
            const astNo = String(
              data?.ast?.astData?.astNo || data?.master?.id || ""
            ).trim().toUpperCase();
            if (astNo) {
              meterAstMap.set(astNo, {
                id: doc.id,
                ...data,
              });
            }
          });
        }

        const foundCount = meterAstMap.size;

        // Gate 6 Check: At least 1 meter must exist
        if (foundCount === 0) {
          setFileError(
            `Validation Failed: None of the ${parsedRowsDraft.length} meters in this file exist in the asset database (asts). At least 1 existing meter is required to proceed.`
          );
          setIsValidating(false);
          return;
        }

        // Enrich parsed rows with ASTS verification details and LM Match
        const enrichedRows = parsedRowsDraft.map((row) => {
          const astDoc = meterAstMap.get(row.meterNo);
          const foundInAsts = Boolean(astDoc);
          const astLmPcode = String(
            astDoc?.accessData?.parents?.lmPcode || ""
          ).trim();
          const astWardPcode = String(
            astDoc?.accessData?.parents?.wardPcode || ""
          ).trim();
          const astStatus = String(
            astDoc?.status?.state || astDoc?.status || "CONNECTED"
          ).trim().toUpperCase();

          // LM match check
          const isLmMatch =
            foundInAsts &&
            (!lmPcode || !astLmPcode || astLmPcode.toUpperCase() === lmPcode.toUpperCase());

          const resolvedAddress =
            row.premiseAddress ||
            astDoc?.ast?.location?.address ||
            astDoc?.master?.premiseAddress ||
            "NAv";

          const resolvedErf = row.erfNo || astDoc?.accessData?.erfNo || "";

          return {
            ...row,
            foundInAsts,
            isLmMatch,
            astDocId: astDoc?.id || null,
            astLmPcode: astLmPcode || "NAv",
            astWardPcode: astWardPcode || "NAv",
            astStatus: foundInAsts ? astStatus : "NOT_IN_ASTS",
            resolvedAddress,
            resolvedErf,
          };
        });

        setParsedRows(enrichedRows);
      } catch (err) {
        console.error("File validation error:", err);
        setFileError(`Failed to validate file: ${err?.message || "Unknown error"}`);
      } finally {
        setIsValidating(false);
        setValidationProgress("");
      }
    };

    reader.onerror = () => {
      setFileError("Failed to read file from disk.");
      setIsValidating(false);
      setValidationProgress("");
    };

    reader.readAsArrayBuffer(file);
  };

  const handleReset = () => {
    setSelectedFile(null);
    setParsedRows([]);
    setFileError("");
    setValidationProgress("");
    setFoundFilter("ALL");
    setLmFilter("ALL");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Summary counts
  const summary = useMemo(() => {
    const total = parsedRows.length;
    const found = parsedRows.filter((r) => r.foundInAsts).length;
    const notFound = total - found;
    const lmMatches = parsedRows.filter((r) => r.isLmMatch).length;
    const lmMismatches = found - lmMatches;
    return { total, found, notFound, lmMatches, lmMismatches };
  }, [parsedRows]);

  // Filtered rows based on Found/Not Found and LM Match filters
  const filteredRows = useMemo(() => {
    return parsedRows.filter((row) => {
      if (foundFilter === "FOUND" && !row.foundInAsts) return false;
      if (foundFilter === "NOT_FOUND" && row.foundInAsts) return false;

      if (lmFilter === "MATCH" && (!row.foundInAsts || !row.isLmMatch)) return false;
      if (lmFilter === "MISMATCH" && (!row.foundInAsts || row.isLmMatch)) return false;

      return true;
    });
  }, [parsedRows, foundFilter, lmFilter]);

  // Download Not Found CSV Report
  const handleDownloadNotFoundCsv = () => {
    const notFoundRows = parsedRows.filter((r) => !r.foundInAsts);
    if (notFoundRows.length === 0) return;

    const headers = ["rowNo", "meterNo", "linkedAccountNo", "premiseAddress", "actionReason", "validationResult"];
    const rows = notFoundRows.map((r) => [
      r.rowNo,
      r.meterNo,
      r.linkedAccountNo,
      r.premiseAddress,
      r.actionReason,
      "NOT_FOUND_IN_ASTS",
    ]);

    const csvContent = [headers, ...rows]
      .map((row) => row.map((val) => `"${String(val || "").replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `NOT_FOUND_METERS_${selectedFile?.name || "upload"}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Build IrepsTable columns
  const columns = useMemo(() => {
    return [
      {
        key: "_rowNo",
        label: "#",
        width: 60,
        filter: null,
        sortable: true,
        value: (r) => String(r.rowNo || r._rowNo),
        sortValue: (r) => Number(r.rowNo || r._rowNo),
        render: (r) => <strong>{r.rowNo || r._rowNo}</strong>,
      },
      {
        key: "meterNo",
        label: "Meter No",
        width: 150,
        filter: "text",
        sortable: true,
        value: (r) => String(r.meterNo || ""),
        sortValue: (r) => String(r.meterNo || ""),
        render: (r) => <span style={styles.meterNoCell}>{r.meterNo}</span>,
      },
      {
        key: "foundInAsts",
        label: "In ASTS?",
        width: 120,
        filter: "select",
        sortable: true,
        value: (r) => (r.foundInAsts ? "EXISTS" : "NOT FOUND"),
        sortValue: (r) => (r.foundInAsts ? 1 : 0),
        render: (r) => (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "2px 8px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 800,
              background: r.foundInAsts ? "#ecfdf5" : "#fef2f2",
              color: r.foundInAsts ? "#047857" : "#b91c1c",
              border: `1px solid ${r.foundInAsts ? "#a7f3d0" : "#fecaca"}`,
            }}
          >
            {r.foundInAsts ? "✓ EXISTS" : "✗ NOT FOUND"}
          </span>
        ),
      },
      {
        key: "isLmMatch",
        label: "LM Match",
        width: 130,
        filter: "select",
        sortable: true,
        value: (r) =>
          !r.foundInAsts ? "N/A" : r.isLmMatch ? "MATCH" : `OTHER (${r.astLmPcode})`,
        sortValue: (r) => (r.isLmMatch ? 1 : 0),
        render: (r) => {
          if (!r.foundInAsts) {
            return <span style={{ color: "#94a3b8", fontSize: 11 }}>N/A</span>;
          }
          if (r.isLmMatch) {
            return (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "2px 8px",
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 800,
                  background: "#eff6ff",
                  color: "#1d4ed8",
                  border: "1px solid #bfdbfe",
                }}
              >
                ✓ {r.astLmPcode || "MATCH"}
              </span>
            );
          }
          return (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "2px 8px",
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 800,
                background: "#fffbeb",
                color: "#b45309",
                border: "1px solid #fde68a",
              }}
              title={`Meter belongs to municipality ${r.astLmPcode}`}
            >
              ⚠ {r.astLmPcode || "MISMATCH"}
            </span>
          );
        },
      },
      {
        key: "linkedAccountNo",
        label: "Account No",
        width: 130,
        filter: "text",
        sortable: true,
        value: (r) => String(r.linkedAccountNo || ""),
        sortValue: (r) => String(r.linkedAccountNo || ""),
        render: (r) => (
          <span style={{ fontSize: 12, color: "#334155" }}>
            {r.linkedAccountNo || "—"}
          </span>
        ),
      },
      {
        key: "resolvedAddress",
        label: "Premise Address",
        filter: "text",
        sortable: true,
        value: (r) => String(r.resolvedAddress || ""),
        sortValue: (r) => String(r.resolvedAddress || ""),
        render: (r) => (
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: "#0f172a" }}>
              {r.resolvedAddress || "—"}
            </div>
            {r.resolvedErf ? (
              <div style={{ fontSize: 11, color: "#64748b" }}>ERF: {r.resolvedErf}</div>
            ) : null}
          </div>
        ),
      },
      {
        key: "wardNo",
        label: "Ward",
        width: 110,
        filter: "text",
        sortable: true,
        value: (r) => String(r.astWardPcode !== "NAv" ? r.astWardPcode : r.wardNo || ""),
        sortValue: (r) => String(r.astWardPcode !== "NAv" ? r.astWardPcode : r.wardNo || ""),
        render: (r) => (
          <span style={{ fontSize: 12, color: "#475569" }}>
            {r.astWardPcode !== "NAv" ? r.astWardPcode : r.wardNo || "—"}
          </span>
        ),
      },
      {
        key: "astStatus",
        label: "AST Status",
        width: 130,
        filter: "select",
        sortable: true,
        value: (r) => String(r.astStatus || ""),
        sortValue: (r) => String(r.astStatus || ""),
        render: (r) => {
          const val = r.astStatus;
          const isConn = val === "CONNECTED";
          const isDisconn = val === "DISCONNECTED";
          return (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "2px 8px",
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 800,
                background: isConn ? "#ecfdf5" : isDisconn ? "#fff7ed" : "#f1f5f9",
                color: isConn ? "#047857" : isDisconn ? "#c2410c" : "#475569",
                border: `1px solid ${
                  isConn ? "#a7f3d0" : isDisconn ? "#fed7aa" : "#cbd5e1"
                }`,
              }}
            >
              {val}
            </span>
          );
        },
      },
      {
        key: "actionReason",
        label: "Action Reason",
        filter: "text",
        sortable: true,
        value: (r) => String(r.actionReason || ""),
        sortValue: (r) => String(r.actionReason || ""),
        render: (r) => (
          <span style={{ fontSize: 12, color: "#475569" }}>
            {r.actionReason || "—"}
          </span>
        ),
      },
    ];
  }, []);

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
              <span style={styles.lmHeaderLabel}>Active Municipality:</span>
              <strong style={styles.lmHeaderValue}>{lmName || lmPcode || "All"}</strong>
              {lmPcode ? <span style={styles.lmHeaderPcode}>({lmPcode})</span> : null}
            </div>
          </div>
          <p style={styles.subtitle}>
            Step 1 & 2: Upload external meter list (.csv / Excel), validate 12-column template & row constraints, and inspect asset existence in asts.
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

      {/* Upload Dropzone Card (when no rows parsed yet) */}
      {parsedRows.length === 0 ? (
        <div style={styles.uploadCard}>
          <div style={styles.uploadCardHeader}>
            <div>
              <h3 style={styles.uploadCardTitle}>Select File to Upload</h3>
              <p style={styles.uploadCardSubtitle}>
                Supported formats: <strong>CSV</strong> (<code>.csv</code>) or <strong>Excel</strong> (<code>.xlsx</code>, <code>.xls</code>, <code>.xml</code>). Maximum <strong>100 meters</strong> per file.
              </p>
            </div>
          </div>

          {fileError ? (
            <div style={styles.errorNotice} role="alert">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" style={{ flexShrink: 0, marginTop: 2 }}>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <div style={{ whiteSpace: "pre-line", lineHeight: 1.5 }}>{fileError}</div>
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
              <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>

            <p style={styles.dropzoneText}>
              <strong>Click to browse</strong> or drag & drop meter file here
            </p>
            <p style={styles.dropzoneSubtext}>
              Must use official 12-column template. Max 100 rows. At least 1 meter must exist in asts.
            </p>
          </div>
        </div>
      ) : null}

      {/* Loading validation indicator */}
      {isValidating ? (
        <div style={styles.parsingNotice}>
          <div style={styles.spinner} />
          <div>{validationProgress || "Validating file... Please wait."}</div>
        </div>
      ) : null}

      {/* Validated Rows Table View */}
      {parsedRows.length > 0 ? (
        <div style={styles.previewSection}>
          {/* File Meta & Validation Summary Banner */}
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
              <span style={styles.fileMetaLabel}>Total Meters</span>
              <strong style={{ ...styles.fileMetaValue, color: "#0f172a" }}>
                {formatNumber(summary.total)}
              </strong>
            </div>

            <div style={styles.fileMetaItem}>
              <span style={styles.fileMetaLabel}>Found in ASTS</span>
              <strong style={{ ...styles.fileMetaValue, color: "#16a34a" }}>
                {formatNumber(summary.found)}
              </strong>
            </div>

            <div style={styles.fileMetaItem}>
              <span style={styles.fileMetaLabel}>Not Found</span>
              <strong style={{ ...styles.fileMetaValue, color: summary.notFound > 0 ? "#dc2626" : "#64748b" }}>
                {formatNumber(summary.notFound)}
              </strong>
            </div>

            <div style={styles.fileMetaItem}>
              <span style={styles.fileMetaLabel}>LM Matches</span>
              <strong style={{ ...styles.fileMetaValue, color: "#2563eb" }}>
                {formatNumber(summary.lmMatches)}
              </strong>
            </div>

            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
              {summary.notFound > 0 ? (
                <button
                  type="button"
                  style={styles.downloadButton}
                  onClick={handleDownloadNotFoundCsv}
                  title="Download CSV report of meters not found in asts"
                >
                  ↓ Download Not Found CSV ({summary.notFound})
                </button>
              ) : null}

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

          {/* Quick Filter Bar */}
          <div style={styles.filterBar}>
            <div style={styles.filterGroup}>
              <span style={styles.filterLabel}>ASTS Filter:</span>
              <button
                type="button"
                style={{
                  ...styles.filterPill,
                  ...(foundFilter === "ALL" ? styles.filterPillActive : null),
                }}
                onClick={() => setFoundFilter("ALL")}
              >
                All ({summary.total})
              </button>
              <button
                type="button"
                style={{
                  ...styles.filterPill,
                  ...(foundFilter === "FOUND" ? styles.filterPillActive : null),
                }}
                onClick={() => setFoundFilter("FOUND")}
              >
                ✓ Exists in ASTS ({summary.found})
              </button>
              <button
                type="button"
                style={{
                  ...styles.filterPill,
                  ...(foundFilter === "NOT_FOUND" ? styles.filterPillActive : null),
                }}
                onClick={() => setFoundFilter("NOT_FOUND")}
              >
                ✗ Not Found ({summary.notFound})
              </button>
            </div>

            <div style={styles.filterGroup}>
              <span style={styles.filterLabel}>LM Scope:</span>
              <button
                type="button"
                style={{
                  ...styles.filterPill,
                  ...(lmFilter === "ALL" ? styles.filterPillActive : null),
                }}
                onClick={() => setLmFilter("ALL")}
              >
                All
              </button>
              <button
                type="button"
                style={{
                  ...styles.filterPill,
                  ...(lmFilter === "MATCH" ? styles.filterPillActive : null),
                }}
                onClick={() => setLmFilter("MATCH")}
              >
                Active LM ({summary.lmMatches})
              </button>
              <button
                type="button"
                style={{
                  ...styles.filterPill,
                  ...(lmFilter === "MISMATCH" ? styles.filterPillActive : null),
                }}
                onClick={() => setLmFilter("MISMATCH")}
              >
                Other LM ({summary.lmMismatches})
              </button>
            </div>
          </div>

          {/* IrepsTable displaying validated rows */}
          <div style={styles.tablePanel}>
            <IrepsTable
              rows={filteredRows}
              columns={columns}
              rowKey={(r, idx) => r?.meterNo || r?.rowNo || r?._rowNo || idx}
              title={`Uploaded File Inspection: ${selectedFile?.name || "File"} (${formatNumber(filteredRows.length)} Rows Showing)`}
              pageSizeOptions={[10, 25, 50, 100]}
              defaultPageSize={25}
              emptyText="No rows match the selected filters."
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
    gap: 8,
    padding: "8px 14px",
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#334155",
    textDecoration: "none",
    fontWeight: 700,
    fontSize: 13,
  },
  uploadCard: {
    background: "#ffffff",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    padding: 24,
    display: "flex",
    flexDirection: "column",
    gap: 16,
    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
  },
  uploadCardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  uploadCardTitle: {
    margin: "0 0 4px",
    fontSize: 16,
    fontWeight: 800,
    color: "#0f172a",
  },
  uploadCardSubtitle: {
    margin: 0,
    fontSize: 13,
    color: "#64748b",
  },
  errorNotice: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    borderRadius: 8,
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#991b1b",
    fontSize: 13,
    fontWeight: 600,
  },
  dropzone: {
    border: "2px dashed #93c5fd",
    background: "#f8fafc",
    borderRadius: 12,
    padding: "48px 24px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    transition: "border-color 0.15s ease",
  },
  dropzoneIcon: {
    marginBottom: 12,
  },
  dropzoneText: {
    margin: "0 0 4px",
    fontSize: 15,
    color: "#1e293b",
  },
  dropzoneSubtext: {
    margin: 0,
    fontSize: 12,
    color: "#64748b",
  },
  parsingNotice: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 8,
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    color: "#1e40af",
    fontSize: 14,
    fontWeight: 600,
  },
  spinner: {
    width: 20,
    height: 20,
    border: "3px solid #93c5fd",
    borderTopColor: "#2563eb",
    borderRadius: "50%",
    animation: "spin 1s linear infinite",
  },
  previewSection: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  fileSummaryBanner: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 20,
    padding: "16px 20px",
    borderRadius: 10,
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
  },
  fileMetaItem: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
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
    padding: "8px 14px",
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#475569",
    fontWeight: 700,
    fontSize: 12,
    cursor: "pointer",
  },
  downloadButton: {
    padding: "8px 14px",
    borderRadius: 8,
    border: "1px solid #fca5a5",
    background: "#fef2f2",
    color: "#b91c1c",
    fontWeight: 700,
    fontSize: 12,
    cursor: "pointer",
  },
  filterBar: {
    display: "flex",
    alignItems: "center",
    gap: 24,
    padding: "10px 16px",
    background: "#ffffff",
    borderRadius: 8,
    border: "1px solid #e2e8f0",
  },
  filterGroup: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  filterLabel: {
    fontSize: 12,
    fontWeight: 700,
    color: "#475569",
  },
  filterPill: {
    padding: "4px 10px",
    borderRadius: 9999,
    border: "1px solid #e2e8f0",
    background: "#f8fafc",
    color: "#475569",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  },
  filterPillActive: {
    background: "#2563eb",
    color: "#ffffff",
    borderColor: "#2563eb",
  },
  tablePanel: {
    background: "#ffffff",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    overflow: "hidden",
  },
  meterNoCell: {
    fontFamily: "monospace",
    fontWeight: 800,
    fontSize: 13,
    color: "#0f172a",
    background: "#f1f5f9",
    padding: "2px 6px",
    borderRadius: 4,
  },
};
