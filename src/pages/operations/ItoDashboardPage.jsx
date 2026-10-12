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
import { skipToken } from "@reduxjs/toolkit/query";
import { Link, useNavigate } from "react-router-dom";

import IrepsTable from "../../components/table/IrepsTable";
// THE SAME CHIP THE METER REGISTRY USES. Owner, 12 October 2026, holding the
// two screens side by side: "can we be consistent with css". A meter, an ERF
// and an address are the same three things on both, so they are drawn by the
// same component - which moved out of the registry page so that was possible.
import DataActionButton, {
  AllocateActionIcon,
  BinActionIcon,
  ErfActionIcon,
  MeterActionIcon,
  PremiseActionIcon,
  RestoreActionIcon,
  WorkerActionIcon,
} from "../../components/table/DataActionButton";
// The windows the registries already open. A row here opens the SAME meter
// window the TRN Registry opens, and the SAME map the Meter Registry opens -
// one window for one thing, reached from wherever the office is standing.
import BoundaryMapModal from "../registries/components/BoundaryMapModal";
import MeterDeepDetailsModal from "../registries/components/MeterDeepDetailsModal";
import { useAuth } from "../../auth/useAuth";
import { useGeo } from "../../context/GeoContext";
import { useWarehouse } from "../../context/WarehouseContext";
import WardScopeHeader from "../ward-scope/components/WardScopeHeader";
import { useGetFwrLiveLocationsQuery } from "../../redux/fwrLiveLocationsApi";
import { useGetTrnsByLmPcodeWardPcodeQuery } from "../../redux/trnsApi";
import {
  useGetMeterByIdQuery,
  useGetPremiseByIdQuery,
} from "../../redux/creditControlApi";
import { useGetUsersDirectoryQuery } from "../../redux/usersApi";
import {
  getActiveLmName,
  getActiveLmPcode,
} from "./targeted-batches/dashboard/targetedBatchDashboardModel";
import { NAV, readTrnType } from "./dashboard/operationsSummary";
import {
  ITO_TRN_LETTERS,
  ITO_TRN_TYPES,
  buildDeletedRows,
  buildWaitingRows,
  buildWorkerJobRows,
  countWorkerCompleted,
  buildWorkerRows,
  describeAge,
  describeTicks,
  monitoringAside,
  selectItoWork,
  summariseWorkers,
} from "./ito-dashboard/itoMonitoring";
import SubmitWindow from "../../components/submit/SubmitWindow";
import { manageItoWork } from "../../components/ito/manageItoWork";
import {
  ITO_MANAGE_ACTIONS,
  buildManageRequest,
  canManageItoWork,
} from "../../components/ito/manageItoRequest";

const VIEWS = [
  { key: "worker", label: "Per worker", ready: true },
  // `DR-R001` 9.2: Created needs a place to be seen, or a refused job falls
  // down a hole - nobody clicked a meter to make it, so no meter click will
  // find it again.
  { key: "created", label: "Waiting", ready: true },
  // `DR-R001` 5.5: a delete can be restored, and until this view existed
  // nothing could ask for that - the office had no way to see the bin, so
  // RESTORE was reachable by no human.
  { key: "deleted", label: "Deleted", ready: true },
  { key: "area", label: "Per area", ready: false },
  { key: "map", label: "On the map", ready: false },
];

const readWardPcode = (ward) =>
  String(ward?.wardPcode || ward?.pcode || ward?.id || "").trim();

