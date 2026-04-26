import WardScopeHeader from "./components/WardScopeHeader";
import { useWarehouse } from "../../context/WarehouseContext";

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
  const { all, filtered, sync, scope, loading } = useWarehouse();

  const allErfs = all?.erfs || [];
  const erfs = filtered?.erfs || [];
  const selectedWardPcode = scope?.wardPcode || "";

  return (
    <>
      <WardScopeHeader
        stats={[
          {
            label: "Ward ERFs",
            value: loading
              ? "Loading..."
              : sync?.erfs?.status === "ready"
                ? allErfs.length
                : sync?.erfs?.status || "idle",
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
            <strong>{sync?.erfs?.status || "idle"}</strong>
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
        ) : erfs.length === 0 ? (
          <div className="empty-state">
            <h2>No ERFs loaded</h2>
            <p className="muted">
              ERF sync status: {sync?.erfs?.status || "idle"}. If this remains
              empty, we will check the Firestore query/index for ireps_erfs.
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
