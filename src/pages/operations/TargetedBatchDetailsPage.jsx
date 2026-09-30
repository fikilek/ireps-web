import { useAuth } from "../../auth/useAuth";
import { useGetPermanentSalesBatchesQuery, useTakeMeterOutOfBatchMutation } from "../../redux/salesTargetedBatchApi";
/* eslint-disable no-unused-vars -- JSX component tags are consumed by the JSX transform. */
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import TargetedBatchRowsView from "./targeted-batches/rows/TargetedBatchRowsView";
import TargetedBatchTakeOutWindows from "./targeted-batches/rows/TargetedBatchTakeOutWindows";
import {
  buildTargetedBatchRows,
} from "./targeted-batches/rows/targetedBatchRowsModel";
import {
  canSeeTakeOutOfBatch,
  takeOutBlockedReason,
  takeOutButtonLabel,
  takeOutFailureWindow,
  takeOutResultWindow,
  takeOutSelection,
} from "./targeted-batches/rows/takeOutOfBatchModel";
import { tbRowsStyles as styles } from "./targeted-batches/rows/targetedBatchRowsStyles";

function BatchStatusBadge({ status }) {
  const readyStatuses = [
    "READY_FOR_ALLOCATION",
    "PARTIALLY_ALLOCATED",
    "ALLOCATED",
    "IN_PROGRESS",
    "COMPLETED",
  ];
  const ready = readyStatuses.includes(status);

  return (
    <span
      style={{
        ...styles.badge,
        background: ready ? "#dcfce7" : "#fef3c7",
        color: ready ? "#166534" : "#92400e",
      }}
    >
      {status || "NAv"}
    </span>
  );
}