function toggle(list, value) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export default function ItoDashboardPage() {
  const { activeWorkbase, role } = useAuth();
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
  // taken back, or expired. They all land in one place (`DR-R001` 5). The row
  // is built in the well beside the per-worker rows, so the three views
  // cannot format one meter three ways.
  const waiting = useMemo(() => buildWaitingRows(work, nowMs), [work, nowMs]);

  // The bin. It is the ONE reader that asks for deleted work by name
  // (`DR-R001` 5.5), through the same selector, so it keeps the
  // office-channel and transaction-type narrowing every other view has.
  const binned = useMemo(
    () => selectItoWork(trns.data, { trnTypes, deleted: "only" }),
    [trns.data, trnTypes],
  );

  const deletedRows = useMemo(() => buildDeletedRows(binned, nowMs), [binned, nowMs]);

  // DR-R001 3.5 and the owner's submit standard: a confirmation window
  // before, visible progress during, a result window after. It writes a
  // record, so a single unconfirmed click will not do.
  // The three windows a row can open: the meter, the map, and the ITO page.
  // `DR-R001` 9.2 - the Waiting view is where the office picks a job up
  // again, so everything it needs to decide is one click away.
  const navigate = useNavigate();
  const [meterTrnId, setMeterTrnId] = useState(null);
  const [mapView, setMapView] = useState(null);

  // The premise and the meter, for the pins. Read only when a map is open.
  const { data: pinMeter } = useGetMeterByIdQuery(mapView?.astId || skipToken);
  const { data: pinPremise } = useGetPremiseByIdQuery(mapView?.premiseId || skipToken);

  const mapPins = useMemo(() => {
    // `withPins` is false for the ERF button: that one is asked about the
    // ERF, and pinning the premise and meter on it would answer a different
    // question.
    if (!mapView?.withPins) return [];

    const pins = [];

    const premiseLat = Number(pinPremise?.location?.lat ?? pinPremise?.gps?.lat);
    const premiseLng = Number(pinPremise?.location?.lng ?? pinPremise?.gps?.lng);

    if (Number.isFinite(premiseLat) && Number.isFinite(premiseLng)) {
      pins.push({
        kind: "PREMISE",
        lat: premiseLat,
        lng: premiseLng,
        label: pinPremise?.address || mapView?.address || "Premise",
      });
    }

    const meterLat = Number(pinMeter?.ast?.location?.gps?.lat ?? pinMeter?.ast?.location?.lat);
    const meterLng = Number(pinMeter?.ast?.location?.gps?.lng ?? pinMeter?.ast?.location?.lng);

    if (Number.isFinite(meterLat) && Number.isFinite(meterLng)) {
      pins.push({
        kind: "METER",
        lat: meterLat,
        lng: meterLng,
        label: pinMeter?.ast?.astData?.astNo || mapView?.meterNo || "Meter",
      });
    }

    // NOTHING IS PINNED AT NOWHERE. A premise or a meter with no position
    // gets no pin, and the map says the ERF alone - which is the honest
    // answer, and a gap worth seeing (`UI-R008`).
    return pins;
  }, [mapView, pinMeter, pinPremise]);

  // THE WORKER'S OWN PAGE. `DR-R001` 9.3, the owner 11 October 2026: "a
  // click on a FWR (Kaiser) must open a 'FWR ITO PAGE' where we can see all
  // his trns. That's where we can unallocate or delete."
  //
  // It is a view of this screen rather than a route of its own, so it keeps
  // the ward that was chosen above it. Nothing in iREPS loads before a ward.
  const [worker, setWorker] = useState(null);

  const workerJobs = useMemo(
    () => buildWorkerJobRows(work, worker?.uid, nowMs),
    [work, worker, nowMs],
  );

  const workerCompleted = useMemo(
    () => countWorkerCompleted(work, worker?.uid),
    [work, worker],
  );

  // Which of his jobs the office has ticked. `DR-R001` 9.3: this page is
  // about one man's LOAD, and the owner's own case for the override is the
  // bulk one - "he's hit by a car, he's in hospital". That is not one job.
  const [picked, setPicked] = useState(() => new Set());

  // A tick on a job that has since left his page is a tick on nothing.
  const pickable = useMemo(
    () => workerJobs.filter((row) => !row.unplaceable).map((row) => row.id),
    [workerJobs],
  );

  const pickedHere = useMemo(
    () => pickable.filter((id) => picked.has(id)),
    [pickable, picked],
  );

  const [asking, setAsking] = useState(null);
  const [reason, setReason] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [outcome, setOutcome] = useState(null);

  /** Open one man's page - or, for work nobody holds, the pool it sits in. */
  function openWorker(row) {
    if (row.unheld) {
      setView("created");
      return;
    }

    setWorker({
      uid: row.uid,
      name: row.name,
      role: row.role,
      provider: row.provider,
      lastHeard: row.lastHeard,
    });
  }

  function ask(action, row) {
    setReason("");
    setOutcome(null);
    setAsking({ action, rows: [row] });
  }

  /** Everything the office has ticked on his page, in one act. */
  function askForAll(rows) {
    setReason("");
    setOutcome(null);
    setAsking({ action: "CANCEL", rows });
  }

  async function act() {
    const { action, rows } = asking;
    const built = buildManageRequest({
      action,
      trnIds: rows.map((row) => row.id),
      reason,
    });

    if (!built.ok) {
      setOutcome({ ok: false, wrote: false, message: built.message });
      return;
    }

    setAsking(null);
    setBusyId(rows.length === 1 ? rows[0].id : "ALL");

    const result = await manageItoWork({ request: built.request });

    setBusyId(null);
    setOutcome({ ...result, action, rows });

    // A tick on a job that has gone is a tick on nothing.
    if (result.ok) setPicked(new Set());
  }

  const waitingColumns = useMemo(
    () => [
      {
        key: "meterNo",
        label: "Meter",
        filter: "text",
        sortable: true,
        minWidth: 140,
        value: (row) => row.meterNo,
        // The same window the TRN Registry opens for a meter. One window for
        // one thing, wherever the office is standing.
        render: (row) => (
          <DataActionButton
            icon={<MeterActionIcon />}
            onClick={() => setMeterTrnId(row.id)}
            title={`Everything iREPS holds about meter ${row.meterNo}`}
          >
            {row.meterNo}
          </DataActionButton>
        ),
      },
      { key: "letter", label: "Work", filter: "text", sortable: true, value: (row) => row.letter },
      {
        key: "erfNo",
        label: "ERF",
        filter: "text",
        sortable: true,
        value: (row) => row.erfNo,
        render: (row) =>
          row.erfId ? (
            <DataActionButton
              icon={<ErfActionIcon />}
              onClick={() => setMapView({ ...row, withPins: false })}
              title={`ERF ${row.erfNo} on the map`}
            >
              {row.erfNo}
            </DataActionButton>
          ) : (
            // No ERF id, no boundary to draw. Said rather than offered as a
            // button that does nothing.
            row.erfNo
          ),
      },
      {
        key: "address",
        label: "Address",
        filter: "text",
        sortable: true,
        value: (row) => row.address,
        render: (row) =>
          row.erfId ? (
            <DataActionButton
              icon={<PremiseActionIcon />}
              onClick={() => setMapView({ ...row, withPins: true })}
              title="The premise and the meter on the map"
            >
              {row.address}
            </DataActionButton>
          ) : (
            row.address
          ),
      },
      // WHO refused it and WHY, in two columns (owner, 12 October 2026), so
      // each can be filtered and sorted on its own.
      { key: "rejectedBy", label: "Rejected by", filter: "text", sortable: true, value: (row) => row.rejectedBy },
      { key: "rejectedReason", label: "Rejected reason", filter: "text", sortable: true, value: (row) => row.rejectedReason },
      { key: "waitingSince", label: "Waiting", align: "right", sortable: true, value: (row) => row.waitingSince },
      {
        // Back to the page that allocates it. The ITO page was built to
        // allocate a transaction that already exists (`DR-R001` 3.4), which
        // is exactly what every row here is.
        key: "ito",
        label: "ITO page",
        align: "right",
        sortable: false,
        render: (row) =>
          row.astId && row.work ? (
            <DataActionButton
              compact
              icon={<AllocateActionIcon />}
              onClick={() =>
                navigate(
                  `/operations/ito/${row.astId}/${row.work}?trn=${encodeURIComponent(row.id)}`,
                )
              }
              title={`Allocate this ${row.letter} to a field worker`}
            >
              Allocate
            </DataActionButton>
          ) : (
            NAV
          ),
      },
      // Only for somebody who may actually do it. A reader sees the screen
      // and no column, rather than buttons that refuse (`DR-R001` 5.5).
      ...(canManageItoWork(role)
        ? [
            {
              key: "actions",
              label: "",
              align: "right",
              sortable: false,
              render: (row) => (
                <DataActionButton
                  compact
                  tone="remove"
                  icon={<BinActionIcon />}
                  busy={busyId === row.id}
                  disabled={Boolean(busyId) && busyId !== row.id}
                  onClick={() => ask("DELETE", row)}
                  title={`Delete the ${row.letter} on meter ${row.meterNo}`}
                >
                  Delete
                </DataActionButton>
              ),
            },
          ]
        : []),
    ],
    // The columns close over the role, the busy row and the three windows'
    // setters, so they cannot be memoised on an empty list - they would go
    // stale the moment a button is pressed and never show their spinner.
    [role, busyId, navigate],
  );

  const workerJobColumns = useMemo(
    () => [
      ...(canManageItoWork(role)
        ? [
            {
              key: "pick",
              label: "",
              sortable: false,
              render: (row) =>
                row.unplaceable ? null : (
                  <input
                    type="checkbox"
                    checked={picked.has(row.id)}
                    aria-label={`Choose the ${row.letter} on meter ${row.meterNo}`}
                    onClick={(event) => event.stopPropagation()}
                    onChange={() =>
                      setPicked((current) => {
                        const next = new Set(current);

                        if (next.has(row.id)) next.delete(row.id);
                        else next.add(row.id);

                        return next;
                      })
                    }
                  />
                ),
            },
          ]
        : []),
      {
        key: "meterNo",
        label: "Meter",
        filter: "text",
        sortable: true,
        minWidth: 140,
        value: (row) => row.meterNo,
        render: (row) => (
          <DataActionButton
            icon={<MeterActionIcon />}
            onClick={() => setMeterTrnId(row.id)}
            title={`Everything iREPS holds about meter ${row.meterNo}`}
          >
            {row.meterNo}
          </DataActionButton>
        ),
      },
      { key: "letter", label: "Work", filter: "text", sortable: true, value: (row) => row.letter },
      {
        key: "erfNo",
        label: "ERF",
        filter: "text",
        sortable: true,
        value: (row) => row.erfNo,
        render: (row) =>
          row.erfId ? (
            <DataActionButton
              icon={<ErfActionIcon />}
              onClick={() => setMapView({ ...row, withPins: false })}
              title={`ERF ${row.erfNo} on the map`}
            >
              {row.erfNo}
            </DataActionButton>
          ) : (
            row.erfNo
          ),
      },
      {
        key: "address",
        label: "Address",
        filter: "text",
        sortable: true,
        value: (row) => row.address,
        render: (row) =>
          row.erfId ? (
            <DataActionButton
              icon={<PremiseActionIcon />}
              onClick={() => setMapView({ ...row, withPins: true })}
              title="The premise and the meter on the map"
            >
              {row.address}
            </DataActionButton>
          ) : (
            row.address
          ),
      },
      // Why the office sent it. Without this the supervisor is deciding
      // whether to take work off a man without knowing what the work was for.
      { key: "reason", label: "Why it was sent", filter: "text", sortable: true, value: (row) => row.reason },
      { key: "state", label: "Where it is", filter: "text", sortable: true, value: (row) => row.state },
      { key: "heldFor", label: "His since", align: "right", sortable: true, value: (row) => row.heldFor },
      {
        // `DR-R001` 5.6. A job he has accepted is not on the clock, and one
        // issued before the stamp existed never will be - both say so in
        // words rather than showing a number nobody holds.
        key: "expires",
        label: "Goes back",
        align: "right",
        sortable: true,
        value: (row) => row.expires,
      },
      ...(canManageItoWork(role)
        ? [
            {
              // ONE ACTION ON THIS PAGE (`DR-R001` 1.15.0, owner 12 October
              // 2026: "unallocate first, then delete"). There is no Delete
              // here: a job still with him cannot be deleted, and once it is
              // unallocated it is in Waiting, which has the Delete already.
              key: "actions",
              label: "",
              align: "right",
              sortable: false,
              render: (row) =>
                row.unplaceable ? (
                  // iREPS cannot place this job's state, so the machine would
                  // refuse any move on it. A button that cannot work is worse
                  // than none.
                  NAV
                ) : (
                  <DataActionButton
                    compact
                    tone="remove"
                    icon={<BinActionIcon />}
                    busy={busyId === row.id}
                    disabled={Boolean(busyId) && busyId !== row.id}
                    onClick={() => ask("CANCEL", row)}
                    title={`Take the ${row.letter} on meter ${row.meterNo} back off ${worker?.name || "him"}`}
                  >
                    Unallocate
                  </DataActionButton>
                ),
            },
          ]
        : []),
    ],
    [role, busyId, worker, picked],
  );

  const deletedColumns = useMemo(
    () => [
      { key: "meterNo", label: "Meter", filter: "text", sortable: true, minWidth: 140, value: (row) => row.meterNo },
      { key: "letter", label: "Work", filter: "text", sortable: true, value: (row) => row.letter },
      { key: "erfNo", label: "ERF", filter: "text", sortable: true, value: (row) => row.erfNo },
      { key: "address", label: "Address", filter: "text", sortable: true, value: (row) => row.address },
      { key: "why", label: "Why it was deleted", filter: "text", sortable: true, value: (row) => row.why },
      { key: "by", label: "By", filter: "text", sortable: true, value: (row) => row.by },
      { key: "binnedFor", label: "In the bin", align: "right", sortable: true, value: (row) => row.binnedFor },
      ...(canManageItoWork(role)
        ? [
            {
              key: "actions",
              label: "",
              align: "right",
              sortable: false,
              render: (row) => (
                <DataActionButton
                  compact
                  icon={<RestoreActionIcon />}
                  busy={busyId === row.id}
                  disabled={Boolean(busyId) && busyId !== row.id}
                  onClick={() => ask("RESTORE", row)}
                  title={`Restore the ${row.letter} on meter ${row.meterNo}`}
                >
                  Restore
                </DataActionButton>
              ),
            },
          ]
        : []),
    ],
    [role, busyId],
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
          {/* THE NAME IS THE DOOR, AND IT IS DRAWN THE WAY EVERY DOOR IN A
              TABLE IS DRAWN. Owner, 12 October 2026, holding up the Meter
              Registry's meter chip: *"use this as the standard irepsTable
              btn"*.

              It was plain black text that happened to be clickable - he could
              not find his own page and had to ask where it was. My first fix
              made it blue and underlined, which was a THIRD look invented
              beside the two he had just finished reducing to one. The chip
              already existed and already means *press here to open this*. */}
          <DataActionButton
            compact
            icon={<WorkerActionIcon />}
            onClick={() => openWorker(row)}
            title={row.unheld ? "Open the work nobody is holding" : `Open ${row.name}'s page`}
          >
            {row.name}
          </DataActionButton>
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

      {worker ? null : !ready ? (
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
            silence. Allocate it from the meter, or delete it from this row.{" "}
            <strong>Waiting</strong> is from when it came back, not from when it was
            last issued; a job that has never been allocated has waited since it was
            made.
          </p>
        </>
      ) : view === "deleted" ? (
        <>
          <IrepsTable
            title="In the bin"
            columns={deletedColumns}
            rows={deletedRows}
            rowKey={(row, index) => row.id || `deleted-${index}`}
            loading={trns.isLoading}
            emptyText="Nothing has been deleted in this ward."
            stickyFirstColumn
          />

          <p style={styles.footnote}>
            A delete <strong>flags the record, it does not remove it</strong> — so
            nothing is lost and anything here can be restored. A restored job comes
            back to <strong>Waiting</strong> with nobody on it, and is refused if the
            office has since issued another of the same kind on that meter.
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
            // `DR-R001` 9.3: clicking a field worker opens his page. The row
            // for work NOBODY holds opens the pool instead - there is no
            // person there to have a page.
            // NO WHOLE-ROW CLICK. Owner: *"why make the whole row clickable?
            // and not only the FWR?"* A row that silently does something when
            // pressed anywhere is a control with no edges - you cannot see
            // where it begins, and a press meant for a number becomes a
            // navigation. The chip has edges, and they are the ones you can
            // see.
          />

          {/* Counted but given no column — said in words rather than dropped. */}
          {aside.length ? <p style={styles.aside}>{aside.join(" · ")}</p> : null}

          <p style={styles.footnote}>
            <strong>Oldest waiting</strong> is the oldest job still waiting on that
            worker, read from when it was issued. A job issued before that was
            recorded has no age and reads <strong>NAv</strong> — never 0, which would
            read as nothing waiting. <strong>Press a worker's name</strong> to open
            his page, where his jobs are listed one by one and can be taken back
            off him.{" "}
            {totals.workers} workers, {totals.total} jobs.
          </p>
        </>
      ) : null}

      {worker ? (
        <div style={styles.workerPage}>
          <div style={styles.workerHead}>
            <div>
              <button type="button" style={styles.backLink} onClick={() => setWorker(null)}>
                ← All workers
              </button>
              <h2 style={styles.workerPageName}>{worker.name}</h2>
              <p style={styles.workerSubline}>
                {worker.role || NAV}
                {worker.provider ? ` · ${worker.provider}` : ""} · last heard from{" "}
                <strong>{worker.lastHeard}</strong>
              </p>
            </div>

            <div style={styles.workerCounts}>
              <div style={styles.workerCount}>
                <p style={styles.workerCountValue}>{workerJobs.length}</p>
                <p style={styles.workerCountLabel}>he holds</p>
              </div>
              <div style={styles.workerCount}>
                <p style={styles.workerCountValue}>
                  {workerJobs.filter((job) => job.isIssued).length}
                </p>
                <p style={styles.workerCountLabel}>not answered</p>
              </div>
              <div style={{ ...styles.workerCount, ...styles.workerCountQuiet }}>
                <p style={styles.workerCountValue}>{workerCompleted}</p>
                <p style={styles.workerCountLabel}>finished</p>
              </div>
            </div>
          </div>

          {canManageItoWork(role) && pickedHere.length ? (
            <div style={styles.pickedBar}>
              <span style={styles.pickedCount}>
                <strong>{pickedHere.length}</strong> of {pickable.length} chosen
              </span>
              <div style={styles.pickedActions}>
                <button type="button" style={styles.pickedClear} onClick={() => setPicked(new Set())}>
                  Clear
                </button>
                <DataActionButton
                  compact
                  tone="remove"
                  icon={<BinActionIcon />}
                  busy={busyId === "ALL"}
                  onClick={() =>
                    askForAll(workerJobs.filter((row) => pickedHere.includes(row.id)))
                  }
                  title={`Take ${pickedHere.length} jobs back off ${worker.name}`}
                >
                  Unallocate {pickedHere.length}
                </DataActionButton>
              </div>
            </div>
          ) : null}

          <IrepsTable
            title={`What ${worker.name} is carrying`}
            columns={workerJobColumns}
            rows={workerJobs}
            rowKey={(row, index) => row.id || `job-${index}`}
            loading={trns.isLoading}
            emptyText={`${worker.name} is holding nothing in this ward.`}
            stickyFirstColumn
          />

          <p style={styles.footnote}>
            This is what he <strong>holds</strong> — work waiting for his answer and
            work he has taken. What he has finished is counted above, not listed:
            it is his, but it is not a load.{" "}
            <strong>Goes back</strong> is the three-day clock. It runs only on work
            he has not answered — the clock cannot see that a man is standing at a
            meter — and a job issued before iREPS recorded that time reads{" "}
            <strong>never</strong>, because an unknown age is not a long one.{" "}
            <strong>Unallocate</strong> takes a job off him and puts it back in{" "}
            <strong>Waiting</strong>, where it can be given to somebody else or
            deleted.
          </p>
        </div>
      ) : null}

      {meterTrnId ? (
        <MeterDeepDetailsModal trnId={meterTrnId} onClose={() => setMeterTrnId(null)} />
      ) : null}

      {mapView ? (
        <BoundaryMapModal
          key={`${mapView.id}-${mapView.withPins ? "pins" : "erf"}`}
          mode="ERF"
          trnId={mapView.id}
          erfId={mapView.erfId}
          erfNo={mapView.erfNo}
          wardPcode={mapView.wardPcode}
          wardNo={mapView.wardNo}
          pins={mapPins}
          onClose={() => setMapView(null)}
        />
      ) : null}

      {asking ? (
        <SubmitWindow
          title={
            asking.rows.length > 1
              ? `Take ${asking.rows.length} jobs back off ${worker?.name || "him"}?`
              : `${ITO_MANAGE_ACTIONS[asking.action].verb} the ${
                  asking.rows[0].letter
                } on meter ${asking.rows[0].meterNo}?`
          }
          lines={[
            asking.action === "DELETE"
              ? "This flags the transaction as deleted and frees the meter for another job of this kind. Nothing is removed — you can restore it from the Deleted view."
              : asking.action === "RESTORE"
                ? "This brings the job back to Waiting, with nobody on it. It is refused if the office has since issued another of the same kind on this meter."
                : asking.rows.length > 1
                  ? "They all go back to Waiting, with nobody on them, and can then be given to somebody else. It is one act: either every one of them comes off him, or none does."
                  : "This takes the work off the worker it is with. It goes back to Waiting, for somebody else.",

            // HE MAY BE STANDING AT THE METER. iREPS watches the record, not
            // the work, so it cannot know - and it must say so rather than
            // let the office find out from him afterwards. Since 12 October
            // his capture and his photographs survive, which is the half of
            // this the office most needs to hear.
            asking.rows.some((row) => !row.isIssued)
              ? "One of these is work he has already taken. If he is at the meter now, his submission will be refused — but nothing he captured is lost, and the office can give the job back to him."
              : null,

            asking.rows.length > 1
              ? asking.rows
                  .slice(0, 6)
                  .map((row) => `${row.letter} · ${row.meterNo}`)
                  .join("   ") + (asking.rows.length > 6 ? `   … and ${asking.rows.length - 6} more` : "")
              : `ERF ${asking.rows[0].erfNo} · ${asking.rows[0].address}`,
          ].filter(Boolean)}
          escapeAction={() => setAsking(null)}
          actions={[
            {
              key: "go",
              label: ITO_MANAGE_ACTIONS[asking.action].verb,
              primary: true,
              onClick: act,
            },
            { key: "no", label: "Cancel", onClick: () => setAsking(null) },
          ]}
        >
          <label style={styles.reasonLabel} htmlFor="ito-manage-reason">
            {ITO_MANAGE_ACTIONS[asking.action].reasonLabel}
          </label>
          <textarea
            id="ito-manage-reason"
            style={styles.reason}
            value={reason}
            rows={3}
            onChange={(event) => setReason(event.target.value)}
            placeholder="In your own words"
          />
          {outcome && !outcome.ok ? (
            <p style={styles.reasonProblem}>{outcome.message}</p>
          ) : null}
        </SubmitWindow>
      ) : null}

      {outcome && !asking ? (
        <SubmitWindow
          title={
            outcome.ok
              ? outcome.rows.length > 1
                ? `${outcome.rows.length} jobs taken back.`
                : `${ITO_MANAGE_ACTIONS[outcome.action].verb} — done.`
              : outcome.wrote === null
                ? "iREPS could not be reached."
                : "Not done. Nothing was changed."
          }
          tone={outcome.ok ? "info" : "error"}
          lines={[
            outcome.ok
              ? outcome.rows.length > 1
                ? `All ${outcome.rows.length} are back in Waiting, with nobody on them.`
                : outcome.action === "DELETE"
                  ? `The ${outcome.rows[0].letter} on meter ${outcome.rows[0].meterNo} is in the bin. The meter will take another of its kind. It is in the Deleted view if you want it back.`
                  : outcome.action === "RESTORE"
                    ? `The ${outcome.rows[0].letter} on meter ${outcome.rows[0].meterNo} is back in Waiting, with nobody on it.`
                    : `The ${outcome.rows[0].letter} on meter ${outcome.rows[0].meterNo} is back in Waiting.`
              : outcome.rows.length > 1
                ? `${outcome.message} Nothing moved — the office writes them together or not at all.`
                : outcome.message,
            // The Meter Registry can show no change at all after a delete:
            // the meter's marker is a single field, so it may be naming a
            // different kind of job and the delete correctly leaves it. So
            // what happened is reported from the TRANSACTION, never from the
            // meter.
            outcome.ok && outcome.rows.length === 1
              ? "Its number: " + (outcome.trnId || NAV)
              : null,
            outcome.code && outcome.code !== "NAv" ? `Code: ${outcome.code}` : null,
          ].filter(Boolean)}
          escapeAction={() => setOutcome(null)}
          actions={[
            { key: "done", label: "Done", primary: true, onClick: () => setOutcome(null) },
          ]}
        />
      ) : null}
    </section>
  );
}

