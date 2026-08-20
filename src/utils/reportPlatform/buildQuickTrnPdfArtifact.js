import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const PAGE = Object.freeze({ width: 595.28, height: 841.89, margin: 42 });
const COLORS = Object.freeze({
  ink: rgb(0.06, 0.09, 0.16),
  muted: rgb(0.34, 0.42, 0.54),
  line: rgb(0.82, 0.86, 0.91),
  panel: rgb(0.96, 0.97, 0.99),
  blue: rgb(0.15, 0.39, 0.92),
  white: rgb(1, 1, 1),
});

const NAV = "NAv";

function isMeaningful(value) {
  if (value === 0 || value === false) return true;
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some((item) => isMeaningful(item));
  if (typeof value === "object") return Object.values(value).some(isMeaningful);

  const text = String(value).trim();
  if (!text) return false;
  return !["NAV", "N/AV", "N/A", "NA", "NULL", "UNDEFINED", "-"].includes(
    text.toUpperCase(),
  );
}

function text(value, fallback = NAV) {
  if (!isMeaningful(value)) return fallback;
  if (Array.isArray(value)) return value.map((item) => text(item, "")).filter(Boolean).join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function titleCase(value) {
  if (!isMeaningful(value)) return NAV;
  return String(value)
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      const upper = part.toUpperCase();
      if (["TRN", "AST", "GPS", "ERF", "CB", "ID"].includes(upper)) return upper;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ");
}

function formatDateTime(value) {
  if (!isMeaningful(value)) return NAV;
  if (typeof value?.toDate === "function") return value.toDate().toLocaleString();
  if (typeof value?.seconds === "number") return new Date(value.seconds * 1000).toLocaleString();

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? text(value) : parsed.toLocaleString();
}

function hasMeterSnapshot(ast) {
  if (!ast || typeof ast !== "object") return false;
  return Boolean(
    isMeaningful(ast.astData?.astNo) ||
      isMeaningful(ast.astData?.astId) ||
      isMeaningful(ast.astData?.astManufacturer) ||
      isMeaningful(ast.astData?.astName) ||
      isMeaningful(ast.astData?.meter) ||
      isMeaningful(ast.anomalies) ||
      isMeaningful(ast.location) ||
      isMeaningful(ast.normalisation) ||
      isMeaningful(ast.ogs) ||
      isMeaningful(ast.meterReading),
  );
}

function getPrimaryAst(raw) {
  const capturedAst = raw?.inspection?.captured?.ast;
  if (hasMeterSnapshot(capturedAst)) {
    return { ast: capturedAst, source: "Captured Meter Details", captured: true };
  }

  return {
    ast: raw?.ast || null,
    source: "Meter Details",
    captured: false,
  };
}

function getReading(raw, primaryAst, captured) {
  if (captured && raw?.inspection?.captured?.mreading) {
    return raw.inspection.captured.mreading;
  }

  if (isMeaningful(primaryAst?.meterReading)) {
    if (typeof primaryAst.meterReading === "object") return primaryAst.meterReading;
    return { reading: primaryAst.meterReading };
  }

  if (isMeaningful(raw?.meterReading)) {
    if (typeof raw.meterReading === "object") return raw.meterReading;
    return { reading: raw.meterReading };
  }

  return null;
}

function sanitizeFileSegment(value) {
  const cleaned = String(value || "TRN")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "TRN";
}

function winAnsi(value) {
  return String(value ?? "")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .split("")
    .map((character) => {
      const code = character.charCodeAt(0);
      const isAllowedControl = code === 9 || code === 10 || code === 13;
      const isPrintableWinAnsi = code >= 32 && code <= 255;
      return isAllowedControl || isPrintableWinAnsi ? character : "?";
    })
    .join("");
}

function wrapText(font, value, size, maxWidth) {
  const source = winAnsi(value);
  const paragraphs = source.split(/\r?\n/);
  const lines = [];

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      return;
    }

    let current = "";
    words.forEach((word) => {
      const next = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) {
        current = next;
        return;
      }

      if (current) lines.push(current);

      if (font.widthOfTextAtSize(word, size) <= maxWidth) {
        current = word;
        return;
      }

      let chunk = "";
      [...word].forEach((character) => {
        const nextChunk = `${chunk}${character}`;
        if (font.widthOfTextAtSize(nextChunk, size) <= maxWidth) {
          chunk = nextChunk;
        } else {
          if (chunk) lines.push(chunk);
          chunk = character;
        }
      });
      current = chunk;
    });

    if (current) lines.push(current);
    if (paragraphIndex < paragraphs.length - 1) lines.push("");
  });

  return lines;
}

function buildPremiseAddress(premise) {
  const address = premise?.address || {};
  const street = [address?.strNo, address?.strName, address?.strType]
    .filter((value) => isMeaningful(value))
    .map((value) => text(value, ""))
    .join(" ");
  const suburb = text(address?.suburbName, "");

  return [street, suburb].filter(Boolean).join("\n");
}

