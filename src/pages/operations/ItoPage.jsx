/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
// The ITO page — Individual Transaction Origination. `DR-R001` 3, 3.4 and 3.5.
//
// One screen does the sending: one transaction, on one meter, to one field
// worker. The transaction was already decided on the Meter Registry row, so it
// cannot be changed here and there is no transaction picker (3.4).
//
// THE GUARD HAS ALREADY RUN. The launch button puts the meter through the
// seven checks of 3.1 before this page opens, so by the time the office is
// here the meter and the registration that created it agree. The server runs
// them again at the send; hiding a button is not a rule, the refusal is (4).
//
// WHAT IS BUILT HERE IS STEP 4 — why the work is being sent. Step 5 is
// choosing the worker, from the map and the list beside it, and step 6 is the
// sending modal of 3.5. Both are drawn and approved on the design canvas and
// are marked on this page where they will go, rather than left blank: the
// owner's standard is that a screen never shows the office nothing.
import { useEffect, useMemo, useState } from "react";
import { skipToken } from "@reduxjs/toolkit/query";
import { Link, useNavigate, useParams } from "react-router-dom";

import { useAuth } from "../../auth/useAuth";
import { ITO_TRANSACTIONS, readItoCount } from "../../components/ito/itoTransactions";
import { itoReasonProblem, itoReasonsFor } from "../../components/ito/itoReasons";
import { buildWorkerChoices } from "../../components/ito/itoWorkers";
import ItoMap from "../../components/ito/ItoMap";
import { readPoint } from "../../components/ito/geoDistance";
import ItoWorkerPicker from "../../components/ito/ItoWorkerPicker";
import SubmitWindow from "../../components/submit/SubmitWindow.jsx";
import { buildItoRequest } from "../../components/ito/itoRequest";
import { ITO_STEPS, sendItoRequest } from "../../components/ito/sendItoRequest";
import {
  useGetMeterByIdQuery,
  useGetPremiseByIdQuery,
} from "../../redux/creditControlApi";
import { useGetErfBoundaryByIdQuery } from "../../redux/mapErfsApi";
import { useGetFwrLiveLocationsQuery } from "../../redux/fwrLiveLocationsApi";
import { useGetUsersDirectoryQuery } from "../../redux/usersApi";

const NAV = "NAv";

/**
 * An ERF boundary as a ring of points, out of whatever shape it arrives in.
 *
 * Tolerant on purpose: a boundary that cannot be read draws no polygon, and
 * the meter, the premise and the line are still there. A map missing one
 * outline is worth more to the office than no map.
 */
function erfRing(boundary) {
  const geometry = boundary?.geometry || boundary;
  const rings = geometry?.coordinates || geometry?.paths || geometry;

  if (!Array.isArray(rings)) return null;

  const flat = Array.isArray(rings[0]?.[0]) ? rings[0] : rings;

  const ring = flat
    .map((point) => {
      if (Array.isArray(point)) {
        const [lng, lat] = point;

        return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
          ? { lat: Number(lat), lng: Number(lng) }
          : null;
      }

      return readPoint(point);
    })
    .filter(Boolean);

  return ring.length >= 3 ? ring : null;
}

/** A count in words, or NAv where the meter does not carry it (never 0). */
function countPhrase(meter, key, one, many) {
  const value = readItoCount(meter, key);

  if (value === null) return `${NAV} ${many}`;

  return `${value} ${value === 1 ? one : many}`;
}

/** Ward 6 out of ZA5241006 — the last digits are the ward's own number. */
function wardLabel(wardPcode) {
  const match = String(wardPcode || "").match(/(\d{1,3})$/);

  if (!match) return NAV;

  return `Ward ${Number(match[1])}`;
}

// Owner, 10 October 2026: the transaction is named in capitals AND in bold,
// so the office sees WHICH work it is sending at a glance rather than reading
// a sentence to find it. The words around it carry normal weight on purpose —
// a heading where everything is bold has nothing standing out in it.
const stampNow = () => Date.now();

