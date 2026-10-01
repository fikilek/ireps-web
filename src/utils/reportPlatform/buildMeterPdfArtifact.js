// The Meter Report: one meter, everything iREPS holds about it, on paper.
//
// It answers what the office asks before it sends somebody out: what this
// meter is, where it is, what state it is in, how often it has been
// disconnected, reconnected or refused entry, and everything that has ever
// been done to it.
//
// The Quick TRN Report is the same idea for one transaction. The two share a
// look but not yet a renderer; folding them into one belongs with the report
// platform, not with this work.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const NAV = "NAv";

const PAGE = { width: 595.28, height: 841.89, margin: 44 };

const COLORS = {
  ink: rgb(0.08, 0.13, 0.19),
  white: rgb(1, 1, 1),
  blue: rgb(0.45, 0.68, 0.95),
  body: rgb(0.15, 0.21, 0.28),
  muted: rgb(0.42, 0.49, 0.56),
  line: rgb(0.85, 0.88, 0.91),
  band: rgb(0.95, 0.96, 0.98),
};

function isMeaningful(value) {
  if (value === 0) return true;
  if (value === null || value === undefined) return false;

  const text = String(value).trim();

  return Boolean(text) && !["NAV", "N/A", "NULL", "UNDEFINED"].includes(text.toUpperCase());
}

function text(value, fallback = NAV) {
  return isMeaningful(value) ? String(value).trim() : fallback;
}

function titleCase(value) {
  if (!isMeaningful(value)) return NAV;

  return String(value)
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDateTime(value) {
  if (!isMeaningful(value)) return NAV;
  if (typeof value === "string") return value.slice(0, 19).replace("T", " ");
  if (typeof value?.toDate === "function") return value.toDate().toISOString().slice(0, 19).replace("T", " ");

  return NAV;
}

function count(value) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? String(Math.trunc(number)) : "0";
}

// pdf-lib's standard fonts cannot draw characters outside WinAnsi.
function winAnsi(value) {
  return String(value ?? "").replace(/[^\x20-\x7E\xA0-\xFF]/g, "-");
}

function wrapText(font, value, size, maxWidth) {
  const words = winAnsi(value).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;

    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }

    if (line) lines.push(line);
    line = word;
  }

  if (line) lines.push(line);

  return lines.length ? lines : [NAV];
}

function sanitizeFileSegment(value) {
  return String(value || "meter")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "meter";
}

function meterSections(meter, transactions) {
  const astData = meter?.ast?.astData || {};
  const access = meter?.accessData || {};
  const counts = meter?.counts || {};

  const sections = [
    {
      title: "The meter",
      rows: [
        ["Meter No", text(astData.astNo)],
        ["Meter type", titleCase(meter?.meterType)],
        ["Kind", titleCase(astData?.meter?.type)],
        ["Manufacturer", text(astData.astManufacturer)],
        ["Model", text(astData.astName)],
        ["Status", titleCase(meter?.status?.state)],
        ["Visibility", titleCase(meter?.master?.visibility || meter?.visibility)],
      ],
    },
    {
      title: "Where it is",
      rows: [
        ["Premise", text(access?.premise?.address)],
        ["Premise ID", text(access?.premise?.id)],
        ["Property type", titleCase(access?.premise?.propertyType)],
        ["ERF No", text(access?.erfNo)],
        ["Ward", text(access?.parents?.wardPcode)],
        ["Municipality", text(access?.parents?.lmPcode)],
      ],
    },
    {
      title: "Credit control",
      rows: [
        ["Disconnections", count(counts.disconnections)],
        ["Reconnections", count(counts.reconnections)],
        ["No Access visits", count(counts.noAccess)],
        ["Open job", text(meter?.trnActiveLifecycle?.trnType, "None")],
      ],
    },
    {
      title: "How it came to be here",
      rows: [
        ["Registered by", titleCase(access?.trnType)],
        ["Transaction", text(meter?.id || meter?.trnId)],
        ["Captured", formatDateTime(meter?.metadata?.createdAt)],
        ["By", text(meter?.metadata?.createdByUser)],
        ["Last changed", formatDateTime(meter?.metadata?.updatedAt)],
      ],
    },
  ];

  const history = (transactions || []).slice(0, 40).map((trn) => [
    formatDateTime(trn?.metadata?.updatedAt),
    `${titleCase(trn?.accessData?.trnType || trn?.trnType)} · ${
      String(trn?.accessData?.access?.hasAccess || "").toLowerCase() === "no"
        ? "No Access"
        : titleCase(trn?.executionOutcome?.outcome || "Completed")
    } · ${text(trn?.metadata?.updatedByUser)}`,
  ]);

  sections.push({
    title: `Everything done to this meter (${(transactions || []).length})`,
    rows: history.length ? history : [["", "Nothing beyond its registration."]],
  });

  return sections;
}