const styles = {
  workerPage: { display: "flex", flexDirection: "column", gap: 16 },
  pickedBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
    padding: "10px 16px",
    borderRadius: 14,
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
  },
  pickedCount: { fontSize: 13, color: "#1e3a8a" },
  pickedActions: { display: "flex", alignItems: "center", gap: 10 },
  pickedClear: {
    padding: 0,
    border: "none",
    background: "none",
    font: "inherit",
    fontSize: 13,
    fontWeight: 700,
    color: "#1d4ed8",
    cursor: "pointer",
  },
  workerHead: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 20,
    flexWrap: "wrap",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 20,
    padding: "16px 20px",
  },
  backLink: {
    padding: 0,
    marginBottom: 8,
    border: "none",
    background: "none",
    font: "inherit",
    fontSize: 13,
    fontWeight: 700,
    color: "#1d4ed8",
    cursor: "pointer",
  },
  workerPageName: { margin: 0, fontSize: 24, fontWeight: 400, color: "#0f172a" },
  workerSubline: { margin: "4px 0 0", fontSize: 13, color: "#475569" },
  workerCounts: { display: "flex", gap: 10 },
  workerCount: {
    minWidth: 96,
    padding: "10px 14px",
    borderRadius: 14,
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    textAlign: "center",
  },
  // What he has finished steps back: it is not a load.
  workerCountQuiet: { background: "#ffffff", color: "#94a3b8" },
  workerCountValue: {
    margin: 0,
    fontSize: 22,
    fontWeight: 800,
    color: "inherit",
    fontVariantNumeric: "tabular-nums",
  },
  workerCountLabel: { margin: "2px 0 0", fontSize: 12, color: "#64748b" },
  reasonLabel: {
    display: "block",
    marginTop: 4,
    marginBottom: 6,
    fontSize: 13,
    fontWeight: 700,
    color: "#0f172a",
  },
  reason: {
    width: "100%",
    boxSizing: "border-box",
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid #cbd5e1",
    fontFamily: "Arial, Helvetica, sans-serif",
    fontSize: 13,
    color: "#0f172a",
    resize: "vertical",
  },
  reasonProblem: {
    margin: "8px 0 0",
    fontSize: 13,
    fontWeight: 700,
    color: "#991b1b",
  },
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
  workerSub: { display: "block", fontSize: 11, color: "#64748b" },
  total: { fontSize: 15, fontWeight: 700, color: "#0f172a" },
  rejected: { color: "#A32D2D" },
  aside: { margin: 0, fontSize: 12, color: "#78350f" },
  footnote: { margin: 0, fontSize: 12, lineHeight: 1.5, color: "#475569" },
};
