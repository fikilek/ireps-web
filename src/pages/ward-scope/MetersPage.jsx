import WardScopeHeader from "./components/WardScopeHeader";
import { useWarehouse } from "../../context/WarehouseContext";

const WAITING_STATUSES = new Set(["pending", "syncing"]);

const isWaitingForRows = ({ status, loading, selectedWardPcode, rowCount }) => {
  if (!selectedWardPcode) return false;
  if (rowCount > 0) return false;

  return loading || WAITING_STATUSES.has(status);
};

const InlineSpinner = ({ label = "Loading..." }) => (
  <span className="ward-scope-inline-spinner">
    <span className="ward-scope-spinner-dot" aria-hidden="true" />
    <span>{label}</span>
    <style>
      {`@keyframes wardScopeSpin {
        to {
          transform: rotate(360deg);
        }
      }

      .ward-scope-inline-spinner {
        align-items: center;
        display: inline-flex;
        gap: 0.45rem;
        justify-content: center;
        white-space: nowrap;
      }

      .ward-scope-spinner-dot {
        animation: wardScopeSpin 0.8s linear infinite;
        border: 2px solid currentColor;
        border-radius: 999px;
        border-right-color: transparent;
        display: inline-block;
        height: 0.85rem;
        width: 0.85rem;
      }`}
    </style>
  </span>
);

const LoadingState = ({ title, message }) => (
  <div className="empty-state">
    <h2>
      <InlineSpinner label={title} />
    </h2>
    <p className="muted">{message}</p>
  </div>
);


const getMeterKey = (meter) =>
  meter?.ast?.astData?.astId ||
  meter?.astData?.astId ||
  meter?.meterId ||
  meter?.id ||
  meter?.meterNo ||
  "NAv";

const getMeterNo = (meter) =>
  meter?.ast?.astData?.astNo ||
  meter?.astData?.astNo ||
  meter?.meterNo ||
  "NAv";

const getMeterType = (meter) =>
  meter?.accessData?.meterType ||
  meter?.ast?.astData?.astType ||
  meter?.astData?.astType ||
  meter?.meterType ||
  "NAv";

const getPremiseId = (meter) =>
  meter?.accessData?.premise?.id ||
  meter?.premiseId ||
  meter?.premise?.id ||
  "NAv";

const getPremiseAddress = (meter) =>
  meter?.accessData?.premise?.address || meter?.premiseAddress || "NAv";

const getErfNo = (meter) => meter?.accessData?.erfNo || meter?.erfNo || "NAv";

const getErfId = (meter) => meter?.accessData?.erfId || meter?.erfId || "NAv";

const getWardPcode = (meter) =>
  meter?.accessData?.parents?.wardPcode ||
  meter?.parents?.wardPcode ||
  meter?.wardPcode ||
  "NAv";

const getLmPcode = (meter) =>
  meter?.accessData?.parents?.lmPcode ||
  meter?.parents?.lmPcode ||
  meter?.lmPcode ||
  "NAv";

const getUpdatedAt = (meter) =>
  meter?.accessData?.metadata?.updatedAt || meter?.metadata?.updatedAt || "NAv";

const getUpdatedBy = (meter) =>
  meter?.accessData?.metadata?.updatedByUser ||
  meter?.metadata?.updatedByUser ||
  meter?.metadata?.updatedBy ||
  "NAv";

const getGpsLabel = (meter) => {
  const gps =
    meter?.ast?.location?.gps || meter?.location?.gps || meter?.gps || null;

  const lat = gps?.lat || gps?.latitude || null;
  const lng = gps?.lng || gps?.longitude || null;

  if (!lat || !lng) return "NAv";

  return `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`;
};

const getGeofenceNames = (meter) => {
  const refs = Array.isArray(meter?.geofenceRefs)
    ? meter.geofenceRefs
    : Array.isArray(meter?.ast?.geofenceRefs)
      ? meter.ast.geofenceRefs
      : [];

  if (!refs.length) return "NAv";

  return refs
    .map((ref) => ref?.name || ref?.id)
    .filter(Boolean)
    .join(", ");
};

export default function MetersPage() {
  const { all, filtered, sync, loading } = useWarehouse();
  console.log(`MetersPage all`, all);

  const allMeters = all?.meters || [];
  const meters = filtered?.meters || [];
  const meterSyncStatus = sync?.meters?.status || "idle";
  const selectedWardPcode =
    sync?.scope?.wardPcode || sync?.meters?.wardPcode || "";
  const isWaitingForMeters = isWaitingForRows({
    status: meterSyncStatus,
    loading,
    selectedWardPcode,
    rowCount: allMeters.length,
  });

  return (
    <>
      <WardScopeHeader
        showGeofenceLens
        geofenceClearLabel="Clear meters"
        stats={[
          {
            label: "Ward Meters",
            value: isWaitingForMeters ? (
              <InlineSpinner label="Loading..." />
            ) : meterSyncStatus === "ready" || meterSyncStatus === "pending" ? (
              allMeters.length
            ) : (
              meterSyncStatus
            ),
          },
          {
            label: "Visible Meters",
            value: meters.length,
          },
          {
            label: "Visible Premises",
            value: filtered?.prems?.length || 0,
          },
        ]}
      />

      <section className="table-panel">
        <div className="load-more-row">
          <div>
            <strong>Operational Meters</strong>
            <p className="muted">
              Meters are loaded through the Ward Warehouse from the operational
              ASTs collection. The geofence dropdown filters meters and premises
              through GeoContext.
            </p>
          </div>

          <div className="filter-summary">
            <strong>
              {isWaitingForMeters ? (
                <InlineSpinner label={meterSyncStatus} />
              ) : (
                meterSyncStatus
              )}
            </strong>
            <span>{meters.length} visible rows</span>
          </div>
        </div>

        {!selectedWardPcode ? (
          <div className="empty-state">
            <h2>Select a ward</h2>
            <p className="muted">
              Choose a ward above to load operational meters from the warehouse.
            </p>
          </div>
        ) : isWaitingForMeters ? (
          <LoadingState
            title="Loading meters..."
            message="Please wait while the Ward Warehouse loads operational meters from the ASTs collection."
          />
        ) : meters.length === 0 ? (
          <div className="empty-state">
            <h2>No meters loaded</h2>
            <p className="muted">
              Meter sync status: {meterSyncStatus}. If a geofence is selected, it
              may have no linked meters.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Meter No</th>
                  <th>Type</th>
                  <th>Address</th>
                  <th>ERF No</th>
                  <th>GPS</th>
                  <th>Geofence</th>
                  <th>Updated</th>
                  <th>Updated By</th>
                  <th>Meter ID</th>
                </tr>
              </thead>

              <tbody>
                {meters.map((meter) => (
                  <tr key={getMeterKey(meter)}>
                    <td>{getMeterNo(meter)}</td>
                    <td>{getMeterType(meter)}</td>
                    <td>{getPremiseAddress(meter)}</td>
                    <td title={getErfId(meter)}>{getErfNo(meter)}</td>
                    <td>{getGpsLabel(meter)}</td>
                    <td>{getGeofenceNames(meter)}</td>
                    <td>{getUpdatedAt(meter)}</td>
                    <td>{getUpdatedBy(meter)}</td>
                    <td>{getMeterKey(meter)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