export async function buildMeterPdfArtifact({ meter, transactions = [] }) {
  const meterNo = text(meter?.ast?.astData?.astNo, "meter");
  const sections = meterSections(meter, transactions);

  const pdfDoc = await PDFDocument.create();
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  pdfDoc.setTitle(`Meter Report - ${meterNo}`);
  pdfDoc.setSubject(`iREPS meter report for ${meterNo}`);
  pdfDoc.setCreator("iREPS Report Platform");
  pdfDoc.setProducer("iREPS Report Platform");

  let page = null;
  let y = 0;

  function addPage() {
    page = pdfDoc.addPage([PAGE.width, PAGE.height]);
    y = PAGE.height - 120;

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
    page.drawText("METER REPORT", {
      x: PAGE.margin,
      y: PAGE.height - 65,
      size: 19,
      font: bold,
      color: COLORS.white,
    });
    page.drawText(winAnsi(`${meterNo}  ·  ${text(meter?.accessData?.premise?.address)}`), {
      x: PAGE.margin,
      y: PAGE.height - 82,
      size: 8.5,
      font: regular,
      color: rgb(0.82, 0.86, 0.93),
      maxWidth: PAGE.width - PAGE.margin * 2,
    });
  }

  function room(height) {
    if (!page || y - height < PAGE.margin) addPage();
  }

  function drawSection(section) {
    room(44);

    page.drawRectangle({
      x: PAGE.margin,
      y: y - 18,
      width: PAGE.width - PAGE.margin * 2,
      height: 22,
      color: COLORS.band,
    });
    page.drawText(winAnsi(section.title), {
      x: PAGE.margin + 8,
      y: y - 12,
      size: 10.5,
      font: bold,
      color: COLORS.ink,
    });

    y -= 32;

    const labelWidth = 150;
    const valueWidth = PAGE.width - PAGE.margin * 2 - labelWidth - 10;

    for (const [label, value] of section.rows) {
      const lines = wrapText(regular, value, 9.5, valueWidth);
      const height = Math.max(16, lines.length * 12 + 4);

      room(height + 6);

      page.drawText(winAnsi(label), {
        x: PAGE.margin,
        y: y - 10,
        size: 9,
        font: bold,
        color: COLORS.muted,
      });

      lines.forEach((line, index) => {
        page.drawText(line, {
          x: PAGE.margin + labelWidth,
          y: y - 10 - index * 12,
          size: 9.5,
          font: regular,
          color: COLORS.body,
        });
      });

      y -= height;

      page.drawLine({
        start: { x: PAGE.margin, y: y + 2 },
        end: { x: PAGE.width - PAGE.margin, y: y + 2 },
        thickness: 0.5,
        color: COLORS.line,
      });
    }

    y -= 12;
  }

  addPage();
  sections.forEach(drawSection);

  room(30);
  page.drawText(
    winAnsi(`Produced ${new Date().toISOString().slice(0, 19).replace("T", " ")} from iREPS. The transactions are the record; this sheet is a reading of them.`),
    {
      x: PAGE.margin,
      y: PAGE.margin - 10,
      size: 7.5,
      font: regular,
      color: COLORS.muted,
      maxWidth: PAGE.width - PAGE.margin * 2,
    },
  );

  const bytes = await pdfDoc.save();

  return {
    bytes,
    fileName: `meter_report_${sanitizeFileSegment(meterNo)}.pdf`,
    meterNo,
  };
}
