import { getGeoFencePointCount } from "./geofence-map-helpers";
import { headerActionsStyle, countPillStyle, buttonStyle, primaryButtonStyle, drawingPanelStyle, drawingStatsStyle, countDetailStyle, integrityDetailStyle, modalBackdropStyle, modalCardStyle, modalHeaderStyle, modalCloseButtonStyle, modalCountsRowStyle, confirmIntroStyle, countCardGridStyle, countCardStyle, countLabelStyle, countValueStyle, confirmDetailsStyle, confirmFieldLabelStyle, modalActionsStyle, successBoxStyle, inputStyle, textareaStyle } from "./geofence-ui-styles";
/* eslint-disable no-unused-vars -- JSX tags are used by React. */
function Modal({ title, children, onClose, width = 720 }) {
  return (
    <div style={modalBackdropStyle}>
      <div style={{ ...modalCardStyle, maxWidth: width }}>
        <div style={modalHeaderStyle}>
          <h2 style={{ margin: 0 }}>{title}</h2>

          <button onClick={onClose} style={modalCloseButtonStyle}>
            ×
          </button>
        </div>

        {children}
      </div>
    </div>
  );
}

export function GeofenceToolbar({wardControl, filterControl, geofencesLoading, geofences, setListModalOpen, handleOpenCreateModal, scopeReady, createDisabled = false, setMapTypeId, mapTypeId, selectedGeoFence, setSelectedGeoFence, isTcContext, navigate, tcId}) { return (
        <div style={headerActionsStyle}>
          {wardControl}
          {filterControl}

          <div style={countPillStyle}>
            <span>Geofences</span>
            <strong>{geofencesLoading ? "..." : geofences.length}</strong>
          </div>

          <button onClick={() => setListModalOpen(true)} style={buttonStyle}>
            Existing Geofences
          </button>

          <button
            onClick={handleOpenCreateModal}
            disabled={!scopeReady || createDisabled}
            title={scopeReady ? "Create Geofence" : "Select a ward first"}
            style={{
              ...primaryButtonStyle,
              opacity: scopeReady && !createDisabled ? 1 : 0.45,
              cursor: scopeReady && !createDisabled ? "pointer" : "not-allowed",
            }}
          >
            Create Geofence
          </button>

          <button
            onClick={() =>
              setMapTypeId((current) =>
                current === "roadmap" ? "satellite" : "roadmap",
              )
            }
            style={buttonStyle}
          >
            {mapTypeId === "roadmap" ? "Satellite" : "Map"}
          </button>

          {selectedGeoFence ? (
            <button
              onClick={() => setSelectedGeoFence(null)}
              style={buttonStyle}
            >
              Clear Selection
            </button>
          ) : null}

          {isTcContext ? (
            <button
              onClick={() => navigate(`/operations/tc-uploads/${tcId}`)}
              style={buttonStyle}
            >
              Back to TC
            </button>
          ) : null}
        </div>
); }
export function GeofenceDrawingBar({isCreateMode, draftName, draftPoints, draftPolygonReady, draftPreviewStats, handleUndoPoint, handleRestartDraft, handleOpenCreateConfirm, canSaveDraft, createState, handleCancelDraft, draftInside, completeness, inline = false}) { return (<>
        {isCreateMode ? (
          <div style={inline ? { ...drawingPanelStyle, position: "relative", inset: "auto", marginBottom: 10 } : drawingPanelStyle}>
            <strong>Creating: {draftName}</strong>

            <span>
              Points: {draftPoints.length}{" "}
              {draftPolygonReady ? "• Ready to save" : "• Minimum 3 required"}
            </span>

            <span style={drawingStatsStyle}>
              ERFs: <strong>{draftPreviewStats.erfs}</strong> • Sales:{" "}
              <strong>{draftPreviewStats.sales.total}</strong>{" "}
              (Not Started {draftPreviewStats.sales.notStarted}, In Progress{" "}
              {draftPreviewStats.sales.inProgress}, Completed{" "}
              {draftPreviewStats.sales.completed}) • Premises:{" "}
              <strong>{draftPreviewStats.premises}</strong> • Assets:{" "}
              <strong>{draftPreviewStats.assets}</strong>
              {draftPreviewStats.sales.integrityExceptions > 0 ? (
                <>
                  {" "}
                  • Sales integrity:{" "}
                  <strong>{draftPreviewStats.sales.integrityExceptions}</strong>
                </>
              ) : null}
            </span>

            {draftInside}
            {completeness}
            <button
              onClick={handleUndoPoint}
              disabled={draftPoints.length === 0}
              style={buttonStyle}
            >
              Undo
            </button>

            <button
              onClick={handleRestartDraft}
              disabled={draftPoints.length === 0}
              style={buttonStyle}
            >
              Restart
            </button>

            <button
              onClick={handleOpenCreateConfirm}
              disabled={!canSaveDraft}
              style={{
                ...primaryButtonStyle,
                opacity: canSaveDraft ? 1 : 0.45,
              }}
            >
              {createState.isLoading ? "Saving..." : "Save"}
            </button>

            <button onClick={handleCancelDraft} style={buttonStyle}>
              Cancel
            </button>
          </div>
        ) : null}
</>); }
export function GeofenceDialogs({listModalOpen, wardLabel, setListModalOpen, visibleGeofences, selectedGeoFence, setSelectedGeoFence, createModalOpen, setCreateModalOpen, draftName, setDraftName, draftDescription, setDraftDescription, handleStartDrawing, confirmCreateModalOpen, setConfirmCreateModalOpen, draftPreviewStats, createState, handleConfirmCreate, createSuccess, setCreateSuccess, draftInside, completeness, overlaps = null, lockedWard = false}) { return (<>
      {listModalOpen ? (
        <Modal
          title={`Existing Geofences in ${wardLabel}`}
          onClose={() => setListModalOpen(false)}
          width={860}
        >
          {visibleGeofences.length === 0 ? (
            <p>No active geofences found in this ward.</p>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {visibleGeofences.map((geoFence) => (
                <div
                  key={geoFence.id}
                  style={{
                    border: "1px solid #E5E7EB",
                    borderRadius: 12,
                    padding: 12,
                    background:
                      selectedGeoFence?.id === geoFence.id
                        ? "#FEF3C7"
                        : "white",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <div>
                      <strong>{geoFence.name || geoFence.id}</strong>

                      {geoFence.targetedBatch && <p>{geoFence.targetedBatch.tbId} · {geoFence.targetedBatch.linkState}</p>}
                      <p style={{ margin: "4px 0 0", color: "#64748B" }}>
                        {geoFence.description || "NAv"}
                      </p>
                    </div>

                    <button
                      onClick={() => {
                        setSelectedGeoFence(geoFence);
                        setListModalOpen(false);
                      }}
                      style={buttonStyle}
                    >
                      Show on map
                    </button>
                  </div>

                  <div style={modalCountsRowStyle}>
                    <span>ERFs: {geoFence?.counts?.erfs || 0}</span>
                    <span>Premises: {geoFence?.counts?.premises || 0}</span>
                    <span>Meters: {geoFence?.counts?.meters || 0}</span>
                    <span>Points: {getGeoFencePointCount(geoFence)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      ) : null}

      {createModalOpen ? (
        <Modal
          title="Create New Geofence"
          onClose={() => setCreateModalOpen(false)}
          width={620}
        >
          {lockedWard && <p>Ward: <strong>{wardLabel}</strong></p>}
          <label>
            Name
            <input
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              placeholder="e.g. Ward 6 Block A"
              style={inputStyle}
            />
          </label>

          <label>
            Description
            <textarea
              value={draftDescription}
              onChange={(event) => setDraftDescription(event.target.value)}
              placeholder="Optional description"
              style={textareaStyle}
            />
          </label>

          <p style={{ color: "#64748B", fontSize: 13 }}>
            After clicking Start Drawing, click points directly on the map.
            Minimum 3 points are required.
          </p>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button
              onClick={() => setCreateModalOpen(false)}
              style={buttonStyle}
            >
              Cancel
            </button>

            <button onClick={handleStartDrawing} style={primaryButtonStyle}>
              Start Drawing
            </button>
          </div>
        </Modal>
      ) : null}

      {confirmCreateModalOpen ? (
        <Modal
          title="Confirm Geofence"
          onClose={() => setConfirmCreateModalOpen(false)}
          width={760}
        >
          <p style={confirmIntroStyle}>
            You are about to create this geofence. Please confirm the selected
            coverage.
          </p>

          <div style={countCardGridStyle}>
            <div style={countCardStyle}>
              <span style={countLabelStyle}>ERFs</span>
              <strong style={countValueStyle}>{draftPreviewStats.erfs}</strong>
            </div>

            <div style={countCardStyle}>
              <span style={countLabelStyle}>Sales</span>
              <strong style={countValueStyle}>{draftPreviewStats.sales.total}</strong>
              <span style={countDetailStyle}>
                Not Started {draftPreviewStats.sales.notStarted} • In Progress{" "}
                {draftPreviewStats.sales.inProgress} • Completed{" "}
                {draftPreviewStats.sales.completed}
              </span>
              {draftPreviewStats.sales.integrityExceptions > 0 ? (
                <span style={integrityDetailStyle}>
                  Integrity: {draftPreviewStats.sales.integrityExceptions}
                </span>
              ) : null}
            </div>

            <div style={countCardStyle}>
              <span style={countLabelStyle}>Premises</span>
              <strong style={countValueStyle}>{draftPreviewStats.premises}</strong>
            </div>

            <div style={countCardStyle}>
              <span style={countLabelStyle}>Assets</span>
              <strong style={countValueStyle}>{draftPreviewStats.assets}</strong>
            </div>
          </div>

          {draftInside}
          {overlaps}
          {completeness}
          <div style={confirmDetailsStyle}>
            <div>
              <span style={confirmFieldLabelStyle}>Geofence Name</span>
              <strong>{draftName.trim()}</strong>
            </div>

            <div>
              <span style={confirmFieldLabelStyle}>Ward</span>
              <strong>{wardLabel}</strong>
            </div>
          </div>

          <div style={modalActionsStyle}>
            <button
              onClick={() => setConfirmCreateModalOpen(false)}
              disabled={createState.isLoading}
              style={buttonStyle}
            >
              Cancel
            </button>

            <button
              onClick={handleConfirmCreate}
              disabled={createState.isLoading}
              style={{
                ...primaryButtonStyle,
                opacity: createState.isLoading ? 0.55 : 1,
                cursor: createState.isLoading ? "not-allowed" : "pointer",
              }}
            >
              {createState.isLoading ? "Creating..." : "Confirm Create"}
            </button>
          </div>
        </Modal>
      ) : null}

      {createSuccess ? (
        <Modal
          title="Geofence Created"
          onClose={() => setCreateSuccess(null)}
          width={760}
        >
          <div style={successBoxStyle}>
            <strong>{createSuccess.name}</strong> was created successfully in{" "}
            <strong>{createSuccess.wardLabel}</strong>.
          </div>

          <div style={countCardGridStyle}>
            <div style={countCardStyle}>
              <span style={countLabelStyle}>ERFs planned</span>
              <strong style={countValueStyle}>{createSuccess.stats.erfs}</strong>
            </div>

            <div style={countCardStyle}>
              <span style={countLabelStyle}>Sales planned</span>
              <strong style={countValueStyle}>{createSuccess.stats.sales.total}</strong>
              <span style={countDetailStyle}>
                Not Started {createSuccess.stats.sales.notStarted} • In Progress{" "}
                {createSuccess.stats.sales.inProgress} • Completed{" "}
                {createSuccess.stats.sales.completed}
              </span>
            </div>

            <div style={countCardStyle}>
              <span style={countLabelStyle}>Premises planned</span>
              <strong style={countValueStyle}>{createSuccess.stats.premises}</strong>
            </div>

            <div style={countCardStyle}>
              <span style={countLabelStyle}>Assets planned</span>
              <strong style={countValueStyle}>{createSuccess.stats.assets}</strong>
            </div>
          </div>

          <p style={{ color: "#475569", marginTop: 16 }}>
            iREPS has submitted the geofence creation request. These are the
            planning-preview counts; authoritative ERF, premise, asset and Sales
            membership will update through the normal geofence membership process.
            {createSuccess.isTcContext
              ? " TC readiness will also update automatically."
              : ""}
          </p>

          <div style={modalActionsStyle}>
            <button
              onClick={() => setCreateSuccess(null)}
              style={primaryButtonStyle}
            >
              OK
            </button>
          </div>
        </Modal>
      ) : null}
</>); }
