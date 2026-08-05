/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  collection,
  doc,
  documentId,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";

import { db } from "../../firebase";

const ALL_FILTER = "ALL";
const FIRESTORE_IN_CHUNK_SIZE = 30;

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeUpper(value) {
  return cleanText(value).toUpperCase();
}

function firstText(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text && text !== "NAv") return text;
  }

  return "";
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (typeof value?.seconds === "number") {
    return Number(value.seconds) * 1000;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDateTime(value) {
  const millis = toMillis(value);
  return millis ? new Date(millis).toLocaleString() : "NAv";
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function chunkValues(values, size = FIRESTORE_IN_CHUNK_SIZE) {
  const chunks = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function uniqueNonBlank(values = []) {
  return Array.from(
    new Set(values.map(cleanText).filter(Boolean)),
  ).sort((left, right) =>
    left.localeCompare(right, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

function getSalesPeriod(batch = {}) {
  const from = cleanText(batch?.selection?.salesPeriodFrom);
  const to = cleanText(batch?.selection?.salesPeriodTo);

  if (from && to) return from === to ? from : `${from} to ${to}`;
  return from || to || "NAv";
}

function getWard(row = {}, batch = {}) {
  return firstText(
    row?.location?.wardNumberLabel,
    row?.scope?.wardName,
    row?.scope?.wardNumber,
    row?.scope?.wardPcode,
    batch?.scope?.wardName,
    batch?.scope?.wardNumber,
    batch?.scope?.wardPcode,
  ) || "NAv";
}

function getOriginalMeter(row = {}, sales = {}) {
  return firstText(
    row?.meter?.numberRaw,
    row?.meter?.numberNormalized,
    sales?.meterNo,
    sales?.meterNoNormalized,
    sales?.MeterNumber,
    row?.salesAllMeterId,
  ) || "NAv";
}

function getFieldMeter(fieldWork = {}, row = {}) {
  return firstText(
    fieldWork?.discoveredMeterNo,
    fieldWork?.discoveredMeterNumber,
    fieldWork?.foundMeterNo,
    fieldWork?.foundMeterNumber,
    fieldWork?.meterNo,
    fieldWork?.meterNumber,
    row?.execution?.foundMeterNoNormalized,
    row?.execution?.foundMeterNumberNormalized,
    row?.execution?.foundMeterNo,
    row?.execution?.foundMeterNumber,
    row?.execution?.meterNoFound,
    row?.execution?.meterNumberFound,
    row?.execution?.foundMeter?.numberNormalized,
    row?.execution?.foundMeter?.number,
    row?.execution?.result?.meterNoNormalized,
    row?.execution?.result?.meterNumberNormalized,
    row?.execution?.result?.meterNo,
    row?.execution?.result?.meterNumber,
  );
}

function getOriginalAddress(row = {}, sales = {}) {
  const addressLine1 = firstText(
    row?.location?.addressLine1,
    sales?.addressLine1,
    sales?.AddressLine1,
    sales?.PostalAddress1,
  );
  const addressLine2 = firstText(
    row?.location?.addressLine2,
    sales?.addressLine2,
    sales?.AddressLine2,
    sales?.PostalAddress2,
  );
  const town = firstText(
    row?.location?.town,
    sales?.town,
    sales?.Town,
    sales?.PostalAddressTown,
  );

  return [addressLine1, addressLine2, town].filter(Boolean).join(", ") || "NAv";
}

function getFieldAddress(premise = {}) {
  const address = premise?.address || {};
  const street = [
    cleanText(address?.strNo),
    cleanText(address?.strName),
    cleanText(address?.strType),
  ]
    .filter((part) => part && part !== "NAv")
    .join(" ");

  return firstText(
    street,
    premise?.addressText,
    premise?.location?.addressLine1,
  ) || "";
}

function parseStreetNumberAndName(value) {
  const firstAddressSegment = cleanText(value).split(",")[0].trim();

  if (!firstAddressSegment) {
    return {
      strNo: "",
      strName: "",
    };
  }

  const parts = firstAddressSegment
    .split(/\s+/)
    .map(cleanText)
    .filter(Boolean);

  return {
    strNo: parts[0] || "",
    strName: parts.slice(1).join(" "),
  };
}

function getOriginalAddressParts(row = {}, sales = {}) {
  const explicitStrNo = firstText(
    row?.location?.strNo,
    row?.location?.address?.strNo,
    sales?.strNo,
    sales?.address?.strNo,
  );
  const explicitStrName = firstText(
    row?.location?.strName,
    row?.location?.address?.strName,
    sales?.strName,
    sales?.address?.strName,
  );

  if (explicitStrNo || explicitStrName) {
    return {
      strNo: explicitStrNo,
      strName: explicitStrName,
    };
  }

  const sourceAddressLine1 = firstText(
    row?.location?.addressLine1,
    sales?.addressLine1,
    sales?.AddressLine1,
    sales?.PostalAddress1,
  );

  return parseStreetNumberAndName(sourceAddressLine1);
}

function getFieldAddressParts(premise = {}) {
  const address = premise?.address || {};

  return {
    strNo: cleanText(address?.strNo),
    strName: cleanText(address?.strName),
  };
}

function normalizeMeter(value) {
  return normalizeUpper(value).replace(/[^A-Z0-9]/g, "");
}

function normalizeAddressPart(value) {
  return normalizeUpper(value)
    .replace(/[^A-Z0-9]/g, "")
    .trim();
}

function normalizeBooleanMatch(value) {
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";

  const normalized = normalizeUpper(value);

  if (["TRUE", "YES", "MATCH", "MATCHED"].includes(normalized)) {
    return "TRUE";
  }

  if (["FALSE", "NO", "MISMATCH", "NOT_MATCHED"].includes(normalized)) {
    return "FALSE";
  }

  return null;
}

function getMeterMatch({
  originalMeter,
  fieldMeter,
  fieldWork,
}) {
  const explicit = normalizeBooleanMatch(fieldWork?.meterMatch);
  if (explicit) return explicit;

  const original = normalizeMeter(originalMeter);
  const field = normalizeMeter(fieldMeter);

  if (!field) return "PENDING";
  if (!original) return "PENDING";

  return original === field ? "TRUE" : "FALSE";
}

function getAddressMatch({
  originalAddressParts,
  fieldAddressParts,
}) {
  const originalStrNo = normalizeAddressPart(
    originalAddressParts?.strNo,
  );
  const originalStrName = normalizeAddressPart(
    originalAddressParts?.strName,
  );
  const fieldStrNo = normalizeAddressPart(
    fieldAddressParts?.strNo,
  );
  const fieldStrName = normalizeAddressPart(
    fieldAddressParts?.strName,
  );

  if (
    !originalStrNo ||
    !originalStrName ||
    !fieldStrNo ||
    !fieldStrName
  ) {
    return "PENDING";
  }

  return originalStrNo === fieldStrNo &&
    originalStrName === fieldStrName
    ? "TRUE"
    : "FALSE";
}

function getBatchReference(sales = {}, tbId, rowId) {
  const refs = Array.isArray(sales?.tbRefs) ? sales.tbRefs : [];
  const normalizedTbId = cleanText(tbId);
  const normalizedRowId = cleanText(rowId);

  return (
    refs.find(
      (reference) =>
        cleanText(reference?.id || reference?.tbId) === normalizedTbId &&
        cleanText(reference?.rowId || reference?.tbRowId) === normalizedRowId,
    ) ||
    refs.find(
      (reference) =>
        cleanText(reference?.id || reference?.tbId) === normalizedTbId,
    ) ||
    null
  );
}

function getExecutionStatus(row = {}, fieldWork = {}) {
  return normalizeUpper(
    firstText(
      fieldWork?.status,
      row?.execution?.status,
    ),
  ) || "NOT_STARTED";
}

function getPremiseId(row = {}, fieldWork = {}) {
  return firstText(
    fieldWork?.premiseId,
    row?.refs?.premiseId,
    row?.execution?.premiseId,
    row?.execution?.result?.premiseId,
  );
}

function getNoAccessCount(fieldWork = {}) {
  return Array.isArray(fieldWork?.noAccess)
    ? fieldWork.noAccess.length
    : 0;
}

function getLastActivity(row = {}, fieldWork = {}, reference = {}) {
  const values = [
    fieldWork?.updatedAt,
    fieldWork?.submittedAt,
    reference?.date,
    reference?.updatedAt,
    row?.execution?.completedAt,
    row?.execution?.startedAt,
    row?.metadata?.updatedAt,
    row?.metadata?.createdAt,
  ];

  return values.reduce((latest, value) => {
    return toMillis(value) > toMillis(latest) ? value : latest;
  }, null);
}

function getCategoryOrReason(row = {}) {
  return firstText(
    row?.selection?.category,
    row?.selection?.categoryCode,
    row?.selection?.actionReason,
    row?.selection?.reason,
  ) || "NAv";
}

function getAccount(row = {}, sales = {}) {
  return firstText(
    row?.customer?.accountNumber,
    sales?.accountNumber,
    sales?.AccountNumber,
  ) || "NAv";
}

function getCustomer(row = {}, sales = {}) {
  return firstText(
    row?.customer?.customerName,
    sales?.customerName,
  ) || "NAv";
}

function getSgCode(row = {}, sales = {}) {
  return firstText(
    row?.location?.sgCode,
    row?.location?.standNumber,
    sales?.sgCode,
    sales?.standNumber,
  ) || "NAv";
}

function buildReportRow({
  row,
  batch,
  salesById,
  premiseById,
  tbId,
}) {
  const salesId = cleanText(row?.salesAllMeterId);
  const sales = salesById[salesId] || {};
  const reference = getBatchReference(sales, tbId, row?.id);
  const fieldWork =
    reference?.fieldWork &&
    typeof reference.fieldWork === "object" &&
    !Array.isArray(reference.fieldWork)
      ? reference.fieldWork
      : {};

  const premiseId = getPremiseId(row, fieldWork);
  const premise = premiseById[premiseId] || {};
  const originalMeter = getOriginalMeter(row, sales);
  const fieldMeter = getFieldMeter(fieldWork, row);
  const originalAddress = getOriginalAddress(row, sales);
  const fieldAddress = getFieldAddress(premise);
  const originalAddressParts = getOriginalAddressParts(row, sales);
  const fieldAddressParts = getFieldAddressParts(premise);
  const noAccessCount = getNoAccessCount(fieldWork);

  return {
    id: row.id,
    rowNo: Number(row?.rowNo || 0),
    salesId,
    account: getAccount(row, sales),
    customer: getCustomer(row, sales),
    ward: getWard(row, batch),
    originalMeter,
    fieldMeter: fieldMeter || "PENDING",
    meterMatch: getMeterMatch({
      originalMeter,
      fieldMeter,
      fieldWork,
    }),
    originalAddress,
    fieldAddress: fieldAddress || "PENDING",
    addressMatch: getAddressMatch({
      originalAddressParts,
      fieldAddressParts,
    }),
    sgCode: getSgCode(row, sales),
    categoryReason: getCategoryOrReason(row),
    executionStatus: getExecutionStatus(row, fieldWork),
    premiseId,
    premiseStatus: premiseId ? "LINKED" : "PENDING",
    noAccessCount,
    lastActivity: getLastActivity(row, fieldWork, reference),
    fieldWork,
    rawRow: row,
    rawSales: sales,
    rawPremise: premise,
  };
}

function statusTone(status = "") {
  switch (normalizeUpper(status)) {
    case "TRUE":
    case "COMPLETED":
    case "LINKED":
      return "success";
    case "FALSE":
    case "FAILED":
    case "REJECTED":
      return "danger";
    case "IN_PROGRESS":
      return "warning";
    default:
      return "neutral";
  }
}

function Badge({ value }) {
  const tone = statusTone(value);

  return (
    <span
      style={{
        ...styles.badge,
        ...(tone === "success" ? styles.badgeSuccess : null),
        ...(tone === "warning" ? styles.badgeWarning : null),
        ...(tone === "danger" ? styles.badgeDanger : null),
      }}
    >
      {cleanText(value).replaceAll("_", " ") || "NAv"}
    </span>
  );
}

function SummaryCard({ label, value, helper }) {
  return (
    <article style={styles.summaryCard}>
      <span style={styles.summaryLabel}>{label}</span>
      <strong style={styles.summaryValue}>{formatNumber(value)}</strong>
      <span style={styles.summaryHelper}>{helper}</span>
    </article>
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

function InfoItem({ label, value }) {
  return (
    <div style={styles.infoItem}>
      <span style={styles.infoLabel}>{label}</span>
      <strong style={styles.infoValue}>{value || "NAv"}</strong>
    </div>
  );
}

function ModalShell({ title, subtitle, onClose, children, wide = false }) {
  return (
    <div
      style={styles.modalBackdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        style={{
          ...styles.modalCard,
          ...(wide ? styles.modalCardWide : null),
        }}
        role="dialog"
        aria-modal="true"
      >
        <div style={styles.modalHeader}>
          <div>
            <p style={styles.modalEyebrow}>{subtitle}</p>
            <h2 style={styles.modalTitle}>{title}</h2>
          </div>

          <button type="button" style={styles.closeButton} onClick={onClose}>
            ×
          </button>
        </div>

        <div style={styles.modalBody}>{children}</div>
      </div>
    </div>
  );
}

function getAttemptReason(attempt = {}) {
  return firstText(
    attempt?.accessData?.access?.reason,
    attempt?.accessData?.reason,
    attempt?.reason,
  ) || "NAv";
}

function getAttemptUser(attempt = {}) {
  return firstText(
    attempt?.metadata?.createdByUser,
    attempt?.metadata?.updatedByUser,
    attempt?.metadata?.createdByUid,
  ) || "NAv";
}

function getAttemptDate(attempt = {}) {
  return (
    attempt?.capturedAt ||
    attempt?.metadata?.createdAt ||
    attempt?.metadata?.updatedAt
  );
}

function getAttemptGps(attempt = {}) {
  const gps = attempt?.location?.gps || attempt?.location || {};
  const lat = Number(gps?.lat);
  const lng = Number(gps?.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "NAv";
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function getAttemptMedia(attempt = {}) {
  return (Array.isArray(attempt?.media) ? attempt.media : [])
    .filter((item) => item?.tag === "noAccessPhoto")
    .map((item) => firstText(item?.url, item?.uri))
    .filter(Boolean);
}

function NoAccessModal({ row, attempts, onClose }) {
  return (
    <ModalShell
      title={`No Access Details — ${formatNumber(row.noAccessCount)}`}
      subtitle={`Row ${row.rowNo || "NAv"} • ${row.originalMeter}`}
      onClose={onClose}
      wide
    >
      {row.noAccessCount === 0 ? (
        <div style={styles.emptyModalState}>
          No No Access attempts are recorded for this row.
        </div>
      ) : null}

      {row.noAccessCount > 0 && attempts.length === 0 ? (
        <div style={styles.notice}>
          The Sales TB reference reports {formatNumber(row.noAccessCount)} No
          Access attempt(s), but detailed TRN records are not available in the
          current live result stream.
        </div>
      ) : null}

      <div style={styles.attemptList}>
        {attempts.map((attempt, index) => {
          const media = getAttemptMedia(attempt);

          return (
            <article key={attempt.id} style={styles.attemptCard}>
              <div style={styles.attemptHeader}>
                <strong>Attempt {index + 1}</strong>
                <Badge value="NO ACCESS" />
              </div>

              <div style={styles.attemptGrid}>
                <InfoItem
                  label="Captured"
                  value={formatDateTime(getAttemptDate(attempt))}
                />
                <InfoItem
                  label="Reason"
                  value={getAttemptReason(attempt)}
                />
                <InfoItem
                  label="Captured By"
                  value={getAttemptUser(attempt)}
                />
                <InfoItem
                  label="GPS"
                  value={getAttemptGps(attempt)}
                />
              </div>

              {media.length > 0 ? (
                <div style={styles.photoGrid}>
                  {media.map((url, mediaIndex) => (
                    <a
                      key={`${attempt.id}-${mediaIndex}`}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      style={styles.photoLink}
                    >
                      <img
                        src={url}
                        alt={`No Access attempt ${index + 1}`}
                        style={styles.photo}
                      />
                      <span>Open evidence photo</span>
                    </a>
                  ))}
                </div>
              ) : (
                <span style={styles.secondaryText}>
                  No evidence photo URL is available in this report record.
                </span>
              )}
            </article>
          );
        })}
      </div>
    </ModalShell>
  );
}

function RowDetailsModal({ row, onClose }) {
  return (
    <ModalShell
      title={`TB Row ${row.rowNo || "NAv"}`}
      subtitle={row.originalMeter}
      onClose={onClose}
      wide
    >
      <div style={styles.detailSection}>
        <h3 style={styles.detailTitle}>Source identity</h3>
        <div style={styles.detailGrid}>
          <InfoItem label="Account" value={row.account} />
          <InfoItem label="Customer" value={row.customer} />
          <InfoItem label="Ward" value={row.ward} />
          <InfoItem label="SG Code" value={row.sgCode} />
          <InfoItem label="Sales Document" value={row.salesId} />
          <InfoItem label="TB Row ID" value={row.id} />
        </div>
      </div>

      <div style={styles.detailSection}>
        <h3 style={styles.detailTitle}>Meter comparison</h3>
        <div style={styles.detailGrid}>
          <InfoItem label="Original Meter" value={row.originalMeter} />
          <InfoItem label="Field Meter" value={row.fieldMeter} />
          <InfoItem label="Meter Match" value={row.meterMatch} />
          <InfoItem
            label="Field Meter ID"
            value={row.fieldWork?.meterId || "NAv"}
          />
        </div>
      </div>

      <div style={styles.detailSection}>
        <h3 style={styles.detailTitle}>Address comparison</h3>
        <div style={styles.detailGrid}>
          <InfoItem label="Original Address" value={row.originalAddress} />
          <InfoItem label="Field Address" value={row.fieldAddress} />
          <InfoItem label="Address Match" value={row.addressMatch} />
          <InfoItem label="Premise ID" value={row.premiseId || "NAv"} />
        </div>
      </div>

      <div style={styles.detailSection}>
        <h3 style={styles.detailTitle}>Field result</h3>
        <div style={styles.detailGrid}>
          <InfoItem label="Execution" value={row.executionStatus} />
          <InfoItem
            label="No Access Attempts"
            value={formatNumber(row.noAccessCount)}
          />
          <InfoItem
            label="Last Activity"
            value={formatDateTime(row.lastActivity)}
          />
          <InfoItem label="Category / Reason" value={row.categoryReason} />
        </div>
      </div>
    </ModalShell>
  );
}

export default function SalesBatchReportPage() {
  const { tbId = "" } = useParams();
  const decodedTbId = decodeURIComponent(tbId);

  const [batch, setBatch] = useState(null);
  const [tbRows, setTbRows] = useState([]);
  const [salesById, setSalesById] = useState({});
  const [premiseById, setPremiseById] = useState({});
  const [noAccessTrns, setNoAccessTrns] = useState([]);

  const [parentReady, setParentReady] = useState(false);
  const [rowsReady, setRowsReady] = useState(false);
  const [salesReady, setSalesReady] = useState(false);
  const [premisesReady, setPremisesReady] = useState(false);
  const [trnsReady, setTrnsReady] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [searchText, setSearchText] = useState("");
  const [executionFilter, setExecutionFilter] = useState(ALL_FILTER);
  const [wardFilter, setWardFilter] = useState(ALL_FILTER);
  const [meterMatchFilter, setMeterMatchFilter] = useState(ALL_FILTER);
  const [addressMatchFilter, setAddressMatchFilter] = useState(ALL_FILTER);
  const [noAccessFilter, setNoAccessFilter] = useState(ALL_FILTER);

  const [selectedNoAccessRow, setSelectedNoAccessRow] = useState(null);
  const [selectedRow, setSelectedRow] = useState(null);

  useEffect(() => {
    setBatch(null);
    setTbRows([]);
    setParentReady(false);
    setRowsReady(false);
    setLoadError("");

    if (!decodedTbId) {
      setLoadError("The Targeted Batch ID is missing from the route.");
      setParentReady(true);
      setRowsReady(true);
      return undefined;
    }

    const handleError = (error) => {
      console.error("[SALES TB ROW REPORT]", error);
      setLoadError(
        error?.message ||
          "The live Targeted Batch report stream could not be opened.",
      );
    };

    const unsubscribeParent = onSnapshot(
      doc(db, "tb_uploads", decodedTbId),
      (snapshot) => {
        setBatch(
          snapshot.exists()
            ? {
                id: snapshot.id,
                ...snapshot.data(),
              }
            : null,
        );
        setParentReady(true);
      },
      handleError,
    );

    const unsubscribeRows = onSnapshot(
      query(
        collection(db, "tb_rows"),
        where("tbId", "==", decodedTbId),
      ),
      (snapshot) => {
        setTbRows(
          snapshot.docs
            .map((rowSnapshot) => ({
              id: rowSnapshot.id,
              ...rowSnapshot.data(),
            }))
            .sort(
              (left, right) =>
                Number(left?.rowNo || 0) - Number(right?.rowNo || 0),
            ),
        );
        setRowsReady(true);
      },
      handleError,
    );

    return () => {
      unsubscribeParent();
      unsubscribeRows();
    };
  }, [decodedTbId]);

  const salesIds = useMemo(
    () =>
      uniqueNonBlank(
        tbRows.map((row) => row?.salesAllMeterId),
      ),
    [tbRows],
  );

  const salesIdsKey = salesIds.join("|");

  useEffect(() => {
    setSalesById({});
    setSalesReady(false);

    if (salesIds.length === 0) {
      setSalesReady(true);
      return undefined;
    }

    let active = true;
    const chunkResults = new Map();
    const chunks = chunkValues(salesIds);
    const unsubscribes = [];

    const publish = () => {
      if (!active) return;

      const combined = {};

      chunkResults.forEach((rows) => {
        Object.assign(combined, rows);
      });

      setSalesById(combined);
      setSalesReady(chunkResults.size === chunks.length);
    };

    chunks.forEach((salesIdChunk, chunkIndex) => {
      const unsubscribe = onSnapshot(
        query(
          collection(db, "demo_sales_meters"),
          where(documentId(), "in", salesIdChunk),
        ),
        (snapshot) => {
          const rows = {};

          snapshot.docs.forEach((salesSnapshot) => {
            rows[salesSnapshot.id] = {
              id: salesSnapshot.id,
              ...salesSnapshot.data(),
            };
          });

          chunkResults.set(chunkIndex, rows);
          publish();
        },
        (error) => {
          console.error("[SALES TB ROW REPORT][SALES JOIN]", error);
          setLoadError(
            error?.message ||
              "The live Sales result join could not be opened.",
          );
          chunkResults.set(chunkIndex, {});
          publish();
        },
      );

      unsubscribes.push(unsubscribe);
    });

    return () => {
      active = false;
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [salesIdsKey]);

  const premiseIds = useMemo(() => {
    return uniqueNonBlank(
      tbRows.map((row) => {
        const sales = salesById[cleanText(row?.salesAllMeterId)] || {};
        const reference = getBatchReference(sales, decodedTbId, row?.id);
        const fieldWork =
          reference?.fieldWork &&
          typeof reference.fieldWork === "object" &&
          !Array.isArray(reference.fieldWork)
            ? reference.fieldWork
            : {};

        return getPremiseId(row, fieldWork);
      }),
    );
  }, [tbRows, salesById, decodedTbId]);

  const premiseIdsKey = premiseIds.join("|");

  useEffect(() => {
    setPremiseById({});
    setPremisesReady(false);

    if (premiseIds.length === 0) {
      setPremisesReady(true);
      return undefined;
    }

    let active = true;
    const chunkResults = new Map();
    const chunks = chunkValues(premiseIds);
    const unsubscribes = [];

    const publish = () => {
      if (!active) return;

      const combined = {};

      chunkResults.forEach((rows) => {
        Object.assign(combined, rows);
      });

      setPremiseById(combined);
      setPremisesReady(chunkResults.size === chunks.length);
    };

    chunks.forEach((premiseIdChunk, chunkIndex) => {
      const unsubscribe = onSnapshot(
        query(
          collection(db, "registry_premises"),
          where(documentId(), "in", premiseIdChunk),
        ),
        (snapshot) => {
          const rows = {};

          snapshot.docs.forEach((premiseSnapshot) => {
            rows[premiseSnapshot.id] = {
              id: premiseSnapshot.id,
              ...premiseSnapshot.data(),
            };
          });

          chunkResults.set(chunkIndex, rows);
          publish();
        },
        (error) => {
          console.error("[SALES TB ROW REPORT][PREMISE JOIN]", error);
          setLoadError(
            error?.message ||
              "The live field-address join could not be opened.",
          );
          chunkResults.set(chunkIndex, {});
          publish();
        },
      );

      unsubscribes.push(unsubscribe);
    });

    return () => {
      active = false;
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [premiseIdsKey]);

  useEffect(() => {
    setNoAccessTrns([]);
    setTrnsReady(false);

    if (!decodedTbId) {
      setTrnsReady(true);
      return undefined;
    }

    const unsubscribe = onSnapshot(
      query(
        collection(db, "trns"),
        where(
          "targetedBatchContext.tbId",
          "==",
          decodedTbId,
        ),
      ),
      (snapshot) => {
        setNoAccessTrns(
          snapshot.docs
            .map((trnSnapshot) => ({
              id: trnSnapshot.id,
              ...trnSnapshot.data(),
            }))
            .filter(
              (trn) =>
                normalizeUpper(trn?.accessData?.access?.hasAccess) === "NO",
            )
            .sort(
              (left, right) =>
                toMillis(getAttemptDate(left)) -
                toMillis(getAttemptDate(right)),
            ),
        );
        setTrnsReady(true);
      },
      (error) => {
        console.error("[SALES TB ROW REPORT][NO ACCESS STREAM]", error);
        setLoadError(
          error?.message ||
            "The live No Access detail stream could not be opened.",
        );
        setTrnsReady(true);
      },
    );

    return () => unsubscribe();
  }, [decodedTbId]);

  const rows = useMemo(
    () =>
      tbRows.map((row) =>
        buildReportRow({
          row,
          batch,
          salesById,
          premiseById,
          tbId: decodedTbId,
        }),
      ),
    [
      tbRows,
      batch,
      salesById,
      premiseById,
      decodedTbId,
    ],
  );

  const attemptsByRowId = useMemo(() => {
    return noAccessTrns.reduce((accumulator, trn) => {
      const rowId = cleanText(trn?.targetedBatchContext?.rowId);

      if (!rowId) return accumulator;

      if (!accumulator[rowId]) accumulator[rowId] = [];
      accumulator[rowId].push(trn);

      return accumulator;
    }, {});
  }, [noAccessTrns]);

  const filterOptions = useMemo(
    () => ({
      wards: uniqueNonBlank(rows.map((row) => row.ward)),
      executions: uniqueNonBlank(
        rows.map((row) => row.executionStatus),
      ),
    }),
    [rows],
  );

  const filteredRows = useMemo(() => {
    const search = normalizeUpper(searchText);

    return rows.filter((row) => {
      const searchable = normalizeUpper(
        [
          row.rowNo,
          row.account,
          row.customer,
          row.ward,
          row.originalMeter,
          row.fieldMeter,
          row.originalAddress,
          row.fieldAddress,
          row.sgCode,
          row.categoryReason,
        ].join(" "),
      );

      if (search && !searchable.includes(search)) return false;
      if (
        executionFilter !== ALL_FILTER &&
        row.executionStatus !== executionFilter
      ) {
        return false;
      }
      if (wardFilter !== ALL_FILTER && row.ward !== wardFilter) {
        return false;
      }
      if (
        meterMatchFilter !== ALL_FILTER &&
        row.meterMatch !== meterMatchFilter
      ) {
        return false;
      }
      if (
        addressMatchFilter !== ALL_FILTER &&
        row.addressMatch !== addressMatchFilter
      ) {
        return false;
      }
      if (
        noAccessFilter === "HAS_NA" &&
        row.noAccessCount === 0
      ) {
        return false;
      }
      if (
        noAccessFilter === "NO_NA" &&
        row.noAccessCount > 0
      ) {
        return false;
      }

      return true;
    });
  }, [
    rows,
    searchText,
    executionFilter,
    wardFilter,
    meterMatchFilter,
    addressMatchFilter,
    noAccessFilter,
  ]);

  const summary = useMemo(() => {
    return rows.reduce(
      (accumulator, row) => {
        accumulator.total += 1;

        if (row.executionStatus === "COMPLETED") {
          accumulator.completed += 1;
        } else if (row.executionStatus === "IN_PROGRESS") {
          accumulator.inProgress += 1;
        } else {
          accumulator.notStarted += 1;
        }

        if (cleanText(row.fieldWork?.meterId)) {
          accumulator.metersDiscovered += 1;
        }

        accumulator.noAccessAttempts += row.noAccessCount;

        return accumulator;
      },
      {
        total: 0,
        notStarted: 0,
        inProgress: 0,
        completed: 0,
        metersDiscovered: 0,
        noAccessAttempts: 0,
      },
    );
  }, [rows]);

  const allReady =
    parentReady &&
    rowsReady &&
    salesReady &&
    premisesReady &&
    trnsReady;

  function clearFilters() {
    setSearchText("");
    setExecutionFilter(ALL_FILTER);
    setWardFilter(ALL_FILTER);
    setMeterMatchFilter(ALL_FILTER);
    setAddressMatchFilter(ALL_FILTER);
    setNoAccessFilter(ALL_FILTER);
  }

  if (!parentReady || !rowsReady) {
    return (
      <section style={styles.page}>
        <Link to="/sales/reporting" style={styles.backButton}>
          ← Back to Sales Reporting
        </Link>

        <div style={styles.loadingState}>
          Loading live Targeted Batch report...
        </div>
      </section>
    );
  }

  if (!batch) {
    return (
      <section style={styles.page}>
        <Link to="/sales/reporting" style={styles.backButton}>
          ← Back to Sales Reporting
        </Link>

        <div style={styles.errorState}>
          Permanent Targeted Batch {decodedTbId || "NAv"} was not found.
        </div>
      </section>
    );
  }

  return (
    <section style={styles.page}>
      <div style={styles.topRow}>
        <Link to="/sales/reporting" style={styles.backButton}>
          ← Back to Sales Reporting
        </Link>

        <div style={styles.liveBadge}>
          <span style={styles.liveDot} />
          {allReady ? "Live field results" : "Joining live field results..."}
        </div>
      </div>

      <header style={styles.header}>
        <div>
          <p style={styles.eyebrow}>
            Sales / Reporting / Targeted Batch
          </p>
          <h1 style={styles.title}>Targeted Batch Report</h1>
          <p style={styles.subtitle}>{batch.id}</p>
        </div>

        <Badge value={batch?.execution?.status || batch?.status} />
      </header>

      {loadError ? (
        <div style={styles.errorState}>{loadError}</div>
      ) : null}

      <section style={styles.batchPanel}>
        <div style={styles.infoGrid}>
          <InfoItem
            label="Sales Period"
            value={getSalesPeriod(batch)}
          />
          <InfoItem
            label="Selection Reason"
            value={batch?.selection?.reason}
          />
          <InfoItem
            label="Ward"
            value={firstText(
              batch?.scope?.wardName,
              batch?.scope?.wardNumber,
              batch?.scope?.wardPcode,
            )}
          />
          <InfoItem
            label="Allocated To"
            value={
              firstText(
                batch?.allocation?.targetName,
                batch?.allocation?.target?.name,
              ) || "Unallocated"
            }
          />
          <InfoItem
            label="Acceptance"
            value={batch?.acceptance?.status}
          />
          <InfoItem
            label="Execution"
            value={batch?.execution?.status}
          />
        </div>
      </section>

      <div style={styles.summaryGrid}>
        <SummaryCard
          label="Total Rows"
          value={summary.total}
          helper="Permanent TB rows"
        />
        <SummaryCard
          label="Not Started"
          value={summary.notStarted}
          helper="No field execution yet"
        />
        <SummaryCard
          label="In Progress"
          value={summary.inProgress}
          helper="Active field rows"
        />
        <SummaryCard
          label="Completed"
          value={summary.completed}
          helper="Completed field rows"
        />
        <SummaryCard
          label="Meters Discovered"
          value={summary.metersDiscovered}
          helper="fieldWork.meterId linked"
        />
        <SummaryCard
          label="No Access Attempts"
          value={summary.noAccessAttempts}
          helper="All recorded attempts"
        />
      </div>

      <section style={styles.panel}>
        <div style={styles.panelHeader}>
          <div>
            <h2 style={styles.panelTitle}>
              Targeted Batch Field Results
            </h2>
            <p style={styles.panelSubtitle}>
              Original Sales values are shown next to live field results.
            </p>
          </div>

          <strong style={styles.resultCount}>
            {formatNumber(filteredRows.length)} of{" "}
            {formatNumber(rows.length)} shown
          </strong>
        </div>

        <div style={styles.filters}>
          <label style={styles.filterField}>
            <span style={styles.filterLabel}>Search</span>
            <input
              type="search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Meter, account, customer, address or SG Code"
              style={styles.filterInput}
            />
          </label>

          <label style={styles.filterField}>
            <span style={styles.filterLabel}>Execution</span>
            <select
              value={executionFilter}
              onChange={(event) =>
                setExecutionFilter(event.target.value)
              }
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
            <span style={styles.filterLabel}>Meter Match</span>
            <select
              value={meterMatchFilter}
              onChange={(event) =>
                setMeterMatchFilter(event.target.value)
              }
              style={styles.filterInput}
            >
              <option value={ALL_FILTER}>All Meter Matches</option>
              <option value="TRUE">TRUE</option>
              <option value="FALSE">FALSE</option>
              <option value="PENDING">PENDING</option>
            </select>
          </label>

          <label style={styles.filterField}>
            <span style={styles.filterLabel}>Address Match</span>
            <select
              value={addressMatchFilter}
              onChange={(event) =>
                setAddressMatchFilter(event.target.value)
              }
              style={styles.filterInput}
            >
              <option value={ALL_FILTER}>All Address Matches</option>
              <option value="TRUE">TRUE</option>
              <option value="FALSE">FALSE</option>
              <option value="PENDING">PENDING</option>
            </select>
          </label>

          <label style={styles.filterField}>
            <span style={styles.filterLabel}>No Access</span>
            <select
              value={noAccessFilter}
              onChange={(event) =>
                setNoAccessFilter(event.target.value)
              }
              style={styles.filterInput}
            >
              <option value={ALL_FILTER}>All Rows</option>
              <option value="HAS_NA">Has No Access</option>
              <option value="NO_NA">No No Access</option>
            </select>
          </label>

          <button
            type="button"
            style={styles.clearButton}
            onClick={clearFilters}
          >
            Clear Filters
          </button>
        </div>

        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <Th>Row</Th>
                <Th>Account</Th>
                <Th>Customer</Th>
                <Th>Ward</Th>
                <Th>Original Meter</Th>
                <Th>Field Meter</Th>
                <Th>Meter Match</Th>
                <Th>Original Address</Th>
                <Th>Field Address</Th>
                <Th>Address Match</Th>
                <Th>Execution</Th>
                <Th>Premise</Th>
                <Th>No Access</Th>
                <Th>Last Activity</Th>
                <Th>Action</Th>
              </tr>
            </thead>

            <tbody>
              {!allReady && rows.length === 0 ? (
                <tr>
                  <Td colSpan={15}>
                    Joining live Sales and field-result records...
                  </Td>
                </tr>
              ) : null}

              {allReady && filteredRows.length === 0 ? (
                <tr>
                  <Td colSpan={15}>
                    {rows.length === 0
                      ? "No permanent TB rows exist for this Targeted Batch."
                      : "No TB rows match the selected filters."}
                  </Td>
                </tr>
              ) : null}

              {filteredRows.map((row) => (
                <tr key={row.id}>
                  <Td>{row.rowNo || "NAv"}</Td>
                  <Td>{row.account}</Td>
                  <Td>{row.customer}</Td>
                  <Td>{row.ward}</Td>
                  <Td>
                    <strong style={styles.primaryCell}>
                      {row.originalMeter}
                    </strong>
                  </Td>
                  <Td>
                    <strong style={styles.primaryCell}>
                      {row.fieldMeter}
                    </strong>
                  </Td>
                  <Td>
                    <Badge value={row.meterMatch} />
                  </Td>
                  <Td>
                    <span style={styles.addressCell}>
                      {row.originalAddress}
                    </span>
                  </Td>
                  <Td>
                    <span style={styles.addressCell}>
                      {row.fieldAddress}
                    </span>
                  </Td>
                  <Td>
                    <Badge value={row.addressMatch} />
                  </Td>
                  <Td>
                    <Badge value={row.executionStatus} />
                  </Td>
                  <Td>
                    <Badge value={row.premiseStatus} />
                    {row.premiseId ? (
                      <div style={styles.secondaryText}>
                        {row.premiseId}
                      </div>
                    ) : null}
                  </Td>
                  <Td>
                    <button
                      type="button"
                      style={{
                        ...styles.noAccessButton,
                        ...(row.noAccessCount === 0
                          ? styles.noAccessButtonDisabled
                          : null),
                      }}
                      disabled={row.noAccessCount === 0}
                      onClick={() => setSelectedNoAccessRow(row)}
                      title={
                        row.noAccessCount > 0
                          ? "Open No Access details"
                          : "No No Access attempts"
                      }
                    >
                      {formatNumber(row.noAccessCount)}
                    </button>
                  </Td>
                  <Td>{formatDateTime(row.lastActivity)}</Td>
                  <Td>
                    <button
                      type="button"
                      style={styles.openButton}
                      onClick={() => setSelectedRow(row)}
                    >
                      Open Row
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selectedNoAccessRow ? (
        <NoAccessModal
          row={selectedNoAccessRow}
          attempts={
            attemptsByRowId[selectedNoAccessRow.id] || []
          }
          onClose={() => setSelectedNoAccessRow(null)}
        />
      ) : null}

      {selectedRow ? (
        <RowDetailsModal
          row={selectedRow}
          onClose={() => setSelectedRow(null)}
        />
      ) : null}
    </section>
  );
}

const styles = {
  page: {
    display: "grid",
    gap: 18,
    minWidth: 0,
  },

  topRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },

  backButton: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: 10,
    background: "#0f172a",
    color: "#ffffff",
    padding: "9px 13px",
    fontSize: 11,
    fontWeight: 900,
    textDecoration: "none",
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
    fontSize: 30,
    lineHeight: 1.15,
  },

  subtitle: {
    margin: "8px 0 0",
    color: "#475569",
    fontSize: 14,
    fontWeight: 900,
  },

  batchPanel: {
    borderRadius: 18,
    border: "1px solid #dbeafe",
    background: "#eff6ff",
    padding: 16,
  },

  infoGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 12,
  },

  infoItem: {
    minWidth: 0,
    display: "grid",
    gap: 4,
  },

  infoLabel: {
    color: "#64748b",
    fontSize: 10,
    fontWeight: 900,
    textTransform: "uppercase",
  },

  infoValue: {
    color: "#0f172a",
    fontSize: 12,
    overflowWrap: "anywhere",
  },

  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: 12,
  },

  summaryCard: {
    borderRadius: 16,
    border: "1px solid #e2e8f0",
    background: "#ffffff",
    padding: 16,
    display: "grid",
    gap: 4,
  },

  summaryLabel: {
    color: "#64748b",
    fontSize: 10,
    fontWeight: 900,
    textTransform: "uppercase",
  },

  summaryValue: {
    color: "#0f172a",
    fontSize: 25,
    lineHeight: 1.1,
  },

  summaryHelper: {
    color: "#94a3b8",
    fontSize: 10,
    fontWeight: 700,
  },

  panel: {
    minWidth: 0,
    borderRadius: 18,
    border: "1px solid #e2e8f0",
    background: "#ffffff",
    overflow: "hidden",
  },

  panelHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: 18,
    borderBottom: "1px solid #e2e8f0",
    flexWrap: "wrap",
  },

  panelTitle: {
    margin: 0,
    color: "#0f172a",
    fontSize: 18,
  },

  panelSubtitle: {
    margin: "4px 0 0",
    color: "#64748b",
    fontSize: 12,
    fontWeight: 700,
  },

  resultCount: {
    color: "#1d4ed8",
    fontSize: 12,
  },

  filters: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: 10,
    padding: 18,
    background: "#f8fafc",
    borderBottom: "1px solid #e2e8f0",
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
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#0f172a",
    padding: "8px 10px",
    fontSize: 12,
    fontWeight: 700,
    boxSizing: "border-box",
  },

  clearButton: {
    minHeight: 40,
    alignSelf: "end",
    borderRadius: 10,
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#334155",
    padding: "8px 14px",
    fontSize: 11,
    fontWeight: 900,
    cursor: "pointer",
  },

  tableWrap: {
    width: "100%",
    overflowX: "auto",
  },

  table: {
    width: "100%",
    minWidth: 2050,
    borderCollapse: "collapse",
  },

  th: {
    padding: "11px 12px",
    borderBottom: "1px solid #cbd5e1",
    background: "#f8fafc",
    color: "#475569",
    fontSize: 10,
    fontWeight: 900,
    textAlign: "left",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  },

  td: {
    padding: "12px",
    borderBottom: "1px solid #e2e8f0",
    color: "#334155",
    fontSize: 11,
    fontWeight: 700,
    verticalAlign: "top",
  },

  primaryCell: {
    color: "#0f172a",
    whiteSpace: "nowrap",
  },

  addressCell: {
    display: "block",
    minWidth: 170,
    maxWidth: 250,
    lineHeight: 1.45,
  },

  secondaryText: {
    marginTop: 4,
    color: "#64748b",
    fontSize: 9,
    overflowWrap: "anywhere",
  },

  badge: {
    display: "inline-flex",
    borderRadius: 999,
    background: "#f1f5f9",
    color: "#475569",
    padding: "5px 8px",
    fontSize: 9,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },

  badgeSuccess: {
    background: "#dcfce7",
    color: "#166534",
  },

  badgeWarning: {
    background: "#ffedd5",
    color: "#c2410c",
  },

  badgeDanger: {
    background: "#fee2e2",
    color: "#991b1b",
  },

  noAccessButton: {
    minWidth: 38,
    minHeight: 32,
    borderRadius: 9,
    border: "1px solid #fecaca",
    background: "#fee2e2",
    color: "#991b1b",
    fontSize: 11,
    fontWeight: 900,
    cursor: "pointer",
  },

  noAccessButtonDisabled: {
    borderColor: "#e2e8f0",
    background: "#f8fafc",
    color: "#94a3b8",
    cursor: "not-allowed",
  },

  openButton: {
    minHeight: 34,
    borderRadius: 10,
    border: 0,
    background: "#0f172a",
    color: "#ffffff",
    padding: "7px 11px",
    fontSize: 10,
    fontWeight: 900,
    whiteSpace: "nowrap",
    cursor: "pointer",
  },

  loadingState: {
    borderRadius: 14,
    border: "1px solid #bfdbfe",
    background: "#eff6ff",
    color: "#1d4ed8",
    padding: 16,
    fontWeight: 800,
  },

  errorState: {
    borderRadius: 14,
    border: "1px solid #fecaca",
    background: "#fef2f2",
    color: "#991b1b",
    padding: 16,
    fontWeight: 800,
  },

  notice: {
    borderRadius: 12,
    border: "1px solid #fde68a",
    background: "#fffbeb",
    color: "#92400e",
    padding: 13,
    fontSize: 12,
    fontWeight: 800,
  },

  modalBackdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 1000,
    display: "grid",
    placeItems: "center",
    padding: 20,
    background: "rgba(15, 23, 42, 0.72)",
  },

  modalCard: {
    width: "min(620px, 96vw)",
    maxHeight: "90vh",
    borderRadius: 18,
    background: "#ffffff",
    boxShadow: "0 24px 70px rgba(15, 23, 42, 0.35)",
    overflow: "hidden",
  },

  modalCardWide: {
    width: "min(980px, 96vw)",
  },

  modalHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    padding: 18,
    borderBottom: "1px solid #e2e8f0",
  },

  modalEyebrow: {
    margin: 0,
    color: "#64748b",
    fontSize: 10,
    fontWeight: 900,
    textTransform: "uppercase",
  },

  modalTitle: {
    margin: "4px 0 0",
    color: "#0f172a",
    fontSize: 20,
  },

  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    border: 0,
    background: "#0f172a",
    color: "#ffffff",
    fontSize: 22,
    lineHeight: 1,
    cursor: "pointer",
  },

  modalBody: {
    maxHeight: "calc(90vh - 84px)",
    overflowY: "auto",
    padding: 18,
  },

  emptyModalState: {
    color: "#64748b",
    fontSize: 13,
    fontWeight: 800,
    textAlign: "center",
    padding: 24,
  },

  attemptList: {
    display: "grid",
    gap: 12,
  },

  attemptCard: {
    borderRadius: 14,
    border: "1px solid #fecaca",
    background: "#fff7f7",
    padding: 14,
  },

  attemptHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
  },

  attemptGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: 12,
  },

  photoGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 220px))",
    gap: 10,
    marginTop: 14,
  },

  photoLink: {
    display: "grid",
    gap: 6,
    color: "#1d4ed8",
    fontSize: 10,
    fontWeight: 900,
    textDecoration: "none",
  },

  photo: {
    width: "100%",
    height: 130,
    borderRadius: 10,
    objectFit: "cover",
    background: "#e2e8f0",
  },

  detailSection: {
    display: "grid",
    gap: 10,
    paddingBottom: 16,
    marginBottom: 16,
    borderBottom: "1px solid #e2e8f0",
  },

  detailTitle: {
    margin: 0,
    color: "#0f172a",
    fontSize: 15,
  },

  detailGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: 12,
  },
};
