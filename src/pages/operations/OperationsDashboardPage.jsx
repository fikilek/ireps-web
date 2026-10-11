/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
// Operations has one dashboard, and it is the way into the others. `UI-R009`.
//
// Owner, 11 October 2026: "We do not want to see all the dashboards under
// operations. We only have one dashboard, and then inside that dashboard,
// that's where we're going to have the three pages where we're gonna go to
// the individual dashboards."
//
// The three pages are NOT merged - "We're not changing them. We're just
// changing the access." This page is light on purpose: a short summary per
// lane and a way in. The detail lives inside each dashboard.
import { useMemo } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../../auth/useAuth";
import { useGeo } from "../../context/GeoContext";
import { useWarehouse } from "../../context/WarehouseContext";
import WardScopeHeader from "../ward-scope/components/WardScopeHeader";
import { useGetBgoBatchesByLmQuery } from "../../redux/bgoApi";
import { useGetTrnsByLmPcodeWardPcodeQuery } from "../../redux/trnsApi";
import { useGetTargetedBatchHeadersByLmQuery } from "../../redux/salesTargetedBatchApi";
import {
  getActiveLmName,
  getActiveLmPcode,
} from "./targeted-batches/dashboard/targetedBatchDashboardModel";
import {
  NAV,
  batchFigures,
  itoAside,
  itoFigures,
  summariseBatches,
  summariseIto,
} from "./dashboard/operationsSummary";

const readWardPcode = (ward) =>
  String(ward?.wardPcode || ward?.pcode || ward?.id || "").trim();

const tbStatusOf = (batch) =>
  batch?.execution?.status || batch?.executionStatus || batch?.status || "";

const tbWardOf = (batch) =>
  batch?.scope?.wardPcode || batch?.sourceUpload?.wardPcode || batch?.wardPcode || "";

const bgoStatusOf = (batch) =>
  batch?.workflowState || batch?.workflow?.state || batch?.state || "";

const bgoWardOf = (batch) =>
  batch?.scope?.wardPcode || batch?.sourceUpload?.wardPcode || batch?.origin?.wardPcode || "";