export default function TargetedBatchDetailsPage() {
  const { tbId } = useParams();
  const decodedTbId = decodeURIComponent(tbId || "");

  const { activeWorkbase, role } = useAuth();
  const lmPcode = activeWorkbase?.lmPcode || activeWorkbase?.pcode || activeWorkbase?.id || activeWorkbase?.localMunicipalityId;
  const { data: permanent } = useGetPermanentSalesBatchesQuery({ lmPcode, tbId: decodedTbId }, { skip: !lmPcode || !decodedTbId });
  const batch = permanent?.batch || null, permanentRows = permanent?.rows;
  const isLoading = !permanent?.ready && !permanent?.error, loadError = permanent?.error || "";
  // Targeted Batch rules TB-R060 (1.3.60): a supervisor or manager may take a meter out of the batch.
  const canTakeOut = canSeeTakeOutOfBatch(role);
  const [takeOutKeys, setTakeOutKeys] = useState([]);
  const [takeOutReason, setTakeOutReason] = useState("");
  const [takeOutView, setTakeOutView] = useState(null);
  const [takeMeterOutOfBatch] = useTakeMeterOutOfBatchMutation();

  const rows = useMemo(
    () =>
      batch
        ? buildTargetedBatchRows({
            ...batch,
            rows: permanentRows || [],
          })
        : [],
    [batch, permanentRows],
  );

  const takeOutContext = { rowCount: rows.length };
  // Only the rows that may go: a row whose meter leaves the batch while the window is open drops out by itself.
  const takeOutChosen = useMemo(
    () => takeOutSelection(rows, takeOutKeys, takeOutContext),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rowCount comes from rows.
    [rows, takeOutKeys],
  );
  const takeOutBusy = takeOutView?.kind === "working";

  function toggleTakeOut(rowKey) {
    setTakeOutKeys((current) =>
      current.includes(rowKey)
        ? current.filter((key) => key !== rowKey)
        : [...current, rowKey],
    );
  }

  async function confirmTakeOut() {
    const items = takeOutChosen.items;
    if (!batch?.id || !items.length || takeOutBusy) return;

    setTakeOutView({ kind: "working" });

    try {
      const result = await takeMeterOutOfBatch({
        tbId: batch.id,
        meterNos: takeOutChosen.meterNos,
        reasonText: takeOutReason,
      }).unwrap();

      // The ticks of the meters that went are cleared; a refused meter stays ticked so it can be looked at.
      const gone = new Set((result?.takenOut || []).map((item) => item.meterNo));
      setTakeOutKeys(items.filter((item) => !gone.has(item.salesAllMeterId)).map((item) => item.rowKey));
      setTakeOutReason("");
      setTakeOutView(takeOutResultWindow({ batch, items, result }));
    } catch (failure) {
      setTakeOutView(takeOutFailureWindow({ batch, items, failure }));
    }
  }

  function closeTakeOutWindow() {
    if (takeOutBusy) return;
    setTakeOutView(null);
  }

  if (isLoading) {
    return (
      <section style={styles.page}>
        <div style={styles.topActionRow}>
          <Link to="/operations/targeted-batches" style={styles.backLink}>
            ← Back to TB Register
          </Link>
        </div>
        <div style={styles.infoPanel}>
          Loading permanent Targeted Batch and TB Rows...
        </div>
      </section>
    );
  }

  if (loadError || !batch) {
    return (
      <section style={styles.page}>
        <div style={styles.topActionRow}>
          <Link to="/operations/targeted-batches" style={styles.backLink}>
            ← Back to TB Register
          </Link>
        </div>
        <div style={styles.errorNotice}>
          <strong>TB rows are not available</strong>
          <p style={styles.noticeText}>
            {loadError || "The permanent Targeted Batch could not be loaded."}
          </p>
        </div>
      </section>
    );
  }

  const encodedId = encodeURIComponent(batch.id);
  const allocationStatus = String(batch?.allocation?.status || "")
    .trim()
    .toUpperCase();
  const batchStatus = String(batch?.status || "")
    .trim()
    .toUpperCase();
  const isPermanentlyAllocated =
    allocationStatus === "ALLOCATED" || batchStatus === "ALLOCATED";

  return (
    <section style={styles.page}>
      <div style={styles.topActionRow}>
        <Link to="/operations/targeted-batches" style={styles.backLink}>
          ← Back to TB Register
        </Link>
        <Link
          to={`/operations/targeted-batches/${encodedId}/final-report`}
          style={styles.actionLink}
        >
          Final Report
        </Link>
        {isPermanentlyAllocated ? (
          <span
            style={{
              ...styles.allocationLink,
              opacity: 0.62,
              cursor: "not-allowed",
            }}
            role="link"
            aria-disabled="true"
            tabIndex={0}
            title="Allocation prohibited: this Targeted Batch is already allocated."
          >
            Allocated
          </span>
        ) : (
          <Link
            to={`/operations/targeted-batches/${encodedId}/allocation`}
            style={styles.allocationLink}
          >
            TB Allocation
          </Link>
        )}
      </div>

      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Operations / Targeted Batch / TB Rows</p>
          <h2 style={styles.title}>{batch.id}</h2>
          <p style={styles.subtitle}>
            Rows belonging to this Targeted Batch.
          </p>
        </div>
        <BatchStatusBadge status={batch.status} />
      </div>

      <TargetedBatchRowsView
        key={`${lmPcode}:${batch.id}`}
        batch={batch}
        rows={rows}
        takeOut={canTakeOut ? {
          selectedKeys: takeOutKeys,
          onToggle: toggleTakeOut,
          blockedReason: row => takeOutBlockedReason(row, takeOutContext),
          busy: takeOutBusy,
        } : null}
        toolbar={canTakeOut ? (
              <button
                type="button"
                style={{
                  ...styles.secondaryButton,
                  ...(takeOutChosen.count && !takeOutBusy ? null : { opacity: 0.55, cursor: "not-allowed" }),
                }}
                onClick={() => setTakeOutView({ kind: "confirm" })}
                disabled={!takeOutChosen.count || takeOutBusy}
                title={
                  takeOutChosen.count
                    ? "Take the ticked meters out of this batch"
                    : "Tick the meters to take out of this batch"
                }
              >
                {takeOutButtonLabel(takeOutChosen.count)}
              </button>
        ) : null}
      />

      <TargetedBatchTakeOutWindows
        view={takeOutView}
        batch={batch}
        items={takeOutChosen.items}
        reasonText={takeOutReason}
        onReasonChange={setTakeOutReason}
        onConfirm={confirmTakeOut}
        onClose={closeTakeOutWindow}
      />
    </section>
  );
}