function getPremiseSection(premise) {
  if (!premise || typeof premise !== "object") return null;

  const property = premise?.property || {};
  const rows = [
    ["Address", buildPremiseAddress(premise)],
    ["Property Type", titleCase(property?.type)],
    ["Property Name", property?.name],
    ["Unit No", property?.unitNo],
    ["Occupancy Status", titleCase(premise?.occupancyStatus)],
  ].filter(([, value]) => isMeaningful(value));

  if (!rows.length) return null;

  return {
    title: "Premise Details",
    subtitle: "Current Authoritative Premise Record",
    rows,
  };
}

function getRows(raw, primaryAst, reading, premise) {
  const access = raw?.accessData || {};
  const astData = primaryAst?.astData || {};
  const meter = astData?.meter || {};
  const gps = primaryAst?.location?.gps || {};

  const sections = [
    {
      title: "TRN Details",
      rows: [
        ["TRN Type", titleCase(access?.trnType || raw?.trnType)],
        ["Has Access", titleCase(access?.access?.hasAccess)],
        ["No Access Reason", access?.access?.reason],
        ["Meter Type", titleCase(raw?.meterType)],
        [
          "TRN Status / State",
          titleCase(
            raw?.workflow?.state ||
              raw?.workflowState ||
              raw?.status?.state,
          ),
        ],
      ],
    },
  ];

  if (hasMeterSnapshot(primaryAst)) {
    sections.push({
      title: "Meter Details",
      rows: [
        ["Meter No", astData?.astNo],
        ["AST ID", astData?.astId || raw?.astId || raw?.derived?.astId],
        ["Manufacturer", astData?.astManufacturer],
        ["Meter Model / Name", astData?.astName],
        ["Meter Category", titleCase(meter?.category)],
        ["Meter Technology", titleCase(meter?.type)],
        ["Phase", titleCase(meter?.phase)],
        ["Circuit Breaker Size", meter?.cb?.size],
        ["Circuit Breaker Comment", meter?.cb?.comment],
        ["Seal No", meter?.seal?.sealNo],
        ["Seal Comment", meter?.seal?.comment],
        ["Keypad Serial No", meter?.keypad?.serialNo],
        ["Keypad Comment", meter?.keypad?.comment],
        ["Placement", titleCase(primaryAst?.location?.placement)],
        ["Latitude", gps?.lat],
        ["Longitude", gps?.lng],
      ],
    });

    sections.push({
      title: "Findings",
      rows: [
        ["Anomaly", primaryAst?.anomalies?.anomaly],
        ["Anomaly Detail", primaryAst?.anomalies?.anomalyDetail],
        [
          "Normalisation",
          primaryAst?.normalisation?.actionText ||
            primaryAst?.normalisation?.actionTaken,
        ],
        ["Off-grid Supply", primaryAst?.ogs?.hasOffGridSupply],
      ],
    });
  }

  if (reading) {
    sections.push({
      title: "Meter Reading",
      rows: [
        ["Reading", reading?.reading],
        ["Reading At", formatDateTime(reading?.readingAt)],
        ["No Reading Reason", reading?.noReadingReason],
      ],
    });
  }

  const workflow = raw?.workflow || {};
  const assignment = raw?.assignment || {};
  sections.push({
    title: "Execution Context",
    rows: [
      ["Issued At", formatDateTime(workflow?.issuedAt)],
      [
        "Accepted At",
        formatDateTime(workflow?.acceptedAt || assignment?.acceptedAt),
      ],
      ["Execution Started At", formatDateTime(workflow?.executionStartedAt)],
      ["Completed At", formatDateTime(workflow?.completedAt)],
      ["Completed By", workflow?.completedByUser],
    ],
  });

  const premiseSection = getPremiseSection(premise);
  if (premiseSection) sections.push(premiseSection);

  return sections.map((section) => ({
    ...section,
    rows: section.rows.filter(([, value]) => isMeaningful(value)),
  }));
}

async function loadMediaPayload({
  url,
  trnId,
  mediaIndex,
  loadMediaBytes,
}) {
  if (typeof loadMediaBytes === "function") {
    const loaded = await loadMediaBytes({ trnId, mediaIndex });
    const bytes =
      loaded?.bytes instanceof Uint8Array
        ? loaded.bytes
        : new Uint8Array(loaded?.bytes || []);

    if (!bytes.byteLength) {
      throw new Error("Authenticated media loader returned no image bytes");
    }

    return {
      bytes,
      contentType: String(loaded?.contentType || "").toLowerCase(),
    };
  }

  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: String(response.headers.get("content-type") || "").toLowerCase(),
  };
}