export default function OperationsDashboardPage() {
  const { activeWorkbase } = useAuth();
  const lmPcode = getActiveLmPcode(activeWorkbase);
  const lmName = getActiveLmName(activeWorkbase);

  const { geoState } = useGeo();
  const { scope } = useWarehouse();

  const wardPcode =
    String(scope?.wardPcode || "").trim() || readWardPcode(geoState?.selectedWard);

  // A ward is chosen before anything loads. `UI-R009` 4, `DR-R001` 9.1: a
  // municipality at once is tens of thousands of transactions and no screen
  // survives that.
  const ready = Boolean(lmPcode && wardPcode);

  const trns = useGetTrnsByLmPcodeWardPcodeQuery(
    { lmPcode, wardPcode },
    { skip: !ready },
  );

  const tb = useGetTargetedBatchHeadersByLmQuery(lmPcode, { skip: !ready });
  const bgo = useGetBgoBatchesByLmQuery({ lmPcode }, { skip: !ready });

  const itoSummary = useMemo(() => summariseIto(trns.data), [trns.data]);

  const tbSummary = useMemo(
    () =>
      summariseBatches(tb.data?.items, {
        statusOf: tbStatusOf,
        wardOf: tbWardOf,
        wardPcode,
      }),
    [tb.data?.items, wardPcode],
  );

  const bgoSummary = useMemo(
    () =>
      summariseBatches(bgo.data, {
        statusOf: bgoStatusOf,
        wardOf: bgoWardOf,
        wardPcode,
      }),
    [bgo.data, wardPcode],
  );

  const lanes = [
    {
      key: "tb",
      name: "TB",
      what: "Targeted batches",
      figures: batchFigures(tbSummary, { ready }),
      to: "/operations/tb-dashboard",
      open: "Open TB dashboard",
      summary: tbSummary,
    },
    {
      key: "bgo",
      name: "BGO",
      what: "Bulk geofence work",
      figures: batchFigures(bgoSummary, { ready }),
      to: "/operations/bgo-dashboard",
      open: "Open BGO dashboard",
      summary: bgoSummary,
    },
    {
      key: "ito",
      name: "ITO",
      what: "Individually originated",
      figures: itoFigures(itoSummary, { ready }),
      aside: itoAside(itoSummary),
      to: "/operations/ito-dashboard",
      open: "Open ITO dashboard",
      summary: itoSummary,
    },
  ];

  return (
    <section style={styles.page}>
      <p style={styles.eyebrow}>Operations / Dashboard</p>
      <h2 style={styles.title}>Dashboard</h2>
      <p style={styles.lede}>
        Targeted batches, bulk geofence work and individually originated work
        for {lmName || NAV}
        {lmPcode ? ` (${lmPcode})` : ""}. Choose a ward to load it.
      </p>

      <WardScopeHeader />

      {!ready ? (
        <p style={styles.notice}>
          {lmPcode
            ? "Choose a ward above to load the summaries."
            : "Activate a Local Municipality workbase to load the dashboard."}
        </p>
      ) : null}

      <div style={styles.grid}>
        {lanes.map((lane) => (
          <article key={lane.key} style={styles.card}>
            <div style={styles.cardHead}>
              <p style={styles.laneName}>{lane.name}</p>
              <p style={styles.laneWhat}>{lane.what}</p>
            </div>

            <div style={styles.figures}>
              {lane.figures.map((figure) => (
                <div
                  key={figure.key}
                  style={
                    figure.attention && ready && Number(figure.value) > 0
                      ? { ...styles.figure, ...styles.figureAttention }
                      : styles.figure
                  }
                >
                  <p style={styles.figureValue}>{figure.value}</p>
                  <p style={styles.figureLabel}>{figure.label}</p>
                </div>
              ))}
            </div>

            {/* Counted but given no tile - said in words rather than
                dropped. Cancelled jobs, and the case where rows arrived and
                none of them counted, which is "nothing counted" and not
                "nothing out". */}
            {ready && lane.aside?.length ? (
              <p style={styles.aside}>{lane.aside.join(" · ")}</p>
            ) : null}

            {/* A state nobody gave a figure is shown, never dropped. The
                alternative is the fault of 11 October: counted in one place
                and drawn in none, with nothing saying why. */}
            {ready && lane.summary?.unaccounted?.length ? (
              <p style={styles.unaccounted}>
                {lane.summary.unaccounted.length} not in any figure:{" "}
                {Array.from(new Set(lane.summary.unaccounted)).join(", ")}
              </p>
            ) : null}

            {lane.to ? (
              <Link to={lane.to} style={styles.open}>
                {lane.open}
              </Link>
            ) : (
              <p style={styles.openPending}>{lane.open}</p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

const styles = {
  page: { display: "flex", flexDirection: "column", gap: 12 },
  eyebrow: {
    margin: 0,
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: "#64748b",
  },
  title: { margin: 0, fontSize: 22, fontWeight: 600, color: "#0f172a" },
  lede: { margin: 0, fontSize: 13, color: "#475569" },
  notice: {
    margin: 0,
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #dbe6f8",
    background: "#f6f9fe",
    fontSize: 13,
    color: "#334155",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: 12,
  },
  card: {
    background: "#eef4fd",
    border: "1px solid #d6e4f8",
    borderRadius: 14,
    padding: 14,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  cardHead: { display: "flex", flexDirection: "column", gap: 2 },
  laneName: { margin: 0, fontSize: 16, fontWeight: 600, color: "#0f172a" },
  laneWhat: { margin: 0, fontSize: 12, color: "#4d6b96" },
  figures: { display: "flex", gap: 6, flexWrap: "wrap" },
  figure: {
    flex: "1 1 64px",
    background: "#ffffff",
    border: "1px solid #dbe6f8",
    borderRadius: 10,
    padding: "7px 9px",
  },
  figureAttention: { background: "#fff5f5", border: "1px solid #f7c1c1" },
  figureValue: { margin: 0, fontSize: 16, fontWeight: 600, color: "#0f172a" },
  figureLabel: {
    margin: 0,
    fontSize: 10,
    letterSpacing: 0.3,
    textTransform: "uppercase",
    color: "#64748b",
  },
  aside: { margin: 0, fontSize: 11, color: "#4d6b96" },
  unaccounted: { margin: 0, fontSize: 11, color: "#A32D2D" },
  open: {
    display: "block",
    textAlign: "center",
    background: "#11203c",
    color: "#ffffff",
    borderRadius: 10,
    padding: "9px 10px",
    fontSize: 13,
    fontWeight: 600,
    textDecoration: "none",
  },
  openPending: {
    margin: 0,
    textAlign: "center",
    background: "#ffffff",
    color: "#64748b",
    border: "1px dashed #c7d6ee",
    borderRadius: 10,
    padding: "9px 10px",
    fontSize: 13,
  },
};
