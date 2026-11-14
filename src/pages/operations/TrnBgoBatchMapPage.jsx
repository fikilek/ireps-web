import LoadingIndicator from "../../components/LoadingIndicator";
/* eslint-disable no-unused-vars -- JSX tags are consumed by the JSX transform. */
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { db } from "../../firebase";
import BgoBatchMap from "./md-bgo/BgoBatchMap";
import { subscribeTrnBgoMap } from "./md-bgo/trnBgoMapStream.js";

const text = (value) => String(value ?? "").trim();
const pretty = (value) => text(value).replaceAll("_", " ") || "NAv";

export default function TrnBgoBatchMapPage() {
  const [searchParams] = useSearchParams();
  const batchId = searchParams.get("batchId") || "";
  const { activeWorkbase, uid } = useAuth();
  const lmPcode = text(activeWorkbase?.lmPcode || activeWorkbase?.pcode || activeWorkbase?.id || activeWorkbase?.localMunicipalityId);
  const [result, setResult] = useState(null);
  useEffect(() => {
    if (!batchId || !lmPcode || !uid) return undefined;
    return subscribeTrnBgoMap(db, { batchId, lmPcode }, (value) => setResult({ ...value, batchId, lmPcode, uid }));
  }, [batchId, lmPcode, uid]);
  const data = result?.batchId === batchId && result?.lmPcode === lmPcode && result?.uid === uid ? result : null;
  const batch = data?.batch;
  const diagnostics = data?.diagnostics || {};
  const ready = data?.ready;
  const error = data?.error || (ready && !batch ? "The selected TRN BGO batch was not found." : "");
  const target = batch?.assignment?.targets?.[0];
  const identity = [
    ["Batch ID", batchId], ["Ward", batch?.scope?.wardName || batch?.scope?.wardPcode],
    ["Geofence", data?.geofence?.name || batch?.geofenceRef?.name],
    ["Allocated To", target?.name || batch?.bgo?.targetName || "Unallocated"],
    ["Batch Status", pretty(batch?.workflow?.state)],
  ];
  const missing = Number(diagnostics.missingErfCount || 0) + Number(diagnostics.missingPremiseCount || 0) + Number(diagnostics.missingMeterCount || 0) + Number(diagnostics.rowsMissingErfRef || 0);
  const missingFence = ready && !error && !data?.geofence;

  return <main style={{ display: "grid", gap: 18, padding: 24 }}>
    <header style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 18 }}>
      <div><p style={styles.eyebrow}>OPERATIONS / TRN BGO / BATCH MAP</p><h1 style={{ margin: "5px 0", color: "#0f172a", fontSize: 28 }}>TRN BGO Batch Map</h1><p style={{ margin: 0, color: "#64748b" }}>Live ERFs, premises and field meters linked to this batch’s TC Rows.</p></div>
      <nav style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <Link to="/operations/trn-bgo" style={styles.button}>Back to TRN BGO Register</Link>
        <Link to={`/operations/trn-bgo-rows?batchId=${encodeURIComponent(batchId)}`} style={{ ...styles.button, background: "#2563eb", color: "white" }}>Open TC Rows</Link>
      </nav>
    </header>
    {!batchId ? <p role="status" style={styles.notice}>Open a batch map from TRN BGO Register.</p> : null}
    {!lmPcode ? <p role="alert" style={styles.notice}>Activate a Local Municipality workbase before opening this map.</p> : null}
    {batchId && lmPcode && !ready ? <p role="status" style={styles.notice}><LoadingIndicator>Loading the live TRN BGO Batch Map…</LoadingIndicator></p> : null}
    {error ? <section role="alert" style={{ ...styles.notice, color: "#991b1b", background: "#fef2f2", borderColor: "#fecaca" }}><strong>TRN BGO Batch Map could not be loaded.</strong><div>{error}</div></section> : null}
    {batch && !error ? <section aria-label="Batch Details" style={styles.grid}>{identity.map(([label, value]) => <article key={label} style={styles.card}><span style={styles.label}>{label}</span><strong style={styles.value}>{value || "NAv"}</strong></article>)}</section> : null}
    {ready && batch && !error ? <>
      <section aria-label="Batch Asset Counts" style={styles.grid}>{[["Batch Rows", data.membership.rowCount], ["ERFs", data.erfs.length], ["Premises", data.premises.length], ["Field Meters", data.meters.length]].map(([label, count]) => <article key={label} style={styles.card}><span style={styles.label}>{label}</span><strong style={{ ...styles.value, fontSize: 25 }}>{count.toLocaleString("en-ZA")}</strong></article>)}</section>
      {missing || missingFence ? <section role="status" style={{ ...styles.notice, background: "#fffbeb", color: "#92400e" }}><strong>Some batch references could not be resolved.</strong><div>ERFs: {diagnostics.missingErfCount}; premises: {diagnostics.missingPremiseCount}; field meters: {diagnostics.missingMeterCount}; rows without an ERF: {diagnostics.rowsMissingErfRef}.{missingFence ? " The linked geofence could not be resolved." : ""}</div></section> : null}
      {!data.membership.rowCount ? <p role="status" style={styles.notice}>This batch has no TC Rows.</p> : null}
      <BgoBatchMap key={batchId} erfs={data.erfs} premises={data.premises} meters={data.meters} wards={data.wards} wardGeofences={data.wardGeofences} geofence={data.geofence} geofences={data.geofences} />
      <section aria-label="Spatial Coverage" style={styles.card}><h2 style={{ margin: "0 0 12px", fontSize: 18 }}>Spatial Coverage <small style={{ color: "#059669" }}>● Live</small></h2><div style={styles.grid}>{[["ERFs", diagnostics.erfsFound, diagnostics.erfRefs, diagnostics.erfsWithGeometry, "with geometry"], ["Premises", diagnostics.premisesFound, diagnostics.premiseRefs, diagnostics.premisesWithGps, "with GPS"], ["Field Meters", diagnostics.metersFound, diagnostics.meterRefs, diagnostics.metersWithGps, "with GPS"]].map(([label, found, referenced, spatial, helper]) => <div key={label}><strong>{label}</strong><div>{found} of {referenced} found · {spatial} {helper}</div></div>)}</div></section>
    </> : null}
  </main>;
}

const styles = {
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 },
  card: { minWidth: 0, padding: 16, background: "white", border: "1px solid #e2e8f0", borderRadius: 14 },
  label: { display: "block", color: "#64748b", fontSize: 11, fontWeight: 800, textTransform: "uppercase" },
  value: { display: "block", marginTop: 6, color: "#0f172a", overflowWrap: "anywhere" },
  eyebrow: { margin: 0, color: "#2563eb", fontSize: 11, fontWeight: 800, letterSpacing: ".08em" },
  notice: { margin: 0, padding: 16, background: "#eff6ff", border: "1px solid #cbd5e1", borderRadius: 12 },
  button: { display: "inline-flex", padding: "10px 14px", border: "1px solid #93c5fd", borderRadius: 10, color: "#1d4ed8", fontWeight: 800, textDecoration: "none" },
};