function workName(name) {
  return String(name || "work").toUpperCase();
}

export default function ItoPage() {
  const { astId, work } = useParams();
  const navigate = useNavigate();
  const { activeWorkbase, serviceProvider } = useAuth() || {};

  const transaction = useMemo(
    () =>
      ITO_TRANSACTIONS.find(
        (item) => item.work === String(work || "").toLowerCase(),
      ) || null,
    [work],
  );

  const { data: meter, isLoading, isError } = useGetMeterByIdQuery(astId);

  // Step 5: the meter on the ground, and who can be sent to it.
  const meterPoint = readPoint(meter?.ast?.location?.gps);
  const premiseId = String(meter?.accessData?.premise?.id || "").trim();
  const erfId = String(meter?.accessData?.erfId || "").trim();

  const { data: premise } = useGetPremiseByIdQuery(premiseId || skipToken);
  const { data: erfBoundary } = useGetErfBoundaryByIdQuery(erfId || skipToken);
  const { data: usersData, isLoading: usersLoading } = useGetUsersDirectoryQuery({ limit: 1000 });
  const { data: liveData } = useGetFwrLiveLocationsQuery({ limit: 5000 });

  // "Heard 40 seconds ago" has to keep counting, or the office reads a number
  // that froze when the page opened.
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNowMs(Date.now()), 30_000);

    return () => clearInterval(tick);
  }, []);

  const [picked, setPicked] = useState(null);

  // DR-R001 3.5, the four states: confirm, sending, it went, it did not.
  const [phase, setPhase] = useState(null);
  const [stepState, setStepState] = useState({});
  const [outcome, setOutcome] = useState(null);

  async function send() {
    const built = buildItoRequest({
      meter,
      work: transaction.work,
      worker: picked,
      reason: { ...(reasons.find((item) => item.code === reasonCode) || {}), explanation },
      instructionWords: instruction,
      media: [],
      atMs: stampNow(),
    });

    if (!built.ok) {
      setOutcome({ ok: false, wrote: false, message: built.message });
      setPhase("failed");
      return;
    }

    setStepState({});
    setPhase("sending");

    const result = await sendItoRequest({
      request: built.request,
      imageFile: image?.file || null,
      onStep: (key, state) => setStepState((current) => ({ ...current, [key]: state })),
    });

    setOutcome({ ...result, trnId: built.id });
    setPhase(result.ok ? "sent" : "failed");
  }

  // Sent: back to the Meter Registry with this meter at the top of the list -
  // which is to say, the only row, because its number is put in the filter.
  function done() {
    const meterNoNow = meter?.ast?.astData?.astNo || "";

    navigate(meterNoNow ? `/registries/meters?meter=${encodeURIComponent(meterNoNow)}` : "/registries/meters");
  }


  const choices = useMemo(
    () =>
      buildWorkerChoices({
        users: usersData?.users || usersData?.items || usersData || [],
        liveLocations: liveData?.locations || liveData?.items || liveData || [],
        meterPoint,
        nowMs,
        mainContractorId: serviceProvider?.id || null,
      }),
    [usersData, liveData, meterPoint, nowMs, serviceProvider],
  );

  const [reasonCode, setReasonCode] = useState("");
  const [explanation, setExplanation] = useState("");
  const [instruction, setInstruction] = useState("");
  const [image, setImage] = useState(null);

  // DR-R001 3.4: the office module is online, or it is not available. The
  // opposite of the field rule on purpose — the field saves first because it
  // must, the office refuses because it can.
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine !== false,
  );

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);

    window.addEventListener("online", up);
    window.addEventListener("offline", down);

    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  useEffect(() => () => {
    if (image?.preview) URL.revokeObjectURL(image.preview);
  }, [image]);

  const reasons = itoReasonsFor(transaction?.work);
  const steps = [
    image
      ? {
          key: ITO_STEPS.attach,
          label: "Attaching the instruction",
          done: stepState[ITO_STEPS.attach] === "done",
          active: stepState[ITO_STEPS.attach] === "active",
        }
      : null,
    {
      key: ITO_STEPS.write,
      label: "Checking the meter and writing the job",
      done: stepState[ITO_STEPS.write] === "done",
      active: stepState[ITO_STEPS.write] === "active",
    },
  ].filter(Boolean);

  const problem = itoReasonProblem({
    work: transaction?.work,
    code: reasonCode,
    explanation,
  });

  function takeImage(file) {
    if (!file) return;

    if (image?.preview) URL.revokeObjectURL(image.preview);

    setImage({ name: file.name, preview: URL.createObjectURL(file), file });
  }

  function dropImage(event) {
    event.preventDefault();
    takeImage(event.dataTransfer?.files?.[0]);
  }

  function clearImage() {
    if (image?.preview) URL.revokeObjectURL(image.preview);
    setImage(null);
  }

  if (!transaction) {
    return (
      <section className="page">
        <div style={styles.refusal}>
          <h1 style={styles.refusalTitle}>That is not a transaction iREPS sends</h1>
          <p style={styles.refusalText}>
            The address asked for <strong>{String(work || NAV)}</strong>. The
            office sends a disconnection, a reconnection, an inspection, a
            removal or a meter reading.
          </p>
          <Link className="text-link" to="/registries/meters">
            ← Back to the Meter Registry
          </Link>
        </div>
      </section>
    );
  }

  if (!online) {
    return (
      <section className="page">
        <div style={styles.refusal}>
          <h1 style={styles.refusalTitle}>This page needs a connection</h1>
          <p style={styles.refusalText}>
            Work is sent to a worker from here, so nothing is half-made without
            a connection. Nothing you typed has been lost — come back when you
            are online.
          </p>
          <Link className="text-link" to="/registries/meters">
            ← Back to the Meter Registry
          </Link>
        </div>
      </section>
    );
  }

  const meterNo = meter?.ast?.astData?.astNo || astId;
  const state = meter?.status?.state || NAV;
  const parents = meter?.accessData?.parents || {};
  const lmName = activeWorkbase?.lmName || activeWorkbase?.name || parents.lmPcode || NAV;

  return (
    <section className="page" style={styles.page}>
      {/* Owner, 10 October 2026: which meter, which work, and what state it
          is in must stay on screen. Scrolling to the worker list or the reason
          used to carry all of it away, so the office could be half way down
          the page with nothing saying what it was allocating. */}
      <div style={styles.stickyHead}>
        <nav style={styles.crumbs} aria-label="Where you are">
          <Link to="/registries/meters" style={styles.crumbLink}>
            Meter Registry
          </Link>
          <span aria-hidden="true">›</span>
          <span>
            {lmName} · {wardLabel(parents.wardPcode)}
          </span>
          <span aria-hidden="true">›</span>
          <strong style={styles.crumbNow}>{meterNo}</strong>
        </nav>

        <div style={styles.titleRow}>
          <span style={styles.code}>{transaction.code}</span>
          <h1 style={styles.title}>
            Allocate <strong style={styles.titleWork}>{workName(transaction.name)}</strong>{" "}
            to a field worker
          </h1>
        </div>

        {isError ? (
          <p style={styles.note}>This meter could not be read. Try again.</p>
        ) : null}

        <section style={styles.band}>
          <div style={styles.bandCell}>
            <span style={styles.label}>Meter</span>
            <strong style={styles.meterNo}>{isLoading ? "…" : meterNo}</strong>
            <span style={styles.sub}>
              {meter?.meterType || NAV} · {meter?.ast?.astData?.meter?.type || NAV}
            </span>
          </div>
          <div style={styles.bandCell}>
            <span style={styles.label}>Meter status</span>
            <span style={styles.pill}>
              <span aria-hidden="true" style={styles.pillDot} />
              {state}
            </span>
          </div>
          <div style={{ ...styles.bandCell, flexGrow: 1, minWidth: 250 }}>
            <span style={styles.label}>Where it is</span>
            <strong style={styles.where}>
              {meter?.accessData?.premise?.address || NAV}
            </strong>
            <span style={styles.sub}>
              ERF {meter?.accessData?.erfNo || NAV} · {lmName} ·{" "}
              {wardLabel(parents.wardPcode)} · {parents.wardPcode || NAV}
            </span>
          </div>
          <div style={styles.bandCell}>
            <span style={styles.label}>On this meter</span>
            <span style={styles.counts}>
              {countPhrase(meter, "disconnections", "disconnection", "disconnections")} ·{" "}
              {countPhrase(meter, "reconnections", "reconnection", "reconnections")}
              <br />
              {countPhrase(meter, "inspections", "inspection", "inspections")} ·{" "}
              {countPhrase(meter, "noAccess", "no access", "no access")}
            </span>
          </div>
        </section>
      </div>

      <div style={styles.columns}>
        <section style={{ ...styles.card, ...styles.mapCard }}>
          <div style={styles.cardHead}>
            <h2 style={styles.cardTitle}>The meter on the ground</h2>
            <span style={styles.cardAside}>
              Field workers within {choices.radiusM} m are drawn here
            </span>
          </div>
          <ItoMap
            meter={meterPoint}
            premise={readPoint(premise)}
            erfPaths={erfRing(erfBoundary)}
            workers={choices.onTheMap}
            allocated={picked}
          />
        </section>

        <section style={{ ...styles.card, ...styles.whoCard }}>
          <ItoWorkerPicker
            choices={choices}
            picked={picked}
            onPick={setPicked}
            onClear={() => setPicked(null)}
            loading={usersLoading}
          />
        </section>
      </div>

      <section style={styles.card}>
        <h2 style={styles.cardTitle}>
          Why it is being {String(transaction.name).toLowerCase()}
        </h2>

        {reasons.length === 0 ? (
          <p style={styles.note}>
            The reasons for a {String(transaction.name).toLowerCase()} are not
            settled yet. Only the disconnection list is agreed, so there is
            nothing to choose here rather than a list nobody approved.
          </p>
        ) : (
          <>
            <div style={styles.twoUp}>
              <div style={styles.field}>
                <label htmlFor="ito-reason" style={styles.label}>
                  The reason
                </label>
                <select
                  id="ito-reason"
                  value={reasonCode}
                  onChange={(event) => setReasonCode(event.target.value)}
                  style={styles.input}
                >
                  <option value="">Choose a reason</option>
                  {reasons.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.words}
                    </option>
                  ))}
                </select>
                <p style={styles.hint}>
                  Other may not be sent without its explanation.
                </p>
              </div>

              <div style={styles.field}>
                <label htmlFor="ito-instruction" style={styles.label}>
                  The instruction, in words
                </label>
                <textarea
                  id="ito-instruction"
                  rows={4}
                  value={instruction}
                  onChange={(event) => setInstruction(event.target.value)}
                  placeholder="Type what the worker must know. It reaches his form word for word."
                  style={{ ...styles.input, resize: "vertical" }}
                />
              </div>
            </div>

            {reasonCode === "OTHER" ? (
              <div style={styles.field}>
                <label htmlFor="ito-other" style={styles.label}>
                  What the other reason is
                </label>
                <input
                  id="ito-other"
                  type="text"
                  value={explanation}
                  onChange={(event) => setExplanation(event.target.value)}
                  style={styles.input}
                />
              </div>
            ) : null}

            <div>
              <span style={styles.label}>Or attach the instruction as an image</span>
              <div style={styles.attachRow}>
                <div
                  style={styles.dropZone}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={dropImage}
                >
                  <strong style={styles.dropTitle}>Drag the image here</strong>
                  <label htmlFor="ito-image" style={styles.chooseLink}>
                    or choose a file — a letter or an instruction photographed
                    or screenshotted
                  </label>
                  <input
                    id="ito-image"
                    type="file"
                    accept="image/*"
                    onChange={(event) => takeImage(event.target.files?.[0])}
                    style={styles.fileInput}
                  />
                </div>

                {image ? (
                  <div style={styles.thumb}>
                    <img src={image.preview} alt={image.name} style={styles.thumbImg} />
                    <div style={styles.thumbRow}>
                      <span style={styles.thumbName}>{image.name}</span>
                      <button
                        type="button"
                        onClick={clearImage}
                        aria-label={`Remove ${image.name}`}
                        style={styles.thumbRemove}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              <p style={styles.hint}>
                Typed words, images, or both. No video and no voice.
              </p>
            </div>
          </>
        )}
      </section>

      <section style={{ ...styles.card, ...styles.footerCard }}>
        <p style={styles.footNote}>
          {problem
            ? problem
            : !picked
              ? "Choose the field worker this goes to."
              : "Ready to send. The sending window itself is step 6."}
        </p>
        <div style={styles.actions}>
          <button
            type="button"
            onClick={() => navigate("/registries/meters")}
            style={styles.cancel}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={Boolean(problem) || !picked}
            onClick={() => setPhase("confirm")}
            style={problem || !picked ? styles.send : styles.sendReady}
          >
            Submit
          </button>
        </div>
      </section>

      {phase === "confirm" ? (
        <SubmitWindow
          title={`Send this ${String(transaction.name).toLowerCase()}?`}
          lines={[`Once it is sent, ${picked.name} can accept it. Nothing has been written yet.`]}
          escapeAction={() => setPhase(null)}
          actions={[
            { key: "cancel", label: "Cancel", onClick: () => setPhase(null) },
            { key: "send", label: "Send it", primary: true, onClick: send },
          ]}
        >
          <dl style={styles.confirm}>
            <div style={styles.confirmRow}>
              <dt style={styles.confirmKey}>Meter</dt>
              <dd style={styles.confirmValue}>
                <strong>{meterNo}</strong> · {meter?.meterType || NAV} ·{" "}
                {meter?.ast?.astData?.meter?.type || NAV}
              </dd>
            </div>
            <div style={styles.confirmRow}>
              <dt style={styles.confirmKey}>Where</dt>
              <dd style={styles.confirmValue}>
                {meter?.accessData?.premise?.address || NAV}
                <br />
                <span style={styles.sub}>
                  ERF {meter?.accessData?.erfNo || NAV} · {lmName} ·{" "}
                  {wardLabel(parents.wardPcode)}
                </span>
              </dd>
            </div>
            <div style={styles.confirmRow}>
              <dt style={styles.confirmKey}>Transaction</dt>
              <dd style={styles.confirmValue}>
                <strong>{transaction.code}</strong> — {transaction.name}
              </dd>
            </div>
            <div style={styles.confirmRow}>
              <dt style={styles.confirmKey}>To</dt>
              <dd style={styles.confirmValue}>
                <strong>{picked.name}</strong> · {picked.distance} from the meter
              </dd>
            </div>
            <div style={styles.confirmRow}>
              <dt style={styles.confirmKey}>Reason</dt>
              <dd style={styles.confirmValue}>
                {reasons.find((item) => item.code === reasonCode)?.words || NAV}
                {reasonCode === "OTHER" ? ` — ${explanation}` : ""}
                {instruction.trim() ? (
                  <>
                    <br />
                    <span style={styles.sub}>{instruction.trim()}</span>
                  </>
                ) : null}
                {image ? (
                  <>
                    <br />
                    <span style={styles.sub}>Image: {image.name}</span>
                  </>
                ) : null}
              </dd>
            </div>
          </dl>
        </SubmitWindow>
      ) : null}

      {phase === "sending" ? (
        <SubmitWindow
          title="Sending…"
          working
          steps={steps}
          lines={[
            "The job and the meter are written together, or neither is. This cannot be stopped now.",
          ]}
        />
      ) : null}

      {phase === "sent" ? (
        <SubmitWindow
          title={`Sent. ${picked?.name || "The worker"} has it.`}
          lines={[
            "It is waiting for him to accept. The next thing you will see is him accepting it — or the time passing without that.",
            `Its number: ${outcome?.trnId || NAV}`,
          ]}
          escapeAction={done}
          actions={[{ key: "done", label: "Done", primary: true, onClick: done }]}
        />
      ) : null}

      {phase === "failed" ? (
        <SubmitWindow
          title={
            outcome?.wrote === null
              ? "iREPS could not be reached."
              : "Not sent. Nothing was changed."
          }
          tone="error"
          lines={[
            outcome?.message || "The office could not send this work.",
            "Everything you typed and any image you attached are still on the form.",
          ]}
          escapeAction={() => setPhase(null)}
          actions={[
            { key: "back", label: "Back to the form", primary: true, onClick: () => setPhase(null) },
          ]}
        />
      ) : null}
    </section>
  );
}

