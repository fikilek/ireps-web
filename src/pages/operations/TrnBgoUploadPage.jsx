import { useState, useMemo, useRef, useEffect, useCallback } from "react";

function getRowSelectionKey(row) {
  return String(row?.rowNo || row?._rowNo || row?.meterNo || "");
}

function MasterCheckbox({ checked, indeterminate, disabled, onChange, title }) {
  const checkboxRef = useRef(null);

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = Boolean(indeterminate && !checked);
    }
  }, [checked, indeterminate]);

  return (
    <input
      ref={checkboxRef}
      type="checkbox"
      checked={Boolean(checked)}
      disabled={Boolean(disabled)}
      onChange={onChange}
      title={title}
      aria-label={title || "Select all filtered rows"}
      style={{
        width: 16,
        height: 16,
        cursor: disabled ? "not-allowed" : "pointer",
        accentColor: "#2563eb",
      }}
    />
  );
}
import { Link, useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { collection, query, where, getDocs, documentId } from "firebase/firestore";

import { db } from "../../firebase";
import { useAuth } from "../../auth/useAuth";
import { useGeo } from "@/context/GeoContext";
import IrepsTable from "../../components/table/IrepsTable";
import {
  useUploadAndValidateTcMutation,
  useCreateTrnBgoWardBatchesMutation,
  useAllocateTrnBgoWardBatchesMutation,
} from "../../redux/tcApi";
import { useGetAvailableTeamsQuery } from "../../redux/teamsApi";
import { useGetAvailableServiceProvidersQuery } from "../../redux/serviceProvidersApi";

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

export const COMPARABLE_FIELD_KEYS = [
  "meterPhase",
  "meterType",
  "linkedAccountNo",
  "premiseAddress",
  "premisePropertyType",
  "wardNo",
  "geofence",
  "meterStatus",
  "erfNo",
];

const NAV_SET = new Set([
  "",
  "NAV",
  "N/AV",
  "N/A",
  "NA",
  "NULL",
  "UNDEFINED",
  "—",
  "-",
  "BLANK",
]);

function firstMeaningfulValue(...candidates) {
  for (const cand of candidates) {
    if (cand === null || cand === undefined) continue;
    const str = String(cand).trim();
    if (!str) continue;
    if (NAV_SET.has(str.toUpperCase())) continue;
    return str;
  }
  return "NAv";
}

function buildPremiseAddressText(address) {
  if (!address) return "";
  if (typeof address === "string") return address.trim();
  const parts = [
    address?.strNo,
    address?.strName,
    address?.strType,
    address?.suburbName,
  ]
    .map((p) => String(p || "").trim())
    .filter((p) => p && !NAV_SET.has(p.toUpperCase()));
  return parts.join(" ");
}

function extractWardNoFromPcode(value) {
  const str = String(value || "").trim();
  if (!str || NAV_SET.has(str.toUpperCase())) return "";
  if (/^\d+$/.test(str)) return String(Number(str));
  const digits = str.replace(/\D/g, "");
  if (!digits) return str;
  const lastThree = digits.slice(-3);
  const wardNo = Number(lastThree);
  return Number.isFinite(wardNo) && wardNo > 0 ? String(wardNo) : str;
}

function extractGeofenceNames(refs) {
  if (!Array.isArray(refs) || refs.length === 0) return "";
  const names = refs
    .map((r) =>
      String(r?.name || r?.label || r?.description || r?.id || "").trim()
    )
    .filter((n) => n && !NAV_SET.has(n.toUpperCase()));
  return Array.from(new Set(names)).join(", ");
}

function normalizeForComparison(val) {
  const s = String(val ?? "").trim();
  if (!s) return "";
  const u = s.toUpperCase();
  if (NAV_SET.has(u)) return "";
  return u.replace(/\s+/g, " ");
}

function buildFieldComparison(fileRaw, irepsRaw, foundInAsts) {
  const fileClean = String(fileRaw ?? "").trim();
  const fileDisplay =
    fileClean && !NAV_SET.has(fileClean.toUpperCase()) ? fileClean : "Blank";

  if (!foundInAsts) {
    return {
      fileDisplay,
      irepsDisplay: "NAv",
      isMatch: false,
    };
  }

  const irepsClean = String(irepsRaw ?? "").trim();
  const irepsDisplay =
    irepsClean && !NAV_SET.has(irepsClean.toUpperCase()) ? irepsClean : "NAv";

  const fNorm = normalizeForComparison(fileDisplay);
  const iNorm = normalizeForComparison(irepsDisplay);

  const isMatch = Boolean(fNorm && iNorm && fNorm === iNorm);

  return {
    fileDisplay,
    irepsDisplay,
    isMatch,
  };
}

function renderStackedComparisonCell(comp, foundInAsts) {
  const fileDisplay = comp?.fileDisplay || "Blank";
  const irepsDisplay = comp?.irepsDisplay || "NAv";
  const isBlankFile = fileDisplay === "Blank";
  const isMatch = Boolean(comp?.isMatch);

  const bg = !foundInAsts ? "#fef2f2" : isMatch ? "#f8fafc" : "#fffbeb";
  const border = !foundInAsts ? "#fecaca" : isMatch ? "#e2e8f0" : "#fcd34d";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: "4px 8px",
        borderRadius: 6,
        fontSize: 12,
        lineHeight: 1.35,
        background: bg,
        border: `1px solid ${border}`,
        minWidth: 145,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
        }}
      >
        <div
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: 42,
              fontWeight: 700,
              color: "#64748b",
            }}
          >
            File:
          </span>
          <span
            style={{
              fontStyle: isBlankFile ? "italic" : "normal",
              fontWeight: isBlankFile ? 500 : 600,
              color: isBlankFile ? "#94a3b8" : "#1e293b",
            }}
          >
            {fileDisplay}
          </span>
        </div>
        {foundInAsts ? (
          isMatch ? (
            <span
              style={{ color: "#059669", fontWeight: 800, flexShrink: 0 }}
              title="File matches iREPS"
            >
              ✓
            </span>
          ) : (
            <span
              style={{ color: "#b45309", fontWeight: 800, flexShrink: 0 }}
              title="Discrepancy between File and iREPS"
            >
              ≠
            </span>
          )
        ) : null}
      </div>
      <div
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          borderTop: "1px solid rgba(226, 232, 240, 0.7)",
          paddingTop: 2,
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 42,
            fontWeight: 700,
            color: "#64748b",
          }}
        >
          iREPS:
        </span>
        <span
          style={{
            fontWeight: 600,
            color:
              !foundInAsts || irepsDisplay === "NAv" ? "#dc2626" : "#1e3a8a",
          }}
        >
          {irepsDisplay}
        </span>
      </div>
    </div>
  );
}

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


function resolveRowWardInfo(row, fallbackLmPcode = "") {
  const rawWardPcode = String(row?.astWardPcode || "").trim().toUpperCase();
  const rawWardNo = String(
    row?.irepsValues?.wardNo && row.irepsValues.wardNo !== "NAv"
      ? row.irepsValues.wardNo
      : row?.wardNo || ""
  ).trim();

  const lm = String(row?.astLmPcode && row.astLmPcode !== "NAv" ? row.astLmPcode : fallbackLmPcode || "")
    .trim()
    .toUpperCase();

  let wardPcode = rawWardPcode && rawWardPcode !== "NAV" ? rawWardPcode : "";
  const digits = rawWardNo.replace(/\D/g, "");

  if (!wardPcode && lm && digits) {
    wardPcode = `${lm}${digits.padStart(3, "0")}`;
  }

  let wardNo = digits ? String(Number(digits)) : "";
  if (!wardNo && wardPcode && wardPcode.length >= 3) {
    const suffix = wardPcode.slice(-3).replace(/\D/g, "");
    if (suffix) wardNo = String(Number(suffix));
  }

  return {
    wardPcode: wardPcode || "NAv",
    wardNo: wardNo || "NAv",
    wardLabel: wardNo ? `Ward ${wardNo}` : wardPcode || "Unassigned Ward",
  };
}

function inferTrnTypeFromRows(rows = []) {
  for (const r of rows) {
    const reason = String(r?.actionReason || "").toUpperCase();
    if (reason.includes("RECONNECT")) return "METER_RECONNECTION";
    if (reason.includes("DISCONNECT")) return "METER_DISCONNECTION";
    if (reason.includes("REMOV")) return "METER_REMOVAL";
    if (reason.includes("INSPECT")) return "METER_INSPECTION";
    if (reason.includes("READ")) return "METER_READING";
  }
  return "METER_DISCONNECTION";
}

