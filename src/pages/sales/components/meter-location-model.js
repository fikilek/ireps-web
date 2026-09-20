// Targeted Batch rules TB-R061 (1.3.64): the Meter Location window on the Sales tables draws the
// ERF the meter sits on and answers "is this meter where it should be?" without leaving the table.
// Only the three statuses (Not Started, In Progress, Completed), and where a detail cannot be read
// the window says so in plain words instead of showing a blank.
import { classifySalesTableWorkStatus } from "../models/salesTableWorkStatusModel.js";
import { readTbRefBatchId, resolveSalesTargetedBatchMembership } from "../../../../functions/salesAllMeters/sales-batch-policy.js";
import { NO_GEOFENCE_LABEL } from "../../operations/targeted-batches/batch-geofence-label.js";
import { allocationText, workStatusText } from "./sales-tb-refs-model.js";

const text = (value, fallback = "") => String(value ?? "").trim() || fallback;

// A place to draw: one ERF candidate, or the ERF already saved on the meter. Candidates without
// coordinates are kept, because their ERF can still be drawn from the ERF's own boundary.
export function meterLocationPlaces(row = {}) {
  const candidates = Array.isArray(row?.erfCandidates) ? row.erfCandidates : [];
  const places = candidates
    .map((candidate, index) => ({
      key: `candidate-${text(candidate?.erfId) || text(candidate?.erfNumber) || "erf"}-${index}`,
      source: "CANDIDATE",
      erfId: text(candidate?.erfId),
      erfNumber: text(candidate?.erfNumber),
      wardNumber: text(candidate?.wardNumber),
      point:
        candidate?.hasValidGps === true &&
        Number.isFinite(candidate?.latitude) &&
        Number.isFinite(candidate?.longitude)
          ? { lat: Number(candidate.latitude), lng: Number(candidate.longitude) }
          : null,
    }))
    .filter((place) => place.point || place.erfId);

  // TB-R041: a saved erfId is the meter's ERF and candidates never override it. When it is not
  // among the candidates it is drawn as well, so a Non-GPS meter is not left with an empty window.
  const savedErfId = text(row?.erfId);
  if (savedErfId && !places.some((place) => place.erfId === savedErfId)) {
    places.push({
      key: `saved-${savedErfId}`,
      source: "SAVED",
      erfId: savedErfId,
      erfNumber: text(row?.erfNo),
      wardNumber: "",
      point: null,
    });
  }

  return places;
}

export function meterLocationSubtitle(places = []) {
  const list = Array.isArray(places) ? places : [];
  if (list.length === 0) return "No ERF and no coordinates yet";
  if (list.length === 1) return "One ERF";
  return `${list.length} ERF candidates`;
}

export function erfPlaceTitle(place = {}, index = 0, total = 1) {
  const number = text(place?.erfNumber, "NAv");
  const prefix = total > 1 ? `${index + 1}. ` : "";
  const saved = place?.source === "SAVED" ? " (the meter's saved ERF)" : "";
  return `${prefix}ERF ${number}${saved}`;
}

// What the window says about one ERF's outline while it is being read, and when it cannot be read.
export function erfShapeNote(state = {}) {
  if (!text(state?.erfId)) return "This candidate has no ERF ID, so its outline cannot be drawn.";
  if (state?.drawn) return "Outline drawn on the map.";
  if (state?.loading) return "Reading the ERF's outline…";
  return "The ERF's outline could not be read.";
}

// TB-R054: the row status the Sales table already works out. Never a fourth word.
export function meterStatusCode(row = {}) {
  return text(row?.salesWorkStatus) || classifySalesTableWorkStatus(row);
}

export function meterStatusText(row = {}) {
  return workStatusText(meterStatusCode(row));
}

export function meterAddressText(row = {}) {
  const line = text(row?.addressLine1);
  if (line) return line;

  const parts = [row?.adr?.strNo, row?.adr?.strName, row?.adr?.strType].map((part) => text(part)).filter(Boolean);
  return parts.join(" ") || "This meter has no street address on its Sales record.";
}

export function meterTownText(row = {}) {
  return text(row?.town) || "No town on this meter's Sales record.";
}

export function meterWardText(row = {}) {
  const label = text(row?.wardNumberLabel);
  if (label && label !== "NAv") return `Ward ${label}`;
  return "No Ward on this meter's Sales record.";
}

// Which batch the window should read, and what it says when there is nothing to read.
export function meterBatchTarget(row = {}) {
  const membership = resolveSalesTargetedBatchMembership(row);
  if (membership.state === "MEMBER") return { tbId: membership.tbId, note: "" };
  if (membership.state === "NONE") return { tbId: "", note: "This meter is not in a Targeted Batch." };
  return { tbId: "", note: "This meter's batch cannot be read: its Targeted Batch references are unresolved." };
}

// The batch lines: the TB ID, the geofence and the team or service provider it is allocated to.
export function meterBatchLines({ tbId = "", batch = null, geofence = null, ready = false } = {}) {
  if (!text(tbId)) return { note: "", lines: [] };
  if (!batch) {
    return {
      note: ready ? "This batch cannot be read. It may have been deleted." : "Reading the batch…",
      lines: [["TB ID", text(tbId)]],
    };
  }

  return {
    note: "",
    lines: [
      ["TB ID", text(tbId)],
      ["Geofence", !text(batch?.geofenceId) ? NO_GEOFENCE_LABEL : text(geofence?.name) || text(batch.geofenceId)],
      ["Allocated to", allocationText(batch)],
    ],
  };
}

// The premise, when the meter has one. Sales keeps the premise only against a batch reference,
// so a meter found on the normal path has none to show, and the window says that plainly.
export function meterPremise({ row = {}, tbId = "", batchRow = null, premiseAddress = "" } = {}) {
  const refs = Array.isArray(row?.tbRefs) ? row.tbRefs : [];
  const reference = text(tbId) ? refs.find((item) => readTbRefBatchId(item) === tbId) : null;
  const id =
    text(reference?.fieldWork?.premiseId) ||
    text(batchRow?.premiseId) ||
    text(batchRow?.refs?.premiseId);

  if (!id) {
    return {
      has: false,
      id: "",
      address: "",
      note: "No premise recorded for this meter yet. A premise is made when the meter is found in the field.",
    };
  }

  const address = text(premiseAddress);
  return {
    has: true,
    id,
    address,
    note: address ? "" : "The premise's own address is not read in this window.",
  };
}
