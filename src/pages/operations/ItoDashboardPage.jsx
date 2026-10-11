/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
// The ITO monitoring screen. `DR-R001` 9.1, built to the owner's board.
//
// One screen, three views, one filter bar, every transaction type. This is
// the first view - per worker. Per area and on the map are marked where they
// go rather than left blank.
//
// IT IS WATCHING THE RECORD, NOT THE WORK (`DR-R001` 9). A worker can be at
// the meter with the job finished while this still reads Accepted, because
// his submission has not landed. So every row says when he was last heard
// from, and nothing here claims more than it knows.
import { useEffect, useMemo, useState } from "react";
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
import { NAV } from "./dashboard/operationsSummary";
import {
  ITO_STATES,
  ITO_TRN_LETTERS,
  ITO_TRN_TYPES,
  buildWorkerRows,
  describeAge,
  selectItoWork,
  summariseWorkers,
} from "./ito-dashboard/itoMonitoring";

const VIEWS = [
  { key: "worker", label: "Per worker", ready: true },
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
  const [trnTypes, setTrnTypes] = useState([]);
  const [states, setStates] = useState([]);

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

  const work = useMemo(
    () => selectItoWork(trns.data, { trnTypes, states }),
    [trns.data, trnTypes, states],
  );

  const rows = useMemo(
    () => buildWorkerRows({ trns: work, usersById, liveByUid, nowMs }),
    [work, usersById, liveByUid, nowMs],
  );

  const totals = useMemo(() => summariseWorkers(rows), [rows]);

  const figures = [
    { key: "issued", label: "Issued", value: totals.issued },
    { key: "accepted", label: "Accepted", value: totals.accepted },
    { key: "rejected", label: "Rejected", value: totals.rejected, attention: true },
    { key: "completed", label: "Completed", value: totals.completed },
    {
      key: "oldest",
      label: "Oldest waiting",
      value: describeAge(totals.oldestWaitingMs, nowMs),
    },
  ];

  const columns = [
    {
      key: "name",
      label: "Field worker",
      filter: "text",
      sortable: true,
      value: (row) => row.name,
      render: (row) => (
        <span>
          <span style={styles.workerName}>{row.name}</span>
          <span style={styles.workerRole}>{row.unheld ? "no holder" : row.role}</span>
        </span>
      ),
    },
    {
      key: "transactions",
      label: "Transactions",
      filter: "text",
      sortable: true,
      value: (row) => row.transactions,
    },
    { key: "issued", label: "Issued", align: "right", sortable: true, value: (row) => row.issued },
    { key: "accepted", label: "Accepted", align: "right", sortable: true, value: (row) => row.accepted },
    {
      key: "rejected",
      label: "Rejected",
      align: "right",
      sortable: true,
      value: (row) => row.rejected,
      render: (row) =>
        row.rejected > 0 ? <strong style={styles.rejected}>{row.rejected}</strong> : row.rejected,
    },
    { key: "completed", label: "Completed", align: "right", sortable: true, value: (row) => row.completed },
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
  ];

  return (
    <section style={styles.page}>
      <p style={styles.eyebrow}>
        <Link to="/operations/dashboard" style={styles.crumb}>
          Operations / Dashboard
        </Link>{" "}
        / ITO
      </p>
      <h2 style={styles.title}>ITO monitoring</h2>
      <p style={styles.lede}>
        Office-issued individual work in {lmName || NAV}
        {lmPcode ? ` (${lmPcode})` : ""}. Field work is not here — it reaches the
        server finished, so there is nothing to watch; read it in the TRN Registry.
      </p>

      <WardScopeHeader />

      <div style={styles.filters}>
        <div style={styles.filterGroup}>
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
        </div>

        <div style={styles.filterGroup}>
          <span style={styles.filterLabel}>State</span>
          {ITO_STATES.map((state) => (
            <label key={state.key} style={styles.tick}>
              <input
                type="checkbox"
                checked={states.includes(state.key)}
                onChange={() => setStates((list) => toggle(list, state.key))}
              />
              {state.label}
            </label>
          ))}
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

      {/* Nothing ticked means everything, which is what the office expects
          from a row of empty boxes. */}
      <p style={styles.hint}>
        Nothing ticked shows everything. {ready ? `${work.length} jobs in this ward.` : ""}
      </p>

      {!ready ? (
        <p style={styles.notice}>
          {lmPcode
            ? "Choose a ward above to load the monitoring."
            : "Activate a Local Municipality workbase to load the monitoring."}
        </p>
      ) : (
        <>
          <div style={styles.figures}>
            {figures.map((figure) => (
              <div
                key={figure.key}
                style={
                  figure.attention && Number(figure.value) > 0
                    ? { ...styles.figure, ...styles.figureAttention }
                    : styles.figure
                }
              >
                <p style={styles.figureValue}>{figure.value}</p>
                <p style={styles.figureLabel}>{figure.label}</p>
              </div>
            ))}
          </div>

          {view === "worker" ? (
            <IrepsTable
              title="Per worker"
              columns={columns}
              rows={rows}
              rowKey={(row, index) => row.uid || `unheld-${index}`}
              loading={trns.isLoading}
              emptyText="No office-issued work in this ward matches the ticks."
            />
          ) : null}
        </>
      )}
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
  crumb: { color: "#185FA5", textDecoration: "none" },
  title: { margin: 0, fontSize: 22, fontWeight: 600, color: "#0f172a" },
  lede: { margin: 0, fontSize: 13, color: "#475569" },
  filters: {
    display: "flex",
    gap: 16,
    flexWrap: "wrap",
    alignItems: "center",
    background: "#f6f9fe",
    border: "1px solid #dbe6f8",
    borderRadius: 12,
    padding: "10px 12px",
  },
  filterGroup: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
  filterLabel: {
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: "#64748b",
  },
  tick: { display: "flex", gap: 4, alignItems: "center", fontSize: 12, color: "#0f172a" },
  views: { display: "flex", gap: 6, marginLeft: "auto" },
  view: {
    border: "1px solid #c7d6ee",
    background: "#ffffff",
    color: "#334155",
    borderRadius: 999,
    padding: "5px 12px",
    fontSize: 12,
    cursor: "pointer",
  },
  viewOn: { background: "#11203c", color: "#ffffff", borderColor: "#11203c" },
  hint: { margin: 0, fontSize: 11, color: "#64748b" },
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
    flex: "1 1 120px",
    background: "#ffffff",
    border: "1px solid #dbe6f8",
    borderRadius: 10,
    padding: "9px 12px",
  },
  figureAttention: { background: "#fff5f5", border: "1px solid #f7c1c1" },
  figureValue: { margin: 0, fontSize: 20, fontWeight: 600, color: "#0f172a" },
  figureLabel: {
    margin: 0,
    fontSize: 10,
    letterSpacing: 0.3,
    textTransform: "uppercase",
    color: "#64748b",
  },
  workerName: { display: "block", fontWeight: 600, color: "#0f172a" },
  workerRole: { display: "block", fontSize: 11, color: "#64748b" },
  rejected: { color: "#A32D2D" },
};
