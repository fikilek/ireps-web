function formatNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue.toLocaleString() : "0";
}

export default function DesktopGeoCascadingSelector({
  activeLmPcode,
  lmBoundary,
  lmStatus,

  wardBoundaries,
  wardStatus,
  selectedWardPcode,
  onSelectWard,

  showGeoFences,
  onToggleGeoFences,
  geoFences,
  geoFenceStatus,
  selectedGeoFenceId,
  onSelectGeoFence,
}) {
  const selectedWard =
    wardBoundaries.find((ward) => ward.wardPcode === selectedWardPcode) || null;

  const selectedGeoFence =
    geoFences.find((geoFence) => geoFence.id === selectedGeoFenceId) || null;

  return (
    <section className="geo-selector">
      <div className="geo-selector-header">
        <p className="eyebrow">Geo Scope</p>
        <h2>Navigation</h2>
        <p className="muted">
          Reporting-only map navigation. No creating or editing field data.
        </p>
      </div>

      <div className="geo-selector-step active">
        <div className="geo-step-topline">
          <span>1. Local Municipality</span>
          <strong>{lmStatus}</strong>
        </div>

        <div className="geo-selected-value">
          {lmBoundary?.name || activeLmPcode || "NAv"}
        </div>

        <p className="muted">
          {activeLmPcode || "No active LM"} · LM boundary and ward boundaries
        </p>
      </div>

      <div className="geo-selector-step">
        <div className="geo-step-topline">
          <span>2. Ward</span>
          <strong>{wardStatus}</strong>
        </div>

        <select
          value={selectedWardPcode}
          onChange={(event) => onSelectWard(event.target.value)}
          disabled={!wardBoundaries.length}
        >
          <option value="">Select ward</option>

          {wardBoundaries.map((ward) => (
            <option key={ward.wardPcode} value={ward.wardPcode}>
              Ward {ward.wardNumber} · {ward.wardPcode}
            </option>
          ))}
        </select>

        <p className="muted">
          {selectedWard
            ? `${selectedWard.name} selected`
            : "Select or click a ward boundary."}
        </p>
      </div>

      <div className="geo-selector-step lens">
        <div className="geo-step-topline">
          <span>Geofence Lens</span>
          <strong>{geoFenceStatus}</strong>
        </div>

        <label className="map-checkbox-row">
          <input
            type="checkbox"
            checked={showGeoFences}
            onChange={(event) => onToggleGeoFences(event.target.checked)}
          />
          Show geofence overlays
        </label>

        <select
          value={selectedGeoFenceId}
          onChange={(event) => onSelectGeoFence(event.target.value)}
          disabled={!showGeoFences || !geoFences.length}
        >
          <option value="">Select geofence</option>

          {geoFences.map((geoFence) => (
            <option key={geoFence.id} value={geoFence.id}>
              {geoFence.name} · {formatNumber(geoFence.premiseCount)} premises ·{" "}
              {formatNumber(geoFence.meterCount)} meters
            </option>
          ))}
        </select>

        <p className="muted">
          {selectedGeoFence
            ? `${selectedGeoFence.name}: ${formatNumber(
                selectedGeoFence.erfCount,
              )} ERFs, ${formatNumber(
                selectedGeoFence.premiseCount,
              )} premises, ${formatNumber(selectedGeoFence.meterCount)} meters`
            : selectedWardPcode
              ? "Showing geofences in selected ward."
              : "Showing active LM geofences."}
        </p>
      </div>

      {/* <div className="geo-selector-step disabled">
        <div className="geo-step-topline">
          <span>3. ERF</span>
          <strong>Coming next</strong>
        </div>

        <select disabled>
          <option>Select ERF after ward layer is ready</option>
        </select>

        <p className="muted">
          ERF selection will fly to the ERF and show premises inside it.
        </p>
      </div>

      <div className="geo-selector-step disabled">
        <div className="geo-step-topline">
          <span>4. Premise</span>
          <strong>Coming later</strong>
        </div>

        <select disabled>
          <option>Select premise after ERF/premise layer is ready</option>
        </select>

        <p className="muted">
          Premise selection will fly to premise and show meters inside it.
        </p>
      </div>

      <div className="geo-selector-step disabled">
        <div className="geo-step-topline">
          <span>5. Meter</span>
          <strong>Coming later</strong>
        </div>

        <select disabled>
          <option>Select meter after meter layer is ready</option>
        </select>

        <p className="muted">
          Meter selection will fly to meter and draw a connector line to the
          parent premise.
        </p>
      </div> */}
    </section>
  );
}
