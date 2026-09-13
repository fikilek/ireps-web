import { SALES_STATUSES } from "../sales/models/salesStatusModel.js";

// Targeted Batch rules 18.7 (1.3.2): nearby Sales status icons are a dark grey
// triangle (Not Started), an amber star (In Progress) and a green square
// (Completed), about the size of the draft's meter markers, with a white border.
// Paths are Google Maps Symbol paths centred on the meter position.
const STAR_PATH = "M 0,-1 L 0.2245,-0.309 L 0.9511,-0.309 L 0.3633,0.118 L 0.5878,0.809 L 0,0.382 L -0.5878,0.809 L -0.3633,0.118 L -0.9511,-0.309 L -0.2245,-0.309 Z";

export const SALES_ICON_SCALE = 13;

export const SALES_STATUS_GLYPHS = Object.freeze({
  [SALES_STATUSES.NOT_STARTED]: { shape: "triangle", path: "M 0,-1.1 L 1,0.7 L -1,0.7 Z", color: "#475569" },
  [SALES_STATUSES.IN_PROGRESS]: { shape: "star", path: STAR_PATH, color: "#f59e0b" },
  [SALES_STATUSES.COMPLETED]: { shape: "square", path: "M -0.8,-0.8 L 0.8,-0.8 L 0.8,0.8 L -0.8,0.8 Z", color: "#16a34a" },
});

// ERFs whose label would sit under a meter icon: the label then moves just below
// the icon (rules 18.7), so both stay readable. Points are { lat, lng }.
export const ERF_LABEL_BELOW_ICON_OFFSET = 24;

export function erfIdsUnderMeterIcons(erfs = [], points = [], toleranceMetres = 3) {
  const covered = new Set();
  const usable = (points || []).filter((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lng));
  for (const erf of erfs || []) {
    const centre = erf?.point;
    if (!Number.isFinite(centre?.lat) || !Number.isFinite(centre?.lng)) continue;
    const lngMetres = 111320 * Math.cos((centre.lat * Math.PI) / 180);
    if (usable.some((point) => Math.hypot((point.lat - centre.lat) * 110540, (point.lng - centre.lng) * lngMetres) <= toleranceMetres)) {
      covered.add(erf.id);
    }
  }
  return covered;
}
