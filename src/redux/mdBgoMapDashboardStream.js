import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { subscribeMdBgoDashboard, emptyMdBgoDashboard } from "./mdBgoDashboardStream.js";
import { normalizeMapDashboardErf } from "../pages/operations/md-bgo/mdBgoMapDashboardModel.js";

export function mdBgoMapDashboardQueries(db, lmPcode) {
  return { lm: doc(db, "lms", lmPcode), geofences: query(collection(db, "geo_fences"), where("parents.lmPcode", "==", lmPcode)), erfs: query(collection(db, "ireps_erfs"), where("admin.localMunicipality.pcode", "==", lmPcode)) };
}

export function subscribeMdBgoMapDashboard(db, lmPcode, publish) {
  let active = true;
  let dashboard = emptyMdBgoDashboard();
  const extra = { lm: null, geofences: [], erfs: [] }, received = new Set(), errors = new Map(), stops = [];
  const emit = () => { if (active) publish({ ...dashboard, ...extra, ready: dashboard.ready && received.size === 3 && !errors.size, error: [dashboard.error, ...errors.values()].filter(Boolean).join(" ") }); };
  stops.push(subscribeMdBgoDashboard(db, lmPcode, value => { dashboard = value; emit(); }));
  try {
    Object.entries(mdBgoMapDashboardQueries(db, lmPcode)).forEach(([key, source]) => {
      stops.push(onSnapshot(source, { includeMetadataChanges: true }, snapshot => {
        if (snapshot.metadata.fromCache) return;
        received.add(key);
        if (key === "lm") {
          extra.lm = snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } : null;
          if (!extra.lm) errors.set(key, "The active municipality boundary document was not found."); else errors.delete(key);
        } else {
          extra[key] = snapshot.docs.map(item => key === "erfs" ? normalizeMapDashboardErf(item.id, item.data()) : { ...item.data(), id: item.id });
          errors.delete(key);
        }
        emit();
      }, error => { errors.set(key, `${key}: ${error.code || "read-error"}: ${error.message}`); emit(); }));
    });
  } catch (error) { errors.set("setup", error.message); emit(); }
  return () => { active = false; stops.forEach(stop => stop()); };
}
