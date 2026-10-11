/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
// The ITO monitoring screen. `DR-R001` 9.1, to the owner's board and his
// revision of it on 11 October 2026.
//
// One screen, three views, one filter bar. This is per worker; per area and
// on the map are next, and their pills switch to them.
//
// IT IS WATCHING THE RECORD, NOT THE WORK (`DR-R001` 9). A worker can be at
// the meter with the job finished while this still reads Accepted, because
// his submission has not landed. So every row says when he was last heard
// from, and nothing here claims more than it knows.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import IrepsTable from "../../components/table/IrepsTable";
import { useAuth } from "../../auth/useAuth";
import { useGeo } from "../../context/GeoContext";
import { useWarehouse } from "../../context/WarehouseContext";
import WardScopeHeader from "../ward-scope/components/WardScopeHeader";
import { useGetFwrLiveLocationsQuery } from "../../redux/fwrLiveLocationsApi";
import { useGetTrnsByLmPcodeWardPcodeQuery } from "../../redux/trnsApi";
import { useGetUsersDirectoryQuery } from "../../redux/usersApi";
import {
  getActiveLmName,
  getActiveLmPcode,
} from "./targeted-batches/dashboard/targetedBatchDashboardModel";
import { NAV, readTrnType } from "./dashboard/operationsSummary";
import {
  ITO_TRN_LETTERS,
  ITO_TRN_TYPES,
  buildWorkerRows,
  describeAge,
  describeTicks,
  isWaitingToBeGivenOut,
  monitoringAside,
  refusalsOn,
  selectItoWork,
  summariseWorkers,
} from "./ito-dashboard/itoMonitoring";

const VIEWS = [
  { key: "worker", label: "Per worker", ready: true },
  // `DR-R001` 9.2: Created needs a place to be seen, or a refused job falls
  // down a hole - nobody clicked a meter to make it, so no meter click will
  // find it again.
  { key: "created", label: "Waiting", ready: true },
  { key: "area", label: "Per area", ready: false },
  { key: "map", label: "On the map", ready: false },
];

const readWardPcode = (ward) =>
  String(ward?.wardPcode || ward?.pcode || ward?.id || "").trim();