const TRN_OPERATION_OPTIONS = [
  { value: "METER_DISCONNECTION", code: "MDCN", label: "Meter Disconnection (MDCN)" },
  { value: "METER_RECONNECTION", code: "MRCN", label: "Meter Reconnection (MRCN)" },
  { value: "METER_INSPECTION", code: "MINSP", label: "Meter Inspection (MINSP)" },
  { value: "METER_READING", code: "MREAD", label: "Meter Reading (MREAD)" },
  { value: "METER_REMOVAL", code: "MREM", label: "Meter Removal (MREM)" },
];

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
  const [statFilter, setStatFilter] = useState("ALL"); // ALL, FOUND, NOT_FOUND, LM_MATCH, SELECTED
  const [selectedRowKeys, setSelectedRowKeys] = useState(() => new Set());
  const [shownRows, setShownRows] = useState(null);
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState("INSPECTION"); // "INSPECTION" | "DRAFT"
  const [carriedBatchRows, setCarriedBatchRows] = useState([]);
  const [selectedTrnType, setSelectedTrnType] = useState("METER_DISCONNECTION");
  const [batchNotes, setBatchNotes] = useState("");
  const [isCreatingBatches, setIsCreatingBatches] = useState(false);
  const [createdBatchesResult, setCreatedBatchesResult] = useState([]);
  const [batchCreateError, setBatchCreateError] = useState("");
  const [creationModalState, setCreationModalState] = useState(null); // null | { status: "PASS" | "FAIL", title, message, errors, batches, totalMeters }
  const [allocationMode, setAllocationMode] = useState("UNALLOCATED"); // "UNALLOCATED" | "TEAM" | "SP"
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [selectedSpId, setSelectedSpId] = useState("");
  const [isAllocating, setIsAllocating] = useState(false);
  const [allocationError, setAllocationError] = useState("");

  const [uploadAndValidateTc] = useUploadAndValidateTcMutation();
  const [createTrnBgoWardBatches] = useCreateTrnBgoWardBatchesMutation();
  const [allocateTrnBgoWardBatches] = useAllocateTrnBgoWardBatchesMutation();
  const { data: availableTeams = [] } = useGetAvailableTeamsQuery();
  const { data: availableServiceProviders = [] } = useGetAvailableServiceProvidersQuery();

  // Handle file selection and multi-gate validation
  const handleFileChange = (file) => {
    setFileError("");
    setParsedRows([]);
    setSelectedRowKeys(new Set());
    setShownRows(null);
    setViewMode("INSPECTION");
    setViewMode("INSPECTION");
    setCarriedBatchRows([]);
    setCreatedBatchesResult([]);
    setBatchCreateError("");
    setCreationModalState(null);
    setCreationModalState(null);
    setFoundFilter("ALL");
    setLmFilter("ALL");
    setStatFilter("ALL");
    setStatFilter("ALL");

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
        const ext = (file.name || "").split(".").pop().toLowerCase();
        let workbook;
        if (ext === "csv") {
          const text =
            typeof e.target.result === "string"
              ? e.target.result
              : new TextDecoder().decode(e.target.result);
          workbook = XLSX.read(text, {
            type: "string",
            raw: true,
          });
        } else {
          const data = new Uint8Array(e.target.result);
          workbook = XLSX.read(data, {
            type: "array",
            raw: true,
          });
        }

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
          raw: true,
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

          const isDupInFile = seenMeters.has(meterNo);
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
            isDuplicate: isDupInFile,
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
        const meterRegMap = new Map();
        const meterSalesMap = new Map();
        const premiseIdsSet = new Set();
        const queryMetersSet = new Set();

        parsedRowsDraft.forEach((r) => {
          queryMetersSet.add(r.meterNo);
          if (r.meterNo.length === 10 && /^\d+$/.test(r.meterNo)) {
            queryMetersSet.add("0" + r.meterNo);
          }
          if (r.meterNo.startsWith("0") && r.meterNo.length === 11) {
            queryMetersSet.add(r.meterNo.slice(1));
          }
        });
        const allQueryMeterNos = Array.from(queryMetersSet);
        const chunks = chunkArray(allQueryMeterNos, 30);

        const registerInMap = (map, num, entry) => {
          if (!num) return;
          map.set(num, entry);
          if (num.startsWith("0")) {
            map.set(num.slice(1), entry);
          } else if (num.length === 10) {
            map.set("0" + num, entry);
          }
        };

        for (const chunk of chunks) {
          const astQuery1 = query(
            collection(db, "asts"),
            where("ast.astData.astNo", "in", chunk)
          );
          const astQuery2 = query(
            collection(db, "asts"),
            where("master.id", "in", chunk)
          );
          const regQuery = query(
            collection(db, "registry_meters"),
            where("meterNo", "in", chunk)
          );
          const salesQuery = query(
            collection(db, "sales-all-meters"),
            where(documentId(), "in", chunk)
          );

          const [snap1, snap2, regSnap, salesSnap] = await Promise.all([
            getDocs(astQuery1),
            getDocs(astQuery2),
            getDocs(regQuery).catch(() => null),
            getDocs(salesQuery).catch(() => null),
          ]);

          [snap1, snap2].forEach((snap) => {
            if (!snap) return;
            snap.forEach((doc) => {
              const data = doc.data();
              const astNo = String(
                data?.ast?.astData?.astNo || data?.master?.id || ""
              ).trim().toUpperCase();
              const masterId = String(data?.master?.id || "").trim().toUpperCase();
              const docEntry = { id: doc.id, ...data };
              [astNo, masterId].filter(Boolean).forEach((num) => {
                registerInMap(meterAstMap, num, docEntry);
              });
              const pId = String(
                data?.accessData?.premise?.id ||
                  data?.accessData?.premiseId ||
                  data?.premise?.id ||
                  data?.premiseId ||
                  ""
              ).trim();
              if (pId && !NAV_SET.has(pId.toUpperCase())) {
                premiseIdsSet.add(pId);
              }
            });
          });

          if (regSnap) {
            regSnap.forEach((doc) => {
              const data = doc.data();
              const mNo = String(data?.meterNo || "").trim().toUpperCase();
              const docEntry = { id: doc.id, ...data };
              registerInMap(meterRegMap, mNo, docEntry);
              const pId = String(data?.premiseId || "").trim();
              if (pId && !NAV_SET.has(pId.toUpperCase())) {
                premiseIdsSet.add(pId);
              }
            });
          }

          if (salesSnap) {
            salesSnap.forEach((doc) => {
              const data = doc.data();
              const mNo = String(
                data?.meterNoNormalized || data?.meterNo || data?.MeterNumber || doc.id || ""
              ).trim().toUpperCase();
              registerInMap(meterSalesMap, mNo, { id: doc.id, ...data });
            });
          }
        }

        const premiseMap = new Map();
        const premiseChunks = chunkArray(Array.from(premiseIdsSet), 30);
        for (const pChunk of premiseChunks) {
          if (pChunk.length === 0) continue;
          const pQuery = query(
            collection(db, "premises"),
            where(documentId(), "in", pChunk)
          );
          const pSnap = await getDocs(pQuery).catch(() => null);
          if (pSnap) {
            pSnap.forEach((doc) => {
              premiseMap.set(doc.id, { id: doc.id, ...doc.data() });
            });
          }
        }

        const foundCount = parsedRowsDraft.filter((r) =>
          meterAstMap.has(r.meterNo) ||
          (r.meterNo.length === 10 && meterAstMap.has("0" + r.meterNo))
        ).length;

        // Gate 6 Check: At least 1 meter must exist
        if (foundCount === 0) {
          setFileError(
            `Validation Failed: None of the ${parsedRowsDraft.length} meters in this file exist in the asset database (asts). At least 1 existing meter is required to proceed.`
          );
          setIsValidating(false);
          return;
        }

        // Enrich parsed rows with ASTS verification details, iREPS repo values, and dataMatch
        const enrichedRows = parsedRowsDraft.map((row) => {
          const astDoc =
            meterAstMap.get(row.meterNo) ||
            (row.meterNo.length === 10 ? meterAstMap.get("0" + row.meterNo) : null);
          const regDoc =
            meterRegMap.get(row.meterNo) ||
            (row.meterNo.length === 10 ? meterRegMap.get("0" + row.meterNo) : null);
          const salesDoc =
            meterSalesMap.get(row.meterNo) ||
            (row.meterNo.length === 10 ? meterSalesMap.get("0" + row.meterNo) : null);

          const foundInAsts = Boolean(astDoc);
          const premiseId = String(
            astDoc?.accessData?.premise?.id ||
              astDoc?.accessData?.premiseId ||
              astDoc?.premise?.id ||
              astDoc?.premiseId ||
              regDoc?.premiseId ||
              ""
          ).trim();
          const premiseDoc = premiseId ? premiseMap.get(premiseId) || null : null;

          const astLmPcode = String(
            astDoc?.accessData?.parents?.lmPcode || regDoc?.parents?.lmPcode || ""
          ).trim();
          const astWardPcode = String(
            astDoc?.accessData?.parents?.wardPcode ||
              regDoc?.parents?.wardPcode ||
              premiseDoc?.wardPcode ||
              premiseDoc?.parents?.wardPcode ||
              salesDoc?.erfCandidates?.[0]?.WardPcode ||
              salesDoc?.ErfCandidates?.[0]?.WardPcode ||
              ""
          ).trim();
          const astStatus = String(
            astDoc?.status?.state ||
              (typeof astDoc?.status === "string" ? astDoc?.status : "") ||
              regDoc?.statusState ||
              regDoc?.status ||
              "CONNECTED"
          ).trim().toUpperCase();

          // LM match check
          const isLmMatch =
            foundInAsts &&
            (!lmPcode || !astLmPcode || astLmPcode.toUpperCase() === lmPcode.toUpperCase());

          const irepsValues = {
            meterPhase: foundInAsts
              ? firstMeaningfulValue(
                  regDoc?.meterPhase,
                  astDoc?.ast?.astData?.meter?.phase,
                  astDoc?.astData?.meter?.phase,
                  astDoc?.meterPhase
                )
              : "NAv",
            meterType: foundInAsts
              ? firstMeaningfulValue(
                  regDoc?.meterType,
                  astDoc?.meterType,
                  astDoc?.accessData?.meterType,
                  astDoc?.ast?.astData?.astType,
                  astDoc?.astData?.astType
                )
              : "NAv",
            linkedAccountNo: foundInAsts
              ? firstMeaningfulValue(
                  astDoc?.accessData?.accountNo,
                  astDoc?.accessData?.linkedAccountNo,
                  astDoc?.linkedAccountNo,
                  astDoc?.accountNo,
                  regDoc?.accountNo,
                  regDoc?.linkedAccountNo,
                  premiseDoc?.accountNo,
                  salesDoc?.accountNumber,
                  salesDoc?.AccountNumber
                )
              : "NAv",
            premiseAddress: foundInAsts
              ? firstMeaningfulValue(
                  regDoc?.premiseAddress,
                  astDoc?.accessData?.premise?.address,
                  astDoc?.premiseAddress,
                  premiseDoc?.addressText,
                  premiseDoc?.addressLine,
                  buildPremiseAddressText(premiseDoc?.address),
                  [
                    salesDoc?.addressLine1 || salesDoc?.AddressLine1,
                    salesDoc?.addressLine2 || salesDoc?.AddressLine2,
                  ]
                    .map((s) => String(s || "").trim())
                    .filter(Boolean)
                    .join(" ")
                )
              : "NAv",
            premisePropertyType: foundInAsts
              ? firstMeaningfulValue(
                  regDoc?.premisePropertyType,
                  astDoc?.accessData?.premise?.propertyType?.type,
                  typeof astDoc?.accessData?.premise?.propertyType === "string"
                    ? astDoc?.accessData?.premise?.propertyType
                    : "",
                  premiseDoc?.propertyType?.type
                )
              : "NAv",
            wardNo: foundInAsts
              ? firstMeaningfulValue(
                  premiseDoc?.wardNo,
                  extractWardNoFromPcode(
                    regDoc?.parents?.wardPcode ||
                      astDoc?.accessData?.parents?.wardPcode ||
                      premiseDoc?.wardPcode ||
                      salesDoc?.erfCandidates?.[0]?.WardPcode ||
                      salesDoc?.ErfCandidates?.[0]?.WardPcode
                  )
                )
              : "NAv",
            geofence: foundInAsts
              ? firstMeaningfulValue(
                  extractGeofenceNames(astDoc?.geofenceRefs || regDoc?.geofenceRefs),
                  regDoc?.geofence
                )
              : "NAv",
            meterStatus: foundInAsts ? firstMeaningfulValue(astStatus) : "NAv",
            erfNo: foundInAsts
              ? firstMeaningfulValue(
                  regDoc?.erfNo,
                  astDoc?.accessData?.erfNo,
                  astDoc?.erfNo,
                  premiseDoc?.erfNo,
                  salesDoc?.erfNo,
                  salesDoc?.erfNumbers?.[0],
                  salesDoc?.ErfNumbers?.[0]
                )
              : "NAv",
          };

          const comparisons = {};
          COMPARABLE_FIELD_KEYS.forEach((fieldKey) => {
            comparisons[fieldKey] = buildFieldComparison(
              row[fieldKey],
              irepsValues[fieldKey],
              foundInAsts
            );
          });

          const isDataMatch = Boolean(
            foundInAsts &&
              COMPARABLE_FIELD_KEYS.every(
                (fieldKey) => comparisons[fieldKey]?.isMatch === true
              )
          );

          const resolvedAddress = firstMeaningfulValue(
            row.premiseAddress,
            irepsValues.premiseAddress
          );
          const resolvedErfVal = firstMeaningfulValue(row.erfNo, irepsValues.erfNo);
          const resolvedErf = resolvedErfVal === "NAv" ? "" : resolvedErfVal;

          const isDuplicate = Boolean(row.isDuplicate);
          const isEligible = Boolean(foundInAsts && isLmMatch && !isDuplicate);

          return {
            ...row,
            foundInAsts,
            isLmMatch,
            isDuplicate,
            isEligible,
            isDataMatch,
            duplicate: isDuplicate ? "True" : "False",
            eligible: isEligible ? "True" : "False",
            dataMatch: isDataMatch ? "True" : "False",
            irepsValues,
            comparisons,
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

    const fileExt = (file.name || "").split(".").pop().toLowerCase();
    if (fileExt === "csv") {
      reader.readAsText(file);
    } else {
      reader.readAsArrayBuffer(file);
    }
  };

  const handleReset = () => {
    setSelectedFile(null);
    setParsedRows([]);
    setSelectedRowKeys(new Set());
    setShownRows(null);
    setCarriedBatchRows([]);
    setCreatedBatchesResult([]);
    setBatchCreateError("");
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

  // Filtered rows based on interactive stat filter pills (Total Meters, Found in ASTS, Not Found, LM Matches, Selected Rows)
  const filteredRows = useMemo(() => {
    return parsedRows.filter((row) => {
      if (statFilter === "FOUND" && !row.foundInAsts) return false;
      if (statFilter === "NOT_FOUND" && row.foundInAsts) return false;
      if (statFilter === "LM_MATCH" && (!row.foundInAsts || !row.isLmMatch)) return false;
      if (statFilter === "SELECTED" && !selectedRowKeys.has(getRowSelectionKey(row))) return false;

      if (foundFilter === "FOUND" && !row.foundInAsts) return false;
      if (foundFilter === "NOT_FOUND" && row.foundInAsts) return false;

      if (lmFilter === "MATCH" && (!row.foundInAsts || !row.isLmMatch)) return false;
      if (lmFilter === "MISMATCH" && (!row.foundInAsts || row.isLmMatch)) return false;

      return true;
    });
  }, [parsedRows, statFilter, selectedRowKeys, foundFilter, lmFilter]);

  const currentFilteredRows = shownRows ?? filteredRows;

  const allFilteredSelected = useMemo(() => {
    if (currentFilteredRows.length === 0) return false;
    return currentFilteredRows.every((r) =>
      selectedRowKeys.has(getRowSelectionKey(r))
    );
  }, [currentFilteredRows, selectedRowKeys]);

  const someFilteredSelected = useMemo(() => {
    if (currentFilteredRows.length === 0 || allFilteredSelected) return false;
    return currentFilteredRows.some((r) =>
      selectedRowKeys.has(getRowSelectionKey(r))
    );
  }, [currentFilteredRows, selectedRowKeys, allFilteredSelected]);

  const handleToggleMasterSelect = useCallback(() => {
    if (currentFilteredRows.length === 0) return;
    setSelectedRowKeys((prev) => {
      const next = new Set(prev);
      const everySelected = currentFilteredRows.every((r) =>
        next.has(getRowSelectionKey(r))
      );
      if (everySelected) {
        currentFilteredRows.forEach((r) => next.delete(getRowSelectionKey(r)));
      } else {
        currentFilteredRows.forEach((r) => next.add(getRowSelectionKey(r)));
      }
      return next;
    });
  }, [currentFilteredRows]);

  const handleToggleRowSelect = useCallback((row) => {
    const key = getRowSelectionKey(row);
    if (!key) return;
    setSelectedRowKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const selectedRows = useMemo(() => {
    return parsedRows.filter((r) => selectedRowKeys.has(getRowSelectionKey(r)));
  }, [parsedRows, selectedRowKeys]);

  const ineligibleSelectedRows = useMemo(() => {
    return selectedRows.filter((r) => !r.isEligible);
  }, [selectedRows]);

  // Option 2 Strict Gate: Carry to Batch Stage is enabled ONLY when >= 1 rows are selected AND 0 ineligible rows are selected
  const canCarryToBatch =
    selectedRows.length > 0 && ineligibleSelectedRows.length === 0;

  const handleDownloadSelectedCsv = () => {
    if (selectedRows.length === 0) return;

    const headers = [
      "rowNo",
      "meterNo",
      "Found?",
      "duplicate",
      "eligible",
      "dataMatch",
      "meterPhase",
      "iREPS_meterPhase",
      "meterType",
      "iREPS_meterType",
      "linkedAccountNo",
      "iREPS_linkedAccountNo",
      "premiseAddress",
      "iREPS_premiseAddress",
      "premisePropertyType",
      "iREPS_premisePropertyType",
      "actionReason",
      "wardNo",
      "iREPS_wardNo",
      "geofence",
      "iREPS_geofence",
      "meterStatus",
      "iREPS_meterStatus",
      "erfNo",
      "iREPS_erfNo",
    ];

    const csvRows = selectedRows.map((r) => [
      r.rowNo,
      r.meterNo,
      r.foundInAsts ? "True" : "False",
      r.isDuplicate ? "True" : "False",
      r.isEligible ? "True" : "False",
      r.isDataMatch ? "True" : "False",
      r.meterPhase,
      r.irepsValues?.meterPhase || "NAv",
      r.meterType,
      r.irepsValues?.meterType || "NAv",
      r.linkedAccountNo,
      r.irepsValues?.linkedAccountNo || "NAv",
      r.premiseAddress,
      r.irepsValues?.premiseAddress || "NAv",
      r.premisePropertyType,
      r.irepsValues?.premisePropertyType || "NAv",
      r.actionReason,
      r.wardNo,
      r.irepsValues?.wardNo || "NAv",
      r.geofence,
      r.irepsValues?.geofence || "NAv",
      r.meterStatus,
      r.irepsValues?.meterStatus || "NAv",
      r.erfNo,
      r.irepsValues?.erfNo || "NAv",
    ]);

    const csvContent = [headers, ...csvRows]
      .map((row) =>
        row.map((val) => `"${String(val ?? "").replace(/"/g, '""')}"`).join(",")
      )
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `SELECTED_ROWS_${selectedFile?.name || "upload.csv"}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleCarryToBatchStage = () => {
    if (!canCarryToBatch) return;
    setCarriedBatchRows(selectedRows);
    setSelectedTrnType(inferTrnTypeFromRows(selectedRows));
    setCreatedBatchesResult([]);
    setBatchCreateError("");
    setCreationModalState(null);
    setViewMode("DRAFT");
  };

  const handleRemoveRowFromDraft = useCallback((rowToRemove) => {
    const keyToRemove = getRowSelectionKey(rowToRemove);
    setCarriedBatchRows((prev) => {
      const next = prev.filter((r) => getRowSelectionKey(r) !== keyToRemove);
      if (next.length === 0) {
        setViewMode("INSPECTION");
      }
      return next;
    });
    setSelectedRowKeys((prev) => {
      const next = new Set(prev);
      next.delete(keyToRemove);
      return next;
    });
  }, []);

  // Group carriedBatchRows by resolved Ward (1 batch per Ward)
  const wardBatchGroups = useMemo(() => {
    if (carriedBatchRows.length === 0) return [];
    const map = new Map();

    carriedBatchRows.forEach((row) => {
      const wardInfo = resolveRowWardInfo(row, lmPcode);
      const groupKey = wardInfo.wardPcode !== "NAv" ? wardInfo.wardPcode : `WARD_${wardInfo.wardNo}`;
      if (!map.has(groupKey)) {
        map.set(groupKey, {
          wardKey: groupKey,
          wardPcode: wardInfo.wardPcode,
          wardNo: wardInfo.wardNo,
          wardLabel: wardInfo.wardLabel,
          rows: [],
        });
      }
      map.get(groupKey).rows.push(row);
    });

    return Array.from(map.values()).sort((a, b) =>
      String(a.wardPcode).localeCompare(String(b.wardPcode), undefined, { numeric: true })
    );
  }, [carriedBatchRows, lmPcode]);

  const draftBatchColumns = useMemo(() => {
    return [
      {
        key: "draftRowNo",
        label: "rowNo",
        width: 70,
        sortable: true,
        filter: null,
        value: (r, idx) => String(r._draftRowNo || idx + 1),
        sortValue: (r, idx) => Number(r._draftRowNo || idx + 1),
        render: (r, idx) => <strong>{r._draftRowNo || idx + 1}</strong>,
      },
      {
        key: "meterNo",
        label: "meterNo",
        width: 140,
        sortable: true,
        filter: "text",
        value: (r) => String(r.meterNo || ""),
        sortValue: (r) => String(r.meterNo || ""),
        render: (r) => <span style={styles.meterNoCell}>{r.meterNo}</span>,
      },
      {
        key: "meterType",
        label: "meterType",
        width: 130,
        sortable: true,
        filter: "select",
        value: (r) => String(r.irepsValues?.meterType || r.meterType || "NAv"),
        sortValue: (r) => String(r.irepsValues?.meterType || r.meterType || ""),
      },
      {
        key: "meterPhase",
        label: "meterPhase",
        width: 120,
        sortable: true,
        filter: "select",
        value: (r) => String(r.irepsValues?.meterPhase || r.meterPhase || "NAv"),
        sortValue: (r) => String(r.irepsValues?.meterPhase || r.meterPhase || ""),
      },
      {
        key: "linkedAccountNo",
        label: "linkedAccountNo",
        width: 150,
        sortable: true,
        filter: "text",
        value: (r) => String(r.irepsValues?.linkedAccountNo || r.linkedAccountNo || "NAv"),
        sortValue: (r) => String(r.irepsValues?.linkedAccountNo || r.linkedAccountNo || ""),
      },
      {
        key: "premiseAddress",
        label: "premiseAddress",
        width: 240,
        sortable: true,
        filter: "text",
        value: (r) => String(r.resolvedAddress || r.irepsValues?.premiseAddress || r.premiseAddress || "NAv"),
        sortValue: (r) => String(r.resolvedAddress || r.irepsValues?.premiseAddress || r.premiseAddress || ""),
      },
      {
        key: "erfNo",
        label: "erfNo",
        width: 100,
        sortable: true,
        filter: "text",
        value: (r) => String(r.resolvedErf || r.irepsValues?.erfNo || r.erfNo || "NAv"),
        sortValue: (r) => String(r.resolvedErf || r.irepsValues?.erfNo || r.erfNo || ""),
      },
      {
        key: "geofence",
        label: "geofence",
        width: 160,
        sortable: true,
        filter: "text",
        value: (r) => String(r.irepsValues?.geofence || r.geofence || "NAv"),
        sortValue: (r) => String(r.irepsValues?.geofence || r.geofence || ""),
      },
      {
        key: "meterStatus",
        label: "meterStatus",
        width: 130,
        sortable: true,
        filter: "select",
        value: (r) => String(r.irepsValues?.meterStatus || r.meterStatus || "NAv"),
        sortValue: (r) => String(r.irepsValues?.meterStatus || r.meterStatus || ""),
      },
      {
        key: "actionReason",
        label: "actionReason",
        width: 200,
        sortable: true,
        filter: "text",
        value: (r) => String(r.actionReason || "NAv"),
        sortValue: (r) => String(r.actionReason || ""),
      },
      {
        key: "remove",
        label: "Action",
        width: 90,
        sortable: false,
        filter: null,
        export: false,
        render: (r) => (
          <button
            type="button"
            onClick={() => handleRemoveRowFromDraft(r)}
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              border: "1px solid #fecaca",
              background: "#fef2f2",
              color: "#b91c1c",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
            title="Remove this TRN row from the draft batch"
          >
            Remove
          </button>
        ),
      },
    ];
  }, [handleRemoveRowFromDraft]);

  const handleCreateWardBatches = async () => {
    if (wardBatchGroups.length === 0 || isCreatingBatches) return;
    setIsCreatingBatches(true);
    setBatchCreateError("");
    setCreatedBatchesResult([]);
    setCreationModalState(null);
    setAllocationMode("UNALLOCATED");
    setSelectedTeamId("");
    setSelectedSpId("");
    setAllocationError("");

    try {
      const effectiveLmPcode =
        lmPcode ||
        carriedBatchRows.find((r) => r.astLmPcode && r.astLmPcode !== "NAv")?.astLmPcode ||
        "ZA5241";

      const batchesPayload = wardBatchGroups.map((group) => ({
        wardPcode: group.wardPcode,
        wardLabel: group.wardLabel,
        rows: group.rows.map((r, index) => ({
          rowNo: String(index + 1),
          meterNo: String(r.meterNo || ""),
          meterPhase: String(r.meterPhase || r.irepsValues?.meterPhase || ""),
          meterType: String(r.meterType || r.irepsValues?.meterType || ""),
          linkedAccountNo: String(r.linkedAccountNo || r.irepsValues?.linkedAccountNo || ""),
          premiseAddress: String(r.premiseAddress || r.irepsValues?.premiseAddress || ""),
          premisePropertyType: String(
            r.premisePropertyType || r.irepsValues?.premisePropertyType || ""
          ),
          actionReason: String(r.actionReason || ""),
          wardNo: String(group.wardNo !== "NAv" ? group.wardNo : r.wardNo || ""),
          geofence: String(r.geofence || r.irepsValues?.geofence || ""),
          meterStatus: String(r.meterStatus || r.irepsValues?.meterStatus || ""),
          erfNo: String(r.erfNo || r.irepsValues?.erfNo || ""),
        })),
      }));

      const response = await createTrnBgoWardBatches({
        fileName: selectedFile?.name || "TRN_BGO_UPLOAD.csv",
        trnType: selectedTrnType,
        lmPcode: effectiveLmPcode,
        notes: batchNotes,
        batches: batchesPayload,
      }).unwrap();

      if (!response?.success) {
        setCreationModalState({
          status: "FAIL",
          title: "Batch Creation Failed — Zero Batches Created",
          message:
            response?.message ||
            "All-or-Nothing Gate: Validation failed. No batches were created.",
          errors: Array.isArray(response?.errors) ? response.errors : [],
          batches: [],
          totalMeters: 0,
        });
        return;
      }

      const createdBatches = Array.isArray(response.batches) ? response.batches : [];
      setCreatedBatchesResult(createdBatches);
      setCreationModalState({
        status: "PASS",
        title: `Successfully Created ${createdBatches.length} Ward ${createdBatches.length === 1 ? "Batch" : "Batches"}`,
        message:
          response.message ||
          `All ${createdBatches.length} ward batch(es) (${response.totalMeters || carriedBatchRows.length} TRNs) were created atomically.`,
        errors: [],
        batches: createdBatches,
        totalMeters: response.totalMeters || carriedBatchRows.length,
      });
    } catch (err) {
      const errMsg =
        err?.message ||
        err?.data?.message ||
        "All-or-Nothing Gate: Failed to create ward batches. Zero batches were created.";
      setBatchCreateError(errMsg);
      setCreationModalState({
        status: "FAIL",
        title: "Batch Creation Failed — Zero Batches Created",
        message: errMsg,
        errors: Array.isArray(err?.details?.errors) ? err.details.errors : [errMsg],
        batches: [],
        totalMeters: 0,
      });
    } finally {
      setIsCreatingBatches(false);
    }
  };

  const handleConfirmPassModalAndNavigate = async () => {
    if (!creationModalState || creationModalState.status !== "PASS") return;
    const batchIds = (creationModalState.batches || []).map((b) => b.tcId).filter(Boolean);

    if (allocationMode === "UNALLOCATED") {
      navigate("/operations/trn-bgo");
      return;
    }

    const targetType = allocationMode; // "TEAM" or "SP"
    const targetList = targetType === "TEAM" ? availableTeams : availableServiceProviders;
    const chosenId = targetType === "TEAM" ? selectedTeamId : selectedSpId;
    const chosenTarget = targetList.find((item) => item.id === chosenId);

    if (!chosenId || !chosenTarget) {
      setAllocationError(
        `Please select an active ${targetType === "TEAM" ? "Operational Team" : "Service Provider"} or choose "Leave Unallocated".`
      );
      return;
    }

    setIsAllocating(true);
    setAllocationError("");
    try {
      await allocateTrnBgoWardBatches({
        batchIds,
        targetType,
        targetId: chosenTarget.id,
        targetName: chosenTarget.name || chosenTarget.label || chosenTarget.id,
      }).unwrap();

      navigate("/operations/trn-bgo");
    } catch (err) {
      setAllocationError(
        err?.message || err?.data?.message || "Failed to allocate batches. Please try again."
      );
    } finally {
      setIsAllocating(false);
    }
  };

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

  // Download Official Sample CSV populated with verified Endumeni (ZA5241) meters
  const handleDownloadSampleCsv = () => {
    const rows = [
      OFFICIAL_HEADERS.join(","),
      "1,04298074776,Single Phase,electricity,0001106531,,Residential,Credit control disconnection,3,,CONNECTED,654",
      "2,04298082191,Single Phase,electricity,0001108730,,Residential,Credit control disconnection,3,,CONNECTED,956",
      "3,04298084684,Single Phase,electricity,0001114692,,Residential,Credit control disconnection,3,,CONNECTED,1561",
      "4,04297706063,Single Phase,electricity,0002011113,,Residential,Credit control disconnection,6,,CONNECTED,4230",
      "5,04297706121,Single Phase,electricity,0002010425,,Residential,Credit control disconnection,6,,CONNECTED,4241",
      "6,04297749576,Single Phase,electricity,0002139600,,Residential,Credit control disconnection,6,,CONNECTED,2631",
      "7,04297756324,Single Phase,electricity,0002139598,,Residential,Credit control disconnection,6,,CONNECTED,2631",
      "8,04297758833,Single Phase,electricity,0002011635,,Residential,Credit control disconnection,6,,CONNECTED,2631",
    ];
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "TC_TEST_METERS_DISCONNECTION.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Build IrepsTable columns with Column 1 Checkbox Selection + 16 inspection columns
  const columns = useMemo(() => {
    return [
      {
        key: "_select",
        export: false,
        label: (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            <MasterCheckbox
              checked={allFilteredSelected}
              indeterminate={someFilteredSelected}
              disabled={currentFilteredRows.length === 0}
              onChange={handleToggleMasterSelect}
              title={
                allFilteredSelected
                  ? `Deselect all ${currentFilteredRows.length} filtered row(s)`
                  : `Select all ${currentFilteredRows.length} filtered row(s)`
              }
            />
          </div>
        ),
        width: 54,
        align: "center",
        filter: null,
        sortable: false,
        renderFilter: () =>
          selectedRowKeys.size > 0 ? (
            <div
              style={{
                fontSize: 11,
                fontWeight: 800,
                color: "#1d4ed8",
                textAlign: "center",
                background: "#dbeafe",
                borderRadius: 4,
                padding: "2px 4px",
              }}
              title={`${selectedRowKeys.size} row(s) currently selected`}
            >
              {selectedRowKeys.size} sel
            </div>
          ) : null,
        value: (r) =>
          selectedRowKeys.has(getRowSelectionKey(r)) ? "Selected" : "",
        render: (r) => {
          const isSelected = selectedRowKeys.has(getRowSelectionKey(r));
          return (
            <div
              style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => handleToggleRowSelect(r)}
                aria-label={`Select row ${r.rowNo || r._rowNo}`}
                style={{
                  width: 16,
                  height: 16,
                  cursor: "pointer",
                  accentColor: "#2563eb",
                }}
              />
            </div>
          );
        },
      },
      {
        key: "_rowNo",
        label: "rowNo",
        width: 75,
        filter: null,
        sortable: true,
        value: (r) => String(r.rowNo || r._rowNo),
        sortValue: (r) => Number(r.rowNo || r._rowNo),
        render: (r) => <strong>{r.rowNo || r._rowNo}</strong>,
      },
      {
        key: "meterNo",
        label: "meterNo",
        width: 140,
        filter: "text",
        sortable: true,
        value: (r) => String(r.meterNo || ""),
        sortValue: (r) => String(r.meterNo || ""),
        render: (r) => <span style={styles.meterNoCell}>{r.meterNo}</span>,
      },
      {
        key: "foundInAsts",
        label: "Found?",
        width: 100,
        filter: "select",
        sortable: true,
        value: (r) => (r.foundInAsts ? "True" : "False"),
        sortValue: (r) => (r.foundInAsts ? 1 : 0),
        render: (r) => (
          <span
            style={{
              fontFamily: "monospace",
              fontWeight: 700,
              fontSize: 12,
              color: r.foundInAsts ? "#047857" : "#dc2626",
            }}
          >
            {r.foundInAsts ? "True" : "False"}
          </span>
        ),
      },
      {
        key: "duplicate",
        label: "duplicate",
        width: 110,
        filter: "select",
        sortable: true,
        value: (r) => (r.isDuplicate ? "True" : "False"),
        sortValue: (r) => (r.isDuplicate ? 1 : 0),
        render: (r) => (
          <span
            style={{
              fontFamily: "monospace",
              fontWeight: 700,
              fontSize: 12,
              color: r.isDuplicate ? "#b45309" : "#64748b",
            }}
          >
            {r.isDuplicate ? "True" : "False"}
          </span>
        ),
      },
      {
        key: "eligible",
        label: "eligible",
        width: 110,
        filter: "select",
        sortable: true,
        value: (r) => (r.isEligible ? "True" : "False"),
        sortValue: (r) => (r.isEligible ? 1 : 0),
        render: (r) => (
          <span
            style={{
              fontFamily: "monospace",
              fontWeight: 700,
              fontSize: 12,
              color: r.isEligible ? "#047857" : "#dc2626",
            }}
          >
            {r.isEligible ? "True" : "False"}
          </span>
        ),
      },
      {
        key: "dataMatch",
        label: "dataMatch",
        width: 115,
        filter: "select",
        sortable: true,
        value: (r) => (r.isDataMatch ? "True" : "False"),
        sortValue: (r) => (r.isDataMatch ? 1 : 0),
        render: (r) => (
          <span
            style={{
              fontFamily: "monospace",
              fontWeight: 700,
              fontSize: 12,
              color: r.isDataMatch ? "#047857" : "#dc2626",
            }}
          >
            {r.isDataMatch ? "True" : "False"}
          </span>
        ),
      },
      {
        key: "meterPhase",
        label: "meterPhase",
        width: 185,
        filter: "text",
        sortable: true,
        value: (r) =>
          `File: ${r.comparisons?.meterPhase?.fileDisplay || "Blank"} | iREPS: ${r.comparisons?.meterPhase?.irepsDisplay || "NAv"}`,
        sortValue: (r) =>
          `${r.comparisons?.meterPhase?.fileDisplay || ""}|${r.comparisons?.meterPhase?.irepsDisplay || ""}`,
        render: (r) =>
          renderStackedComparisonCell(r.comparisons?.meterPhase, r.foundInAsts),
      },
      {
        key: "meterType",
        label: "meterType",
        width: 170,
        filter: "text",
        sortable: true,
        value: (r) =>
          `File: ${r.comparisons?.meterType?.fileDisplay || "Blank"} | iREPS: ${r.comparisons?.meterType?.irepsDisplay || "NAv"}`,
        sortValue: (r) =>
          `${r.comparisons?.meterType?.fileDisplay || ""}|${r.comparisons?.meterType?.irepsDisplay || ""}`,
        render: (r) =>
          renderStackedComparisonCell(r.comparisons?.meterType, r.foundInAsts),
      },
      {
        key: "linkedAccountNo",
        label: "linkedAccountNo",
        width: 185,
        filter: "text",
        sortable: true,
        value: (r) =>
          `File: ${r.comparisons?.linkedAccountNo?.fileDisplay || "Blank"} | iREPS: ${r.comparisons?.linkedAccountNo?.irepsDisplay || "NAv"}`,
        sortValue: (r) =>
          `${r.comparisons?.linkedAccountNo?.fileDisplay || ""}|${r.comparisons?.linkedAccountNo?.irepsDisplay || ""}`,
        render: (r) =>
          renderStackedComparisonCell(
            r.comparisons?.linkedAccountNo,
            r.foundInAsts
          ),
      },
      {
        key: "premiseAddress",
        label: "premiseAddress",
        width: 240,
        filter: "text",
        sortable: true,
        value: (r) =>
          `File: ${r.comparisons?.premiseAddress?.fileDisplay || "Blank"} | iREPS: ${r.comparisons?.premiseAddress?.irepsDisplay || "NAv"}`,
        sortValue: (r) =>
          `${r.comparisons?.premiseAddress?.fileDisplay || ""}|${r.comparisons?.premiseAddress?.irepsDisplay || ""}`,
        render: (r) =>
          renderStackedComparisonCell(
            r.comparisons?.premiseAddress,
            r.foundInAsts
          ),
      },
      {
        key: "premisePropertyType",
        label: "premisePropertyType",
        width: 185,
        filter: "text",
        sortable: true,
        value: (r) =>
          `File: ${r.comparisons?.premisePropertyType?.fileDisplay || "Blank"} | iREPS: ${r.comparisons?.premisePropertyType?.irepsDisplay || "NAv"}`,
        sortValue: (r) =>
          `${r.comparisons?.premisePropertyType?.fileDisplay || ""}|${r.comparisons?.premisePropertyType?.irepsDisplay || ""}`,
        render: (r) =>
          renderStackedComparisonCell(
            r.comparisons?.premisePropertyType,
            r.foundInAsts
          ),
      },
      {
        key: "actionReason",
        label: "actionReason",
        width: 190,
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
      {
        key: "wardNo",
        label: "wardNo",
        width: 145,
        filter: "text",
        sortable: true,
        value: (r) =>
          `File: ${r.comparisons?.wardNo?.fileDisplay || "Blank"} | iREPS: ${r.comparisons?.wardNo?.irepsDisplay || "NAv"}`,
        sortValue: (r) =>
          `${r.comparisons?.wardNo?.fileDisplay || ""}|${r.comparisons?.wardNo?.irepsDisplay || ""}`,
        render: (r) =>
          renderStackedComparisonCell(r.comparisons?.wardNo, r.foundInAsts),
      },
      {
        key: "geofence",
        label: "geofence",
        width: 185,
        filter: "text",
        sortable: true,
        value: (r) =>
          `File: ${r.comparisons?.geofence?.fileDisplay || "Blank"} | iREPS: ${r.comparisons?.geofence?.irepsDisplay || "NAv"}`,
        sortValue: (r) =>
          `${r.comparisons?.geofence?.fileDisplay || ""}|${r.comparisons?.geofence?.irepsDisplay || ""}`,
        render: (r) =>
          renderStackedComparisonCell(r.comparisons?.geofence, r.foundInAsts),
      },
      {
        key: "meterStatus",
        label: "meterStatus",
        width: 175,
        filter: "text",
        sortable: true,
        value: (r) =>
          `File: ${r.comparisons?.meterStatus?.fileDisplay || "Blank"} | iREPS: ${r.comparisons?.meterStatus?.irepsDisplay || "NAv"}`,
        sortValue: (r) =>
          `${r.comparisons?.meterStatus?.fileDisplay || ""}|${r.comparisons?.meterStatus?.irepsDisplay || ""}`,
        render: (r) =>
          renderStackedComparisonCell(
            r.comparisons?.meterStatus,
            r.foundInAsts
          ),
      },
      {
        key: "erfNo",
        label: "erfNo",
        width: 150,
        filter: "text",
        sortable: true,
        value: (r) =>
          `File: ${r.comparisons?.erfNo?.fileDisplay || "Blank"} | iREPS: ${r.comparisons?.erfNo?.irepsDisplay || "NAv"}`,
        sortValue: (r) =>
          `${r.comparisons?.erfNo?.fileDisplay || ""}|${r.comparisons?.erfNo?.irepsDisplay || ""}`,
        render: (r) =>
          renderStackedComparisonCell(r.comparisons?.erfNo, r.foundInAsts),
      },
    ];
  }, [
    allFilteredSelected,
    someFilteredSelected,
    currentFilteredRows.length,
    handleToggleMasterSelect,
    handleToggleRowSelect,
    selectedRowKeys,
  ]);

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

      {/* PAGE 1: Validated Rows Inspection Table View */}
      {parsedRows.length > 0 && viewMode === "INSPECTION" ? (
        <div style={styles.previewSection}>
          {/* File Meta & Action Bar */}
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

            <div style={{ marginLeft: "auto", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
              <button
                type="button"
                disabled={!canCarryToBatch}
                onClick={handleCarryToBatchStage}
                style={{
                  padding: "9px 16px",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 700,
                  background: canCarryToBatch ? "#16a34a" : "#e2e8f0",
                  color: canCarryToBatch ? "#ffffff" : "#64748b",
                  border: `1px solid ${canCarryToBatch ? "#15803d" : "#cbd5e1"}`,
                  cursor: canCarryToBatch ? "pointer" : "not-allowed",
                }}
                title={
                  ineligibleSelectedRows.length > 0
                    ? `Cannot carry to Batch Stage: ${ineligibleSelectedRows.length} selected row(s) have eligible = False. Filter eligible = True first.`
                    : selectedRows.length === 0
                      ? "Tick 1 or more eligible = True rows in Column 1 to carry through to the Batch Draft Page"
                      : `Open Batch Draft Page with ${selectedRows.length} eligible row(s)`
                }
              >
                Carry Selected to Batch Stage ({selectedRows.length}) →
              </button>

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

          {/* Option 2 Gate Prompt when any eligible = False row is selected */}
          {ineligibleSelectedRows.length > 0 ? (
            <div
              role="alert"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "10px 16px",
                borderRadius: 10,
                background: "#fffbeb",
                border: "1px solid #fcd34d",
                color: "#92400e",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <span>
                Batch Stage Gate: <strong>{ineligibleSelectedRows.length}</strong> of your{" "}
                <strong>{selectedRows.length}</strong> selected row(s) have{" "}
                <code>eligible = False</code>. Filter{" "}
                <code>eligible = True</code> and re-select using the Master Checkbox to carry rows to the Batch Draft Page.
              </span>
            </div>
          ) : null}

          {/* IrepsTable displaying validated rows */}
          <div style={styles.tablePanel}>
            <IrepsTable
              rows={filteredRows}
              columns={columns}
              onRowsShown={setShownRows}
              extraFiltersActive={
                statFilter !== "ALL" ||
                foundFilter !== "ALL" ||
                lmFilter !== "ALL" ||
                selectedRowKeys.size > 0
              }
              onClearFilters={() => {
                setStatFilter("ALL");
                setFoundFilter("ALL");
                setLmFilter("ALL");
                setSelectedRowKeys(new Set());
              }}
              downloads={{
                registryName: selectedFile?.name || "TRN BGO Upload Inspection",
                fileBaseName: (selectedFile?.name || "trn_bgo_upload").replace(/\.[^/.]+$/, ""),
                scope: { lmName, lmPcode },
                visibleRows: selectedRows.length > 0 ? selectedRows : currentFilteredRows,
                rowsLabel: selectedRows.length > 0 ? "selected rows" : "rows",
              }}
              rowStyle={(r) =>
                selectedRowKeys.has(getRowSelectionKey(r))
                  ? { background: "#eff6ff" }
                  : null
              }
              rowKey={(r, idx) => r?.meterNo || r?.rowNo || r?._rowNo || idx}
              title={
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 10,
                  }}
                >
                  {[
                    {
                      key: "ALL",
                      label: "Total Meters",
                      count: summary.total,
                      color: "#0f172a",
                      activeBg: "#f1f5f9",
                      activeBorder: "#64748b",
                    },
                    {
                      key: "FOUND",
                      label: "Found in ASTS",
                      count: summary.found,
                      color: "#16a34a",
                      activeBg: "#f0fdf4",
                      activeBorder: "#16a34a",
                    },
                    {
                      key: "NOT_FOUND",
                      label: "Not Found",
                      count: summary.notFound,
                      color: summary.notFound > 0 ? "#dc2626" : "#64748b",
                      activeBg: "#fef2f2",
                      activeBorder: "#dc2626",
                    },
                    {
                      key: "LM_MATCH",
                      label: "LM Matches",
                      count: summary.lmMatches,
                      color: "#2563eb",
                      activeBg: "#eff6ff",
                      activeBorder: "#2563eb",
                    },
                    {
                      key: "SELECTED",
                      label: "Selected Rows",
                      count: selectedRows.length,
                      color: selectedRows.length > 0 ? "#1d4ed8" : "#64748b",
                      activeBg: "#dbeafe",
                      activeBorder: "#1d4ed8",
                    },
                  ].map((stat) => {
                    const isActive = statFilter === stat.key;
                    return (
                      <button
                        key={stat.key}
                        type="button"
                        onClick={() =>
                          setStatFilter((prev) =>
                            prev === stat.key && stat.key !== "ALL" ? "ALL" : stat.key
                          )
                        }
                        title={
                          stat.key === "ALL"
                            ? "Show all uploaded rows"
                            : `Filter table by ${stat.label} (${stat.count})`
                        }
                        style={{
                          display: "inline-flex",
                          flexDirection: "column",
                          alignItems: "flex-start",
                          gap: 2,
                          padding: "6px 12px",
                          borderRadius: 8,
                          border: isActive
                            ? `2px solid ${stat.activeBorder}`
                            : "1px solid #e2e8f0",
                          background: isActive ? stat.activeBg : "#ffffff",
                          cursor: "pointer",
                          textAlign: "left",
                          boxShadow: isActive
                            ? "0 1px 3px rgba(15, 23, 42, 0.08)"
                            : "none",
                        }}
                      >
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: "#64748b",
                            textTransform: "uppercase",
                            letterSpacing: "0.04em",
                          }}
                        >
                          {stat.label}
                        </span>
                        <strong
                          style={{
                            fontSize: 14,
                            fontWeight: 800,
                            color: stat.color,
                            lineHeight: 1.1,
                          }}
                        >
                          {formatNumber(stat.count)}
                        </strong>
                      </button>
                    );
                  })}
                </div>
              }
              pageSizeOptions={[10, 25, 50, 100]}
              defaultPageSize={25}
              emptyText="No rows match the selected filters."
            />
          </div>
        </div>
      ) : null}

      {/* PAGE 2: Dedicated Batch Draft Page (Separated Ward Batches on One Page) */}
      {parsedRows.length > 0 && viewMode === "DRAFT" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Top Draft Control Bar */}
          <div
            style={{
              background: "#ffffff",
              borderRadius: 12,
              border: "2px solid #2563eb",
              padding: "20px 24px",
              display: "flex",
              flexDirection: "column",
              gap: 16,
              boxShadow: "0 4px 12px rgba(37, 99, 235, 0.08)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 14,
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                  <span
                    style={{
                      padding: "4px 10px",
                      borderRadius: 9999,
                      background: "#dbeafe",
                      color: "#1d4ed8",
                      fontSize: 11,
                      fontWeight: 800,
                      textTransform: "uppercase",
                    }}
                  >
                    Step 3 · Batch Draft Page
                  </span>
                  <h3 style={{ margin: 0, fontSize: 19, fontWeight: 900, color: "#0f172a" }}>
                    Verify Separated Ward Batches ({wardBatchGroups.length}{" "}
                    {wardBatchGroups.length === 1 ? "Batch" : "Batches"} ·{" "}
                    {carriedBatchRows.length} TRNs)
                  </h3>
                </div>
                <p style={{ margin: 0, fontSize: 13, color: "#475569" }}>
                  A batch can only belong to 1 ward. Your {carriedBatchRows.length} selected TRNs have been separated into{" "}
                  <strong>
                    {wardBatchGroups.length} Ward{" "}
                    {wardBatchGroups.length === 1 ? "Batch" : "Batches"}
                  </strong>{" "}
                  below. Verify each batch's TRN list and click{" "}
                  <strong>Create Batch(es)</strong>. Creation is{" "}
                  <strong>All-or-Nothing</strong> (creates all batches or fails all).
                </p>
              </div>

              <button
                type="button"
                disabled={isCreatingBatches}
                onClick={() => setViewMode("INSPECTION")}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  background: "#f8fafc",
                  color: "#334155",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: isCreatingBatches ? "not-allowed" : "pointer",
                }}
              >
                ← Back to File Inspection ({parsedRows.length} Rows)
              </button>
            </div>

            {/* Operation Type, Notes & Primary Create Batch(es) Button */}
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 16,
                paddingTop: 14,
                borderTop: "1px solid #e2e8f0",
              }}
            >
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#475569",
                      textTransform: "uppercase",
                    }}
                  >
                    Operation Type
                  </span>
                  <select
                    value={selectedTrnType}
                    onChange={(e) => setSelectedTrnType(e.target.value)}
                    disabled={isCreatingBatches}
                    style={{
                      padding: "9px 12px",
                      borderRadius: 8,
                      border: "1px solid #cbd5e1",
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#0f172a",
                      background: "#ffffff",
                    }}
                  >
                    {TRN_OPERATION_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 280 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#475569",
                      textTransform: "uppercase",
                    }}
                  >
                    Batch Notes (Optional)
                  </span>
                  <input
                    type="text"
                    value={batchNotes}
                    onChange={(e) => setBatchNotes(e.target.value)}
                    disabled={isCreatingBatches}
                    placeholder="e.g. Credit control disconnection batch"
                    style={{
                      padding: "9px 12px",
                      borderRadius: 8,
                      border: "1px solid #cbd5e1",
                      fontSize: 13,
                      color: "#0f172a",
                    }}
                  />
                </label>
              </div>

              <button
                type="button"
                disabled={isCreatingBatches || wardBatchGroups.length === 0}
                onClick={handleCreateWardBatches}
                style={{
                  padding: "11px 22px",
                  borderRadius: 8,
                  border: "1px solid #15803d",
                  background: isCreatingBatches ? "#86efac" : "#16a34a",
                  color: "#ffffff",
                  fontSize: 14,
                  fontWeight: 800,
                  cursor: isCreatingBatches ? "wait" : "pointer",
                  boxShadow: "0 2px 6px rgba(22, 163, 74, 0.25)",
                }}
              >
                {isCreatingBatches
                  ? `Creating ${wardBatchGroups.length} Batch(es)...`
                  : `Create Batch(es) (${wardBatchGroups.length} ${wardBatchGroups.length === 1 ? "Batch" : "Batches"} · ${carriedBatchRows.length} TRNs)`}
              </button>
            </div>
          </div>

          {/* Separated Ward Batch Sections — Each with its own TRN Table */}
          {wardBatchGroups.map((group, batchIdx) => {
            const opOption =
              TRN_OPERATION_OPTIONS.find((o) => o.value === selectedTrnType) ||
              TRN_OPERATION_OPTIONS[0];
            const rowsWithDraftNo = group.rows.map((r, rIdx) => ({
              ...r,
              _draftRowNo: rIdx + 1,
            }));

            return (
              <div
                key={group.wardKey}
                style={{
                  background: "#ffffff",
                  borderRadius: 12,
                  border: "1px solid #cbd5e1",
                  overflow: "hidden",
                  boxShadow: "0 1px 4px rgba(15, 23, 42, 0.05)",
                }}
              >
                <div
                  style={{
                    padding: "14px 20px",
                    background: "#f8fafc",
                    borderBottom: "1px solid #e2e8f0",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: 12,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                    <span
                      style={{
                        padding: "4px 10px",
                        borderRadius: 6,
                        background: "#1e40af",
                        color: "#ffffff",
                        fontSize: 12,
                        fontWeight: 800,
                      }}
                    >
                      Draft Batch {batchIdx + 1} of {wardBatchGroups.length}
                    </span>
                    <strong style={{ fontSize: 16, fontWeight: 900, color: "#0f172a" }}>
                      {group.wardLabel}{" "}
                      <span style={{ color: "#2563eb", fontFamily: "monospace" }}>
                        ({group.wardPcode})
                      </span>
                    </strong>
                    <span
                      style={{
                        padding: "3px 10px",
                        borderRadius: 9999,
                        background: "#eff6ff",
                        border: "1px solid #bfdbfe",
                        color: "#1d4ed8",
                        fontSize: 12,
                        fontWeight: 700,
                        fontFamily: "monospace",
                      }}
                    >
                      ID: TRN_BGO_YYYYMMDD_HHMMSS_{group.wardPcode}_{opOption.code}
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      style={{
                        padding: "4px 10px",
                        borderRadius: 9999,
                        background: "#dcfce7",
                        color: "#15803d",
                        fontSize: 12,
                        fontWeight: 800,
                      }}
                    >
                      {group.rows.length} {group.rows.length === 1 ? "TRN" : "TRNs"}
                    </span>
                  </div>
                </div>

                <IrepsTable
                  rows={rowsWithDraftNo}
                  columns={draftBatchColumns}
                  rowKey={(r, idx) => r?.meterNo || r?.rowNo || idx}
                  title={`${group.wardLabel} (${group.wardPcode}) — Constituent TRNs (${group.rows.length})`}
                  downloads={{
                    registryName: `Draft_Batch_${group.wardPcode}`,
                    fileBaseName: `draft_batch_${group.wardPcode.toLowerCase()}`,
                    scope: { lmName, lmPcode, wardPcode: group.wardPcode, wardLabel: group.wardLabel },
                  }}
                  pageSizeOptions={[10, 25, 50, 100]}
                  defaultPageSize={25}
                  emptyText="No TRN rows in this ward batch."
                />
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Feedback Modal on Batch Creation Completion (All-or-Nothing Pass or Fail) */}
      {creationModalState ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(15, 23, 42, 0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 640,
              background: "#ffffff",
              borderRadius: 14,
              border:
                creationModalState.status === "PASS"
                  ? "2px solid #16a34a"
                  : "2px solid #dc2626",
              boxShadow: "0 20px 40px rgba(15, 23, 42, 0.25)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: "18px 24px",
                background: creationModalState.status === "PASS" ? "#f0fdf4" : "#fef2f2",
                borderBottom:
                  creationModalState.status === "PASS"
                    ? "1px solid #bbf7d0"
                    : "1px solid #fecaca",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: "50%",
                    background: creationModalState.status === "PASS" ? "#16a34a" : "#dc2626",
                    color: "#ffffff",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 18,
                    fontWeight: 900,
                  }}
                >
                  {creationModalState.status === "PASS" ? "✓" : "✕"}
                </span>
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      textTransform: "uppercase",
                      color: creationModalState.status === "PASS" ? "#15803d" : "#b91c1c",
                    }}
                  >
                    {creationModalState.status === "PASS"
                      ? "All-or-Nothing Batch Creation Passed"
                      : "All-or-Nothing Batch Creation Failed"}
                  </div>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: "#0f172a" }}>
                    {creationModalState.title}
                  </h3>
                </div>
              </div>
            </div>

            {/* Modal Body */}
            <div
              style={{
                padding: "20px 24px",
                display: "flex",
                flexDirection: "column",
                gap: 16,
                maxHeight: "70vh",
                overflowY: "auto",
              }}
            >
              <p style={{ margin: 0, fontSize: 14, color: "#334155", lineHeight: 1.5 }}>
                {creationModalState.message}
              </p>

              {creationModalState.status === "FAIL" ? (
                <div
                  style={{
                    padding: "12px 16px",
                    borderRadius: 10,
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    color: "#991b1b",
                    fontSize: 13,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <strong>Failure Reason(s):</strong>
                  {(creationModalState.errors || []).map((errText, idx) => (
                    <div key={idx} style={{ fontFamily: "monospace", fontSize: 12 }}>
                      • {errText}
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  {/* Created Batches Summary List */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 800,
                        color: "#475569",
                        textTransform: "uppercase",
                      }}
                    >
                      Created Ward Batches ({creationModalState.batches.length})
                    </span>
                    {creationModalState.batches.map((b) => (
                      <div
                        key={b.tcId}
                        style={{
                          padding: "10px 14px",
                          borderRadius: 8,
                          background: "#f8fafc",
                          border: "1px solid #cbd5e1",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          flexWrap: "wrap",
                          gap: 8,
                        }}
                      >
                        <div>
                          <strong style={{ fontSize: 13, color: "#0f172a" }}>
                            {b.wardLabel} ({b.wardPcode})
                          </strong>
                          <div
                            style={{
                              fontSize: 12,
                              fontFamily: "monospace",
                              fontWeight: 700,
                              color: "#1d4ed8",
                            }}
                          >
                            {b.tcId}
                          </div>
                        </div>
                        <span
                          style={{
                            padding: "3px 10px",
                            borderRadius: 9999,
                            background: "#dcfce7",
                            color: "#15803d",
                            fontSize: 12,
                            fontWeight: 800,
                          }}
                        >
                          {b.meterCount} TRNs
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Allocation Choice: Leave Unallocated OR Allocate to TEAM / SP */}
                  <div
                    style={{
                      padding: "16px",
                      borderRadius: 10,
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                    }}
                  >
                    <strong style={{ fontSize: 13, color: "#0f172a" }}>
                      Batch Allocation Option Before Opening Register:
                    </strong>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                      {[
                        {
                          key: "UNALLOCATED",
                          label: "Leave Unallocated (Bank in Register)",
                        },
                        {
                          key: "TEAM",
                          label: `Allocate to Operational Team (${availableTeams.length})`,
                        },
                        {
                          key: "SP",
                          label: `Allocate to Service Provider (${availableServiceProviders.length})`,
                        },
                      ].map((opt) => {
                        const active = allocationMode === opt.key;
                        return (
                          <button
                            key={opt.key}
                            type="button"
                            onClick={() => {
                              setAllocationMode(opt.key);
                              setAllocationError("");
                            }}
                            style={{
                              padding: "8px 14px",
                              borderRadius: 8,
                              border: active ? "2px solid #2563eb" : "1px solid #cbd5e1",
                              background: active ? "#eff6ff" : "#ffffff",
                              color: active ? "#1d4ed8" : "#334155",
                              fontSize: 12,
                              fontWeight: 800,
                              cursor: "pointer",
                            }}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>

                    {allocationMode === "TEAM" ? (
                      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>
                          Select Operational Team
                        </span>
                        <select
                          value={selectedTeamId}
                          onChange={(e) => setSelectedTeamId(e.target.value)}
                          style={{
                            padding: "9px 12px",
                            borderRadius: 8,
                            border: "1px solid #cbd5e1",
                            fontSize: 13,
                            fontWeight: 700,
                            color: "#0f172a",
                            background: "#ffffff",
                          }}
                        >
                          <option value="">-- Select Team --</option>
                          {availableTeams.map((team) => (
                            <option key={team.id} value={team.id}>
                              {team.name} ({team.memberCount || 0} members)
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}

                    {allocationMode === "SP" ? (
                      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>
                          Select Service Provider (SP)
                        </span>
                        <select
                          value={selectedSpId}
                          onChange={(e) => setSelectedSpId(e.target.value)}
                          style={{
                            padding: "9px 12px",
                            borderRadius: 8,
                            border: "1px solid #cbd5e1",
                            fontSize: 13,
                            fontWeight: 700,
                            color: "#0f172a",
                            background: "#ffffff",
                          }}
                        >
                          <option value="">-- Select Service Provider --</option>
                          {availableServiceProviders.map((sp) => (
                            <option key={sp.id} value={sp.id}>
                              {sp.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}

                    {allocationError ? (
                      <div
                        role="alert"
                        style={{
                          padding: "8px 12px",
                          borderRadius: 6,
                          background: "#fef2f2",
                          border: "1px solid #fecaca",
                          color: "#b91c1c",
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        {allocationError}
                      </div>
                    ) : null}
                  </div>
                </>
              )}
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: "14px 24px",
                background: "#f8fafc",
                borderTop: "1px solid #e2e8f0",
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 12,
              }}
            >
              {creationModalState.status === "FAIL" ? (
                <button
                  type="button"
                  onClick={() => setCreationModalState(null)}
                  style={{
                    padding: "9px 18px",
                    borderRadius: 8,
                    border: "1px solid #dc2626",
                    background: "#dc2626",
                    color: "#ffffff",
                    fontSize: 13,
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  Return to Batch Draft to Fix
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isAllocating}
                  onClick={handleConfirmPassModalAndNavigate}
                  style={{
                    padding: "10px 20px",
                    borderRadius: 8,
                    border: "1px solid #15803d",
                    background: isAllocating ? "#86efac" : "#16a34a",
                    color: "#ffffff",
                    fontSize: 13,
                    fontWeight: 800,
                    cursor: isAllocating ? "wait" : "pointer",
                  }}
                >
                  {isAllocating
                    ? "Allocating & Opening Register..."
                    : allocationMode === "UNALLOCATED"
                      ? "Leave Unallocated & Go to TRN BGO Register →"
                      : `Allocate ${creationModalState.batches.length} Batch(es) & Go to TRN BGO Register →`}
                </button>
              )}
            </div>
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
  sampleDownloadButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 14px",
    borderRadius: 8,
    border: "1px solid #bfdbfe",
    background: "#eff6ff",
    color: "#1d4ed8",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
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