async function fetchEmbeddableMedia(
  pdfDoc,
  media,
  { trnId, loadMediaBytes } = {},
) {
  const results = [];
  const items = Array.isArray(media) ? media : [];

  for (let mediaIndex = 0; mediaIndex < items.length; mediaIndex += 1) {
    const item = items[mediaIndex] || {};
    const url = item?.url;
    const sourceMediaIndex = Number.isInteger(item?.mediaIndex)
      ? item.mediaIndex
      : mediaIndex;
    const hasAuthenticatedLoader = typeof loadMediaBytes === "function";

    if (!isMeaningful(url) && !hasAuthenticatedLoader) {
      results.push({ item, image: null, reason: "Media URL unavailable" });
      continue;
    }

    try {
      const { bytes, contentType } = await loadMediaPayload({
        url,
        trnId,
        mediaIndex: sourceMediaIndex,
        loadMediaBytes,
      });
      const lowerUrl = String(url || "").toLowerCase();

      let image = null;
      if (contentType.includes("png") || lowerUrl.includes(".png")) {
        image = await pdfDoc.embedPng(bytes);
      } else if (
        contentType.includes("jpeg") ||
        contentType.includes("jpg") ||
        /\.jpe?g(?:[?#]|$)/.test(lowerUrl)
      ) {
        image = await pdfDoc.embedJpg(bytes);
      }

      results.push({
        item,
        image,
        reason: image ? null : "Image format is not supported for PDF embedding",
      });
    } catch (error) {
      results.push({
        item,
        image: null,
        reason: error?.message || "Media could not be embedded",
      });
    }
  }

  return results;
}

export async function buildQuickTrnPdfArtifact(
  trn,
  {
    premise = null,
    loadMediaBytes,
    loadPremiseMediaBytes,
  } = {},
) {
  const raw = trn?.raw || trn || {};
  const trnId = text(raw?.trnId || raw?.id || trn?.trnId || trn?.id, "TRN");
  const { ast: primaryAst, source: meterSource, captured } = getPrimaryAst(raw);
  const reading = getReading(raw, primaryAst, captured);
  const sections = getRows(raw, primaryAst, reading, premise);

  const pdfDoc = await PDFDocument.create();
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const media = await fetchEmbeddableMedia(pdfDoc, raw?.media, {
    trnId,
    loadMediaBytes,
  });
  const premiseMediaItems = Array.isArray(premise?.media)
    ? premise.media.slice(0, 1)
    : [];
  const premiseMedia = await fetchEmbeddableMedia(
    pdfDoc,
    premiseMediaItems,
    {
      trnId,
      loadMediaBytes: loadPremiseMediaBytes,
    },
  );

  pdfDoc.setTitle(`Quick TRN Report - ${trnId}`);
  pdfDoc.setSubject(`Canonical iREPS TRN report for ${trnId}`);
  pdfDoc.setCreator("iREPS Report Platform");
  pdfDoc.setProducer("iREPS Report Platform");

  let page = null;
  let y = 0;

  function addPage() {
    page = pdfDoc.addPage([PAGE.width, PAGE.height]);
    y = PAGE.height - PAGE.margin;

    page.drawRectangle({
      x: 0,
      y: PAGE.height - 96,
      width: PAGE.width,
      height: 96,
      color: COLORS.ink,
    });
    page.drawText("iREPS", {
      x: PAGE.margin,
      y: PAGE.height - 42,
      size: 11,
      font: bold,
      color: COLORS.blue,
    });
    page.drawText("QUICK TRN REPORT", {
      x: PAGE.margin,
      y: PAGE.height - 65,
      size: 19,
      font: bold,
      color: COLORS.white,
    });
    page.drawText(winAnsi(trnId), {
      x: PAGE.margin,
      y: PAGE.height - 82,
      size: 8.5,
      font: regular,
      color: rgb(0.82, 0.86, 0.93),
      maxWidth: PAGE.width - PAGE.margin * 2,
    });

    y = PAGE.height - 120;
  }

  function ensureSpace(required) {
    if (!page || y - required < 54) addPage();
  }


  function drawSection(section) {
    if (!section.rows.length) return;
    ensureSpace(section.subtitle ? 64 : 48);

    page.drawText(winAnsi(section.title), {
      x: PAGE.margin,
      y,
      size: 11,
      font: bold,
      color: COLORS.blue,
    });
    y -= 12;
    page.drawLine({
      start: { x: PAGE.margin, y },
      end: { x: PAGE.width - PAGE.margin, y },
      thickness: 0.8,
      color: COLORS.line,
    });
    y -= 13;

    if (section.subtitle) {
      page.drawText(winAnsi(section.subtitle), {
        x: PAGE.margin,
        y,
        size: 8.4,
        font: regular,
        color: COLORS.muted,
      });
      y -= 16;
    }

    for (const [label, rawValue] of section.rows) {
      const value = Array.isArray(rawValue) ? rawValue.join(", ") : text(rawValue);
      const valueLines = wrapText(regular, value, 9.2, 330);
      const rowHeight = Math.max(22, valueLines.length * 11 + 9);
      ensureSpace(rowHeight + 4);

      page.drawRectangle({
        x: PAGE.margin,
        y: y - rowHeight + 6,
        width: PAGE.width - PAGE.margin * 2,
        height: rowHeight,
        color: COLORS.panel,
      });
      page.drawText(winAnsi(label), {
        x: PAGE.margin + 10,
        y: y - 8,
        size: 8,
        font: bold,
        color: COLORS.muted,
      });

      valueLines.forEach((line, index) => {
        page.drawText(line || " ", {
          x: PAGE.margin + 150,
          y: y - 8 - index * 11,
          size: 9.2,
          font: regular,
          color: COLORS.ink,
        });
      });

      y -= rowHeight + 4;
    }

    y -= 8;
  }

  addPage();

  ensureSpace(34);
  page.drawText(winAnsi(meterSource), {
    x: PAGE.margin,
    y,
    size: 9,
    font: bold,
    color: COLORS.muted,
  });
  y -= 24;

  sections.forEach(drawSection);

  function drawEvidencePage(title, entry, { showCaptureMetadata = true } = {}) {
    addPage();

    page.drawText(winAnsi(title), {
      x: PAGE.margin,
      y,
      size: 12,
      font: bold,
      color: COLORS.blue,
    });
    y -= 13;
    page.drawLine({
      start: { x: PAGE.margin, y },
      end: { x: PAGE.width - PAGE.margin, y },
      thickness: 0.8,
      color: COLORS.line,
    });
    y -= 20;

    if (showCaptureMetadata) {
      const capturedBy = entry?.item?.created?.byUser;
      const capturedAt = formatDateTime(entry?.item?.created?.at);
      const metadataParts = [];

      if (isMeaningful(capturedBy)) {
        metadataParts.push(`Captured By: ${text(capturedBy)}`);
      }
      if (isMeaningful(capturedAt)) {
        metadataParts.push(`Captured At: ${capturedAt}`);
      }

      if (metadataParts.length) {
        page.drawText(winAnsi(metadataParts.join("  |  ")), {
          x: PAGE.margin,
          y,
          size: 8,
          font: regular,
          color: COLORS.muted,
          maxWidth: PAGE.width - PAGE.margin * 2,
        });
        y -= 18;
      }
    }

    if (!entry?.image) {
      page.drawText(
        winAnsi(
          `Media unavailable in PDF: ${entry?.reason || "Unknown reason"}`,
        ),
        {
          x: PAGE.margin,
          y,
          size: 9,
          font: regular,
          color: COLORS.muted,
          maxWidth: PAGE.width - PAGE.margin * 2,
        },
      );
      return;
    }

    const maxWidth = PAGE.width - PAGE.margin * 2;
    const maxHeight = Math.max(120, y - 58);
    const scale = Math.min(
      maxWidth / entry.image.width,
      maxHeight / entry.image.height,
    );
    const width = entry.image.width * scale;
    const height = entry.image.height * scale;

    page.drawImage(entry.image, {
      x: PAGE.margin + (maxWidth - width) / 2,
      y: y - height,
      width,
      height,
    });
  }

  if (premiseMedia.length) {
    drawEvidencePage("Premise Photo", premiseMedia[0], {
      showCaptureMetadata: false,
    });
  }

  media.forEach((entry, index) => {
    const mediaLabel = titleCase(
      entry.item?.tag ||
        entry.item?.type ||
        `TRN Photo ${index + 1}`,
    );

    drawEvidencePage(mediaLabel, entry);
  });

  pdfDoc.getPages().forEach((currentPage, index) => {
    currentPage.drawLine({
      start: { x: PAGE.margin, y: 34 },
      end: { x: PAGE.width - PAGE.margin, y: 34 },
      thickness: 0.6,
      color: COLORS.line,
    });
    currentPage.drawText(`Generated by iREPS Report Platform  |  Page ${index + 1}`, {
      x: PAGE.margin,
      y: 20,
      size: 7.5,
      font: regular,
      color: COLORS.muted,
    });
  });

  const bytes = await pdfDoc.save();
  const fileName = `Quick-TRN-${sanitizeFileSegment(trnId)}.pdf`;

  return {
    artifact: {
      format: "PDF",
      fileName,
      bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
    },
    metadata: {
      reportType: "QUICK_TRN",
      reportName: "Quick TRN Report",
      format: "PDF",
      sourceType: "TRN",
      sourceId: trnId,
      sourceScope: { trnId },
      itemCount: 1,
      fileName,
    },
  };
}