const styles = {
  page: { display: "flex", flexDirection: "column", gap: 16, maxWidth: 1440 },
  // The page's own background, or the cards would scroll visibly behind it.
  stickyHead: {
    position: "sticky",
    top: 0,
    zIndex: 20,
    display: "flex",
    flexDirection: "column",
    gap: 16,
    paddingBottom: 12,
    background: "#f8fafc",
  },
  crumbs: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    flexWrap: "wrap",
    fontSize: 13,
    color: "#475569",
  },
  crumbLink: { textDecoration: "none" },
  crumbNow: { color: "#0f172a" },
  titleRow: { display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" },
  code: {
    background: "#0f172a",
    color: "#ffffff",
    borderRadius: 10,
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: "bold",
    letterSpacing: "0.02em",
  },
  title: {
    margin: 0,
    fontSize: 26,
    fontWeight: 400,
    lineHeight: 1.2,
    flexGrow: 1,
    minWidth: 0,
  },
  titleWork: { fontWeight: 800 },
  band: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 20,
    padding: "18px 20px",
    display: "flex",
    gap: 32,
    flexWrap: "wrap",
  },
  bandCell: { minWidth: 160 },
  label: {
    display: "block",
    fontSize: 11,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "#64748b",
    marginBottom: 6,
  },
  meterNo: { display: "block", fontSize: 22 },
  sub: { display: "block", marginTop: 3, fontSize: 12, color: "#475569" },
  where: { display: "block", fontSize: 15 },
  counts: { display: "block", fontSize: 13, color: "#334155", lineHeight: 1.6 },
  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    background: "#f1f5f9",
    border: "1px solid #cbd5e1",
    borderRadius: 999,
    padding: "5px 11px",
    fontSize: 12,
    fontWeight: "bold",
    color: "#0f172a",
  },
  pillDot: { width: 8, height: 8, borderRadius: "50%", background: "#475569" },
  columns: { display: "flex", flexWrap: "wrap", gap: 16, alignItems: "stretch" },
  card: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 20,
    padding: "18px 20px",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  mapCard: { flex: "999 1 620px", minWidth: 0 },
  whoCard: { flex: "1 1 380px", minWidth: 0 },
  cardTitle: { margin: 0, fontSize: 16 },
  cardHead: { display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" },
  cardAside: { fontSize: 12, color: "#64748b", flexGrow: 1, textAlign: "right" },
  toCome: {
    border: "2px dashed #cbd5e1",
    borderRadius: 14,
    padding: "22px 18px",
    background: "#f8fafc",
  },
  toComeTitle: {
    display: "block",
    fontSize: 11,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "#1e3a8a",
    marginBottom: 6,
  },
  toComeText: { margin: 0, fontSize: 13, lineHeight: 1.55, color: "#475569" },
  twoUp: { display: "flex", flexWrap: "wrap", gap: 18 },
  field: { flex: "1 1 320px", minWidth: 0 },
  input: {
    width: "100%",
    padding: "11px 13px",
    border: "1px solid #cbd5e1",
    borderRadius: 12,
    background: "#ffffff",
    color: "#0f172a",
    fontSize: 14,
    fontFamily: "inherit",
  },
  hint: { margin: "7px 0 0", fontSize: 11, lineHeight: 1.45, color: "#475569" },
  note: { margin: 0, fontSize: 13, lineHeight: 1.55, color: "#475569" },
  attachRow: { display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-start" },
  dropZone: {
    flex: "1 1 320px",
    minWidth: 0,
    border: "2px dashed #cbd5e1",
    borderRadius: 14,
    padding: "22px 18px",
    textAlign: "center",
    background: "#f8fafc",
  },
  dropTitle: { display: "block", fontSize: 13 },
  chooseLink: {
    display: "block",
    marginTop: 4,
    fontSize: 12,
    color: "#1d4ed8",
    cursor: "pointer",
    textDecoration: "underline",
  },
  fileInput: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
    border: 0,
  },
  thumb: {
    flex: "0 0 auto",
    width: 180,
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    padding: 10,
    background: "#ffffff",
  },
  thumbImg: {
    display: "block",
    width: "100%",
    height: 104,
    objectFit: "cover",
    borderRadius: 10,
    background: "#e2e8f0",
  },
  thumbRow: { display: "flex", alignItems: "center", gap: 8, marginTop: 8 },
  thumbName: {
    flexGrow: 1,
    minWidth: 0,
    fontSize: 11,
    color: "#334155",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  thumbRemove: {
    width: 24,
    height: 24,
    padding: 0,
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 6,
    color: "#7f1d1d",
    cursor: "pointer",
  },
  footerCard: { flexDirection: "row", flexWrap: "wrap", gap: 18, alignItems: "center" },
  actions: { display: "flex", gap: 10, flexWrap: "wrap", marginLeft: "auto" },
  cancel: {
    padding: "13px 22px",
    border: "1px solid #cbd5e1",
    borderRadius: 12,
    background: "#ffffff",
    color: "#0f172a",
    fontSize: 14,
    cursor: "pointer",
  },
  sendReady: {
    padding: "13px 24px",
    border: "1px solid #0f172a",
    borderRadius: 12,
    background: "#0f172a",
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "bold",
    cursor: "pointer",
  },
  confirm: { margin: 0, display: "grid", gap: 2 },
  confirmRow: {
    display: "flex",
    gap: 12,
    padding: "9px 0",
    borderTop: "1px solid #f1f5f9",
    fontSize: 13,
  },
  confirmKey: { flex: "0 0 96px", color: "#64748b", margin: 0 },
  confirmValue: { flexGrow: 1, minWidth: 0, margin: 0 },
  send: {
    padding: "13px 24px",
    border: "1px solid #cbd5e1",
    borderRadius: 12,
    background: "#f1f5f9",
    color: "#94a3b8",
    fontSize: 14,
    fontWeight: "bold",
    cursor: "not-allowed",
  },
  footNote: {
    margin: 0,
    flex: "1 1 320px",
    minWidth: 0,
    fontSize: 13,
    lineHeight: 1.5,
    color: "#475569",
  },
  refusal: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 20,
    padding: "24px 26px",
    maxWidth: 640,
  },
  refusalTitle: { margin: "0 0 10px", fontSize: 20 },
  refusalText: { margin: "0 0 14px", fontSize: 14, lineHeight: 1.55, color: "#334155" },
};
