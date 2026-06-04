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


const getErfKey = (erf) => erf?.erfId || erf?.id || erf?.erfNo || "NAv";

const getErfNo = (erf) => erf?.erfNo || erf?.sg?.parcelNo || "NAv";

const getErfType = (erf) => erf?.type || erf?.erfType || "NAv";

const getPremiseCount = (erf) => {
  if (Array.isArray(erf?.premiseIds)) return erf.premiseIds.length;
  if (Array.isArray(erf?.premises)) return erf.premises.length;
  if (typeof erf?.premiseCount === "number") return erf.premiseCount;

  return 0;
};

export default function ErfsPage() {
  const { all, filtered, sync, loading } = useWarehouse();

  const allErfs = all?.erfs || [];
  const erfs = filtered?.erfs || [];
  const erfSyncStatus = sync?.erfs?.status || "idle";
  const selectedWardPcode =
    sync?.scope?.wardPcode || sync?.erfs?.wardPcode || "";
  const isWaitingForErfs = isWaitingForRows({
    status: erfSyncStatus,
    loading,
    selectedWardPcode,
    rowCount: allErfs.length,
  });

  return (
    <>
      <WardScopeHeader
        stats={[
          {
            label: "Ward ERFs",
            value: isWaitingForErfs ? (
              <InlineSpinner label="Loading..." />
            ) : erfSyncStatus === "ready" ? (
              allErfs.length
            ) : (
              erfSyncStatus
            ),
          },
          {
            label: "Premises Loaded",
            value: filtered?.prems?.length || 0,
          },
        ]}
      />

      <section className="table-panel">
        <div className="load-more-row">
          <div>
            <strong>Operational ERFs</strong>
            <p className="muted">
              ERFs are loaded through the Ward Warehouse for the selected ward.
            </p>
          </div>

          <div className="filter-summary">
            <strong>
              {isWaitingForErfs ? (
                <InlineSpinner label={erfSyncStatus} />
              ) : (
                erfSyncStatus
              )}
            </strong>
            <span>{erfs.length} visible rows</span>
          </div>
        </div>

        {!selectedWardPcode ? (
          <div className="empty-state">
            <h2>Select a ward</h2>
            <p className="muted">
              Choose a ward above to load operational ERFs from the warehouse.
            </p>
          </div>
        ) : isWaitingForErfs ? (
          <LoadingState
            title="Loading ERFs..."
            message="Please wait while the Ward Warehouse loads operational ERFs for the selected ward."
          />
        ) : erfs.length === 0 ? (
          <div className="empty-state">
            <h2>No ERFs loaded</h2>
            <p className="muted">
              ERF sync status: {erfSyncStatus}. If this remains empty, we will
              check the Firestore query/index for ireps_erfs.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ERF No</th>
                  <th>Type</th>
                  <th>Ward</th>
                  <th>LM</th>
                  <th>Premises</th>
                  <th>ERF ID</th>
                </tr>
              </thead>

              <tbody>
                {erfs.map((erf) => (
                  <tr key={getErfKey(erf)}>
                    <td>{getErfNo(erf)}</td>
                    <td>{getErfType(erf)}</td>
                    <td>{erf?.wardPcode || "NAv"}</td>
                    <td>{erf?.lmPcode || "NAv"}</td>
                    <td>{getPremiseCount(erf)}</td>
                    <td>{erf?.erfId || erf?.id || "NAv"}</td>
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