function toggle(list, value) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export default function ItoDashboardPage() {
  const { activeWorkbase } = useAuth();
  const lmPcode = getActiveLmPcode(activeWorkbase);
  const lmName = getActiveLmName(activeWorkbase);

  const { geoState } = useGeo();
  const { scope } = useWarehouse();

  const wardPcode =
    String(scope?.wardPcode || "").trim() || readWardPcode(geoState?.selectedWard);

  // A ward is chosen before anything loads. `DR-R001` 9.1: work is allocated
  // per ward, and a municipality at once is tens of thousands of records.
  const ready = Boolean(lmPcode && wardPcode);

  const [view, setView] = useState("worker");

  // Only the transactions are ticked up here. The four states are columns on
  // the table now, and the table filters its own columns (owner, 11 October
  // 2026) - two places to narrow the same thing is one too many.
  const [trnTypes, setTrnTypes] = useState([]);

  // "Heard 4 min ago" has to keep counting, or the office reads a number
  // that froze when the page opened.
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNowMs(Date.now()), 30_000);

    return () => clearInterval(tick);
  }, []);

  const trns = useGetTrnsByLmPcodeWardPcodeQuery(
    { lmPcode, wardPcode },
    { skip: !ready },
  );

  const { data: usersData } = useGetUsersDirectoryQuery({ limit: 1000 }, { skip: !ready });
  const { data: liveData } = useGetFwrLiveLocationsQuery({ limit: 5000 }, { skip: !ready });

  const usersById = useMemo(() => {
    const list = usersData?.users || usersData?.items || usersData || [];
    const map = {};

    for (const user of Array.isArray(list) ? list : []) {
      const uid = String(user?.uid || user?.id || "").trim();

      if (uid) map[uid] = user;
    }

    return map;
  }, [usersData]);

  const liveByUid = useMemo(() => {
    const list = liveData?.locations || liveData?.items || liveData || [];
    const map = {};

    for (const row of Array.isArray(list) ? list : []) {
      const uid = String(row?.uid || row?.id || "").trim();

      if (uid) map[uid] = row;
    }

    return map;
  }, [liveData]);

  const work = useMemo(() => selectItoWork(trns.data, { trnTypes }), [trns.data, trnTypes]);

  // Everything waiting to be given out: made and not yet allocated, refused,
  // taken back, or expired. They all land in one place (`DR-R001` 5).
  const waiting = useMemo(
    () =>
      work
        .filter(isWaitingToBeGivenOut)
        .map((trn) => ({
          id: String(trn?.trnId || trn?.id || ""),
          letter: ITO_TRN_LETTERS[readTrnType(trn)] || NAV,
          meterNo: String(trn?.astNo || NAV),
          erfNo: String(trn?.erfNo || NAV),
          address: String(trn?.address || NAV),
          refusals: refusalsOn(trn),
          waitingSince: describeAge(
            Date.parse(String(trn?.lastUpdatedAt || trn?.issuedAt || "")) || null,
            nowMs,
          ),
        }))
        .sort((a, b) => String(a.meterNo).localeCompare(String(b.meterNo))),
    [work, nowMs],
  );

  const waitingColumns = useMemo(
    () => [
      { key: "meterNo", label: "Meter", filter: "text", sortable: true, minWidth: 140, value: (row) => row.meterNo },
      { key: "letter", label: "Work", filter: "text", sortable: true, value: (row) => row.letter },
      { key: "erfNo", label: "ERF", filter: "text", sortable: true, value: (row) => row.erfNo },
      { key: "address", label: "Address", filter: "text", sortable: true, value: (row) => row.address },
      {
        // Why it is here rather than with somebody. A job made and never
        // allocated has nothing to say, and says NAv rather than inventing
        // a reason it came back.
        key: "why",
        label: "Why it is waiting",
        sortable: true,
        value: (row) =>
          row.refusals.length
            ? `Refused by ${row.refusals[row.refusals.length - 1].name}: ${row.refusals[row.refusals.length - 1].reason}`
            : NAV,
      },
      { key: "waitingSince", label: "Waiting", align: "right", sortable: true, value: (row) => row.waitingSince },
    ],
    [],
  );

  const rows = useMemo(
    () => buildWorkerRows({ trns: work, usersById, liveByUid, nowMs }),
    [work, usersById, liveByUid, nowMs],
  );

  // The figures total THE ROWS THE TABLE IS SHOWING, not the whole ward, so
  // they can never disagree with what is beneath them. Tick DCN only, or
  // filter a column, and they move with it. A figure that stands apart from
  // its rows is how two places come to hold one number and drift.
  const [shownRows, setShownRows] = useState(null);

  // Stable, because IrepsTable reports its rows from an effect keyed on the
  // columns array - a new array each render would loop.
  const handleRowsShown = useCallback((shown) => setShownRows(shown), []);

  const visible = shownRows ?? rows;

  const ticks = describeTicks(trnTypes);

  const totals = useMemo(() => summariseWorkers(visible), [visible]);
  const aside = useMemo(() => monitoringAside(visible), [visible]);

  // The columns' totals over the rows shown. A refusal is not a column -
  // it is something a worker did, so it sits outside the total (`DR-R001` 5.1).
  const figures = [
    { key: "total", label: "Total", value: totals.total, lead: true },
    { key: "issued", label: "Issued", value: totals.issued },
    { key: "accepted", label: "Accepted", value: totals.accepted },
    { key: "completed", label: "Completed", value: totals.completed },
    { key: "refused", label: "Refused", value: totals.refused, attention: true },
    {
      key: "oldest",
      label: "Oldest waiting",
      value: describeAge(totals.oldestWaitingMs, nowMs),
      quiet: true,
    },
  ];

  const columns = useMemo(() => [
    {
      key: "name",
      label: "Field worker",
      filter: "text",
      sortable: true,
      minWidth: 170,
      value: (row) => row.name,
      render: (row) => (
        <span>
          <span style={styles.workerName}>{row.name}</span>
          <span style={styles.workerSub}>{row.unheld ? "no holder" : row.provider || row.role}</span>
        </span>
      ),
    },
    {
      // The total stands out from the states it is made of.
      key: "total",
      label: "Total",
      align: "right",
      sortable: true,
      value: (row) => row.total,
      render: (row) => <strong style={styles.total}>{row.total}</strong>,
    },
    { key: "issued", label: "Issued", align: "right", sortable: true, value: (row) => row.issued },
    { key: "accepted", label: "Accepted", align: "right", sortable: true, value: (row) => row.accepted },
    { key: "completed", label: "Completed", align: "right", sortable: true, value: (row) => row.completed },
    {
      // What he did, not what he holds — so it sits outside his Total.
      key: "refused",
      label: "Refused",
      align: "right",
      sortable: true,
      value: (row) => row.refused,
      render: (row) =>
        row.refused > 0 ? <strong style={styles.rejected}>{row.refused}</strong> : row.refused,
    },
    {
      key: "oldestWaiting",
      label: "Oldest waiting",
      align: "right",
      sortable: true,
      value: (row) => row.oldestWaiting,
      sortValue: (row) => row.oldestWaitingMs ?? Number.POSITIVE_INFINITY,
    },
    {
      key: "lastHeard",
      label: "Last heard from",
      sortable: true,
      value: (row) => row.lastHeard,
    },
  ], []);

  return (
    <section style={styles.page}>
      <div style={styles.head}>
        <div>
          <p style={styles.eyebrow}>
            <Link to="/operations/dashboard" style={styles.crumb}>
              Operations / Dashboard
            </Link>{" "}
            / ITO
          </p>
          <h2 style={styles.title}>ITO monitoring</h2>
        </div>

        <div style={styles.views}>
          {VIEWS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => item.ready && setView(item.key)}
              disabled={!item.ready}
              title={item.ready ? undefined : "Next"}
              style={view === item.key ? { ...styles.view, ...styles.viewOn } : styles.view}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <p style={styles.lede}>
        Office-issued individual work in {lmName || NAV}
        {lmPcode ? ` (${lmPcode})` : ""}. Field work is not here — it reaches the
        server finished, so there is nothing to watch; read it in the TRN Registry.
      </p>

      <WardScopeHeader />

      <div style={styles.filters}>
        <span style={styles.filterLabel}>Transactions</span>
        {ITO_TRN_TYPES.map((type) => (
          <label key={type} style={styles.tick}>
            <input
              type="checkbox"
              checked={trnTypes.includes(type)}
              onChange={() => setTrnTypes((list) => toggle(list, type))}
            />
            {ITO_TRN_LETTERS[type]}
          </label>
        ))}
        {/* Only there when there is something to clear, so it never sits
            dead on the bar - and its presence is itself the sign that a
            filter is on. It says how many it will clear. */}
        {ticks.count > 0 ? (
          <button type="button" onClick={() => setTrnTypes([])} style={styles.clear}>
            Clear {ticks.count} ×
          </button>
        ) : null}

        <span style={styles.hint}>
          {ticks.showing}
          {ready ? ` ${work.length} jobs in this ward.` : ""}
        </span>
      </div>

      {!ready ? (
        <p style={styles.notice}>
          {lmPcode
            ? "Choose a ward above to load the monitoring."
            : "Activate a Local Municipality workbase to load the monitoring."}
        </p>
      ) : view === "created" ? (
        <>
          <IrepsTable
            title="Waiting to be given out"
            columns={waitingColumns}
            rows={waiting}
            rowKey={(row, index) => row.id || `waiting-${index}`}
            loading={trns.isLoading}
            emptyText="Nothing is waiting to be allocated in this ward."
            stickyFirstColumn
          />

          <p style={styles.footnote}>
            Everything that came back is here — made and not yet allocated, refused
            by a worker, taken back by the office, or expired after three days of
            silence. Allocate from the meter, or delete it.
          </p>
        </>
      ) : view === "worker" ? (
        <>
          <div style={styles.figures}>
            {figures.map((figure) => (
              <div
                key={figure.key}
                style={{
                  ...styles.figure,
                  ...(figure.lead ? styles.figureLead : null),
                  ...(figure.attention && Number(figure.value) > 0 ? styles.figureAttention : null),
                  ...(figure.quiet ? styles.figureQuiet : null),
                }}
              >
                <p style={figure.lead ? { ...styles.figureValue, ...styles.figureValueLead } : styles.figureValue}>
                  {figure.value}
                </p>
                <p style={styles.figureLabel}>{figure.label}</p>
              </div>
            ))}
          </div>

          <IrepsTable
            title="Per worker"
            columns={columns}
            rows={rows}
            rowKey={(row, index) => row.uid || `unheld-${index}`}
            loading={trns.isLoading}
            emptyText="No office-issued work in this ward matches the ticks."
            // The worker's name never scrolls away from his numbers.
            stickyFirstColumn
            onRowsShown={handleRowsShown}
          />

          {/* Counted but given no column — said in words rather than dropped. */}
          {aside.length ? <p style={styles.aside}>{aside.join(" · ")}</p> : null}

          <p style={styles.footnote}>
            <strong>Oldest waiting</strong> is the oldest job still waiting on that
            worker, read from when it was issued. A job issued before that was
            recorded has no age and reads <strong>NAv</strong> — never 0, which would
            read as nothing waiting. {totals.workers} workers, {totals.total} jobs.
          </p>
        </>
      ) : null}
    </section>
  );
}

