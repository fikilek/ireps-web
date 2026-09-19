import { getGeoFencePointCount } from "./geofence-map-helpers";
import { sortGeofencesNewestFirst, geofenceCreatedLabel, geofenceDescriptionLabel } from "./geofence-list.js";
import { headerActionsStyle, countPillStyle, buttonStyle, primaryButtonStyle, drawingPanelStyle, drawingStatsStyle, countDetailStyle, integrityDetailStyle, modalBackdropStyle, modalCardStyle, modalHeaderStyle, modalCloseButtonStyle, modalCountsRowStyle, confirmIntroStyle, countCardGridStyle, countCardStyle, countLabelStyle, countValueStyle, confirmDetailsStyle, confirmFieldLabelStyle, modalActionsStyle, successBoxStyle, inputStyle, textareaStyle } from "./geofence-ui-styles";
/* eslint-disable no-unused-vars -- JSX tags are used by React. */
import BusySpinner from "../../components/busy-spinner.jsx";
import { composeGeofenceName, geofenceNamePart, geofenceNamePrefix, findDuplicateGeofence, duplicateGeofenceNameMessage } from "../../../functions/geofences/geofence-name.js";

const namePrefixStyle = { padding: "10px 12px", border: "1px solid #CBD5E1", borderRadius: 10, background: "#F1F5F9", color: "#0F172A", fontWeight: 700, whiteSpace: "nowrap" };
const duplicateNameStyle = { margin: "0 0 12px", padding: "8px 10px", borderRadius: 10, border: "1px solid #FECACA", background: "#FEF2F2", color: "#B91C1C", fontSize: 13, fontWeight: 700 };
// Geofences rules GF-R003: the title and × stay fixed at the top; only the content scrolls.
const fixedHeaderCardStyle = { display: "flex", flexDirection: "column", overflow: "hidden" };
const scrollingBodyStyle = { flex: "1 1 auto", minHeight: 0, overflowY: "auto" };
function Modal({ title, children, onClose, width = 720 }) {
  return (
    <div style={modalBackdropStyle}>
      <div style={{ ...modalCardStyle, ...fixedHeaderCardStyle, maxWidth: width }}>
        <div style={{ ...modalHeaderStyle, flexShrink: 0 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>

          <button onClick={onClose} style={modalCloseButtonStyle}>
            ×
          </button>
        </div>

        <div style={scrollingBodyStyle}>{children}</div>
      </div>
    </div>
  );
}

export function GeofenceToolbar({wardControl, filterControl, geofencesLoading, geofences, setListModalOpen, handleOpenCreateModal, scopeReady, createDisabled = false, setMapTypeId, mapTypeId, selectedGeoFence, setSelectedGeoFence, isTcContext, navigate, tcId, extraActions = null}) { return (
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

          {/* TB Draft puts Create Batch here, next to Satellite (Targeted Batch rules TB-R040). */}
          {extraActions}

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
// `showStats`: the GPS Sales map shows its own count in `draftInside` instead (TB-R055).
export function GeofenceDrawingBar({isCreateMode, draftName, draftPoints, draftPolygonReady, draftPreviewStats, handleUndoPoint, handleRestartDraft, handleOpenCreateConfirm, canSaveDraft, createState, handleCancelDraft, draftInside, completeness, inline = false, showStats = true}) { return (<>
        {isCreateMode ? (
          <div style={inline ? { ...drawingPanelStyle, position: "relative", inset: "auto", marginBottom: 10 } : drawingPanelStyle}>
            <strong>Creating: {draftName}</strong>

            <span>
              Points: {draftPoints.length}{" "}
              {draftPolygonReady ? "• Ready to save" : "• Minimum 3 required"}
            </span>

            {showStats ? <span style={drawingStatsStyle}>
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
            </span> : null}

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
// `showCounts`: the GPS Sales map confirms with its own count in `draftInside` (TB-R055).
// `createError`: a message shown inside the open window (a name to type, a name just taken).
export function GeofenceDialogs({listModalOpen, wardLabel, setListModalOpen, visibleGeofences, selectedGeoFence, setSelectedGeoFence, createModalOpen, setCreateModalOpen, draftName, setDraftName, draftDescription, setDraftDescription, handleStartDrawing, confirmCreateModalOpen, setConfirmCreateModalOpen, draftPreviewStats, createState, handleConfirmCreate, createSuccess, setCreateSuccess, draftInside, completeness, overlaps = null, lockedWard = false, wardNumber = null, existingGeofences = [], showCounts = true, createError = ""}) {
  // Geofences rules GF-R002: checked as each letter is typed; a taken name cannot go on to drawing.
  const nameDuplicate = wardNumber ? findDuplicateGeofence(composeGeofenceName(wardNumber, geofenceNamePart(draftName)), existingGeofences) : null;
  return (<>
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
              {/* Geofences rules GF-R003: newest first. */}
              {sortGeofencesNewestFirst(visibleGeofences).map((geoFence) => (
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
                      <p style={{ margin: "4px 0 0", color: "#334155", fontSize: 13, fontStyle: "italic" }}>
                        {geofenceCreatedLabel(geoFence)}
                      </p>
                      <p style={{ margin: "4px 0 0", color: "#64748B" }}>
                        {geofenceDescriptionLabel(geoFence)}
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
          {/* Geofences rules GF-R001: "Gf W<Ward number> <name>". The start comes from
              the Ward and cannot be changed; the user types only the name. */}
          <label>
            Name
            {wardNumber ? (
              <span style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, marginBottom: 6 }}>
                <span style={namePrefixStyle} title="Fixed start of every geofence name (rule GF-R001)">{geofenceNamePrefix(wardNumber).trim()}</span>
                <input
                  value={geofenceNamePart(draftName)}
                  onChange={(event) => setDraftName(`${geofenceNamePrefix(wardNumber)}${event.target.value}`)}
                  placeholder="e.g. Albert Street"
                  style={{ ...inputStyle, marginTop: 0, marginBottom: 0, flex: 1 }}
                />
              </span>
            ) : (
              <input value="" disabled placeholder="Select a Ward first" style={inputStyle} />
            )}
          </label>
          {wardNumber ? (
            <p style={{ margin: "0 0 12px", color: "#475569", fontSize: 13 }}>
              Full name: <strong>{composeGeofenceName(wardNumber, geofenceNamePart(draftName)) || `${geofenceNamePrefix(wardNumber)}…`}</strong>
            </p>
          ) : null}
          {nameDuplicate ? <p role="alert" style={duplicateNameStyle}>{duplicateGeofenceNameMessage(nameDuplicate)}</p> : null}
          {createError && !nameDuplicate ? <p role="alert" style={duplicateNameStyle}>{createError}</p> : null}

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

            <button onClick={handleStartDrawing} disabled={Boolean(nameDuplicate)} style={{ ...primaryButtonStyle, opacity: nameDuplicate ? 0.45 : 1, cursor: nameDuplicate ? "not-allowed" : "pointer" }}>
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

          {showCounts ? <div style={countCardGridStyle}>
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
          </div> : null}

          {draftInside}
          {overlaps}
          {completeness}
          {createError ? <p role="alert" style={duplicateNameStyle}>{createError}</p> : null}
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
              {createState.isLoading ? <BusySpinner label="Creating…" size={14} inverse asStatus={false} /> : "Confirm Create"}
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