const styles = {
  page: { display: "flex", flexDirection: "column", gap: 12 },
  head: { display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" },
  eyebrow: {
    margin: 0,
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: "#64748b",
  },
  crumb: { color: "#185FA5", textDecoration: "none" },
  title: { margin: 0, fontSize: 22, fontWeight: 600, color: "#0f172a" },
  lede: { margin: 0, fontSize: 13, color: "#475569" },
  views: { display: "flex", gap: 6, marginLeft: "auto" },
  view: {
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#0f172a",
    borderRadius: 10,
    padding: "8px 15px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  viewOn: { background: "#0f172a", color: "#ffffff", borderColor: "#0f172a" },
  filters: {
    display: "flex",
    gap: 14,
    flexWrap: "wrap",
    alignItems: "center",
    background: "#f6f9fe",
    border: "1px solid #dbe6f8",
    borderRadius: 12,
    padding: "10px 12px",
  },
  filterLabel: {
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: "#64748b",
  },
  tick: { display: "flex", gap: 5, alignItems: "center", fontSize: 13, color: "#0f172a" },
  clear: {
    border: "1px solid #c7d6ee",
    background: "#ffffff",
    color: "#185FA5",
    borderRadius: 999,
    padding: "4px 12px",
    fontSize: 12,
    cursor: "pointer",
  },
  hint: { marginLeft: "auto", fontSize: 11, color: "#64748b" },
  notice: {
    margin: 0,
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #dbe6f8",
    background: "#f6f9fe",
    fontSize: 13,
    color: "#334155",
  },
  figures: { display: "flex", gap: 8, flexWrap: "wrap" },
  figure: {
    flex: "1 1 110px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    padding: "10px 13px",
  },
  figureLead: { borderColor: "#0f172a" },
  figureAttention: { background: "#fff5f5", borderColor: "#fecaca" },
  figureQuiet: { borderStyle: "dashed", borderColor: "#b45309" },
  figureValue: { margin: 0, fontSize: 22, fontWeight: 600, color: "#0f172a" },
  figureValueLead: { fontSize: 26, fontWeight: 700 },
  figureLabel: {
    margin: 0,
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: "#64748b",
  },
  workerName: { display: "block", fontWeight: 600, color: "#0f172a" },
  workerSub: { display: "block", fontSize: 11, color: "#64748b" },
  total: { fontSize: 15, fontWeight: 700, color: "#0f172a" },
  rejected: { color: "#A32D2D" },
  aside: { margin: 0, fontSize: 12, color: "#78350f" },
  footnote: { margin: 0, fontSize: 12, lineHeight: 1.5, color: "#475569" },
};
