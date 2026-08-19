/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useEffect, useMemo, useState } from "react";

import { useGetTrnByIdQuery } from "../../../redux/trnsApi";

const NAV = "NAv";

const ACRONYMS = new Map([
  ["ast", "AST"],
  ["gps", "GPS"],
  ["trn", "TRN"],
  ["cb", "CB"],
  ["id", "ID"],
  ["no", "No"],
]);

function isMeaningful(value) {
  if (value === 0 || value === false) return true;
  if (value === null || value === undefined) return false;

  const text = String(value).trim();
  if (!text) return false;

  return !["NAV", "N/AV", "N/A", "NA", "NULL", "UNDEFINED"].includes(
    text.toUpperCase(),
  );
}

function formatMediaTag(value) {
  if (!isMeaningful(value)) return "Media";

  const tokens = String(value)
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  return tokens
    .map((token) => {
      const lower = token.toLowerCase();
      if (ACRONYMS.has(lower)) return ACRONYMS.get(lower);
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function formatLabel(value) {
  if (!isMeaningful(value)) return NAV;

  return String(value)
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (ACRONYMS.has(lower)) return ACRONYMS.get(lower);
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function formatDateTime(value) {
  if (!isMeaningful(value)) return NAV;

  if (typeof value?.toDate === "function") {
    return value.toDate().toLocaleString();
  }

  if (typeof value?.seconds === "number") {
    return new Date(value.seconds * 1000).toLocaleString();
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleString();
  }

  return String(value);
}

function formatCoordinate(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue.toFixed(7) : NAV;
}

function normalizeMediaItem(item, index) {
  const media = item && typeof item === "object" ? item : {};

  return {
    key: `${index}-${media.url || media.tag || "media"}`,
    url: isMeaningful(media.url) ? String(media.url) : null,
    tag: formatMediaTag(media.tag),
    rawTag: media.tag || null,
    type: formatLabel(media.type),
    createdByUser: media.created?.byUser || NAV,
    createdByUid: media.created?.byUid || NAV,
    createdAt: media.created?.at || null,
    latitude: media.gps?.lat,
    longitude: media.gps?.lng,
  };
}

function getMeterNo(trn = {}, raw = {}) {
  return (
    raw.inspection?.captured?.ast?.astData?.astNo ||
    raw.ast?.astData?.astNo ||
    trn.astNo ||
    NAV
  );
}

function MediaImage({ media, alt, style, eager = false }) {
  const [failedUrl, setFailedUrl] = useState(null);
  const hasError = Boolean(media?.url && failedUrl === media.url);

  if (!media?.url || hasError) {
    return (
      <div style={{ ...styles.imageFallback, ...style }} role="img" aria-label={alt}>
        <span aria-hidden="true" style={styles.fallbackIcon}>
          🖼️
        </span>
        <strong>Media unavailable</strong>
      </div>
    );
  }

  return (
    <img
      src={media.url}
      alt={alt}
      style={style}
      loading={eager ? "eager" : "lazy"}
      onError={() => setFailedUrl(media.url)}
    />
  );
}

function MetadataRow({ label, value, wide = false }) {
  return (
    <div style={wide ? styles.metadataRowWide : styles.metadataRow}>
      <span style={styles.metadataLabel}>{label}</span>
      <strong style={styles.metadataValue}>{isMeaningful(value) ? value : NAV}</strong>
    </div>
  );
}

export default function TrnMediaGalleryModal({ trnId, onClose }) {
  const [selectedIndex, setSelectedIndex] = useState(null);

  const {
    data: trn,
    isLoading,
    isFetching,
    error,
  } = useGetTrnByIdQuery(trnId);

  const raw = trn?.raw || {};

  const mediaItems = useMemo(
    () =>
      (Array.isArray(raw.media) ? raw.media : []).map((item, index) =>
        normalizeMediaItem(item, index),
      ),
    [raw.media],
  );

  const selectedMedia =
    selectedIndex === null ? null : mediaItems[selectedIndex] || null;

  const meterNo = getMeterNo(trn, raw);
  const trnType = formatLabel(
    raw.accessData?.trnType || raw.trnType || trn?.trnType,
  );


  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        if (selectedIndex !== null) {
          setSelectedIndex(null);
        } else {
          onClose?.();
        }
      }

      if (selectedIndex !== null && event.key === "ArrowLeft") {
        setSelectedIndex((current) =>
          current === null
            ? null
            : (current - 1 + mediaItems.length) % mediaItems.length,
        );
      }

      if (selectedIndex !== null && event.key === "ArrowRight") {
        setSelectedIndex((current) =>
          current === null ? null : (current + 1) % mediaItems.length,
        );
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mediaItems.length, onClose, selectedIndex]);

  function handleBackdropClick(event) {
    if (event.target === event.currentTarget) onClose?.();
  }

  function showPrevious() {
    if (!mediaItems.length) return;

    setSelectedIndex((current) =>
      current === null
        ? null
        : (current - 1 + mediaItems.length) % mediaItems.length,
    );
  }

  function showNext() {
    if (!mediaItems.length) return;

    setSelectedIndex((current) =>
      current === null ? null : (current + 1) % mediaItems.length,
    );
  }

  return (
    <div
      style={styles.backdrop}
      onMouseDown={handleBackdropClick}
      role="presentation"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="trn-media-gallery-title"
        style={styles.modal}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header style={styles.header}>
          <div style={styles.headerText}>
            <div style={styles.eyebrow}>TRN Media</div>
            <h2 id="trn-media-gallery-title" style={styles.title}>
              {selectedMedia ? selectedMedia.tag : "Media Gallery"}
            </h2>
            <div style={styles.contextLine}>
              <span>
                <strong>TRN:</strong> {trnId || NAV}
              </span>
              <span>
                <strong>Meter:</strong> {meterNo}
              </span>
              <span>
                <strong>Type:</strong> {trnType}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={styles.closeButton}
            aria-label="Close TRN media gallery"
          >
            Close
          </button>
        </header>

        <div style={styles.body}>
          {isLoading || isFetching ? (
            <div style={styles.stateCard}>
              <strong>Loading TRN media...</strong>
              <span>Reading the exact TRN record.</span>
            </div>
          ) : null}

          {!isLoading && !isFetching && error ? (
            <div style={styles.errorCard}>
              <strong>Unable to load TRN media.</strong>
              <span>
                {error?.error ||
                  error?.data?.message ||
                  "The exact TRN could not be read."}
              </span>
            </div>
          ) : null}

          {!isLoading && !isFetching && !error && !trn ? (
            <div style={styles.stateCard}>
              <strong>TRN not found.</strong>
              <span>No canonical TRN record was returned for this TRN ID.</span>
            </div>
          ) : null}

          {!isLoading &&
          !isFetching &&
          !error &&
          trn &&
          mediaItems.length === 0 ? (
            <div style={styles.stateCard}>
              <strong>No media was captured for this TRN.</strong>
              <span>The exact TRN contains no media items.</span>
            </div>
          ) : null}

          {!isLoading &&
          !isFetching &&
          !error &&
          mediaItems.length > 0 &&
          selectedMedia === null ? (
            <>
              <div style={styles.summaryBar}>
                <div>
                  <strong style={styles.summaryCount}>{mediaItems.length}</strong>{" "}
                  Media Item{mediaItems.length === 1 ? "" : "s"}
                </div>
                <span style={styles.summaryHint}>
                  Select a photo to view it larger with capture metadata.
                </span>
              </div>

              <div style={styles.galleryGrid}>
                {mediaItems.map((media, index) => (
                  <button
                    type="button"
                    key={media.key}
                    style={styles.galleryCard}
                    onClick={() => setSelectedIndex(index)}
                    aria-label={`Open ${media.tag}`}
                  >
                    <div style={styles.thumbnailFrame}>
                      <MediaImage
                        media={media}
                        alt={media.tag}
                        style={styles.thumbnail}
                      />
                    </div>

                    <div style={styles.cardBody}>
                      <strong style={styles.cardTitle}>{media.tag}</strong>
                      <span style={styles.cardMeta}>
                        {media.createdByUser || NAV}
                      </span>
                      <span style={styles.cardMeta}>
                        {formatDateTime(media.createdAt)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {!isLoading &&
          !isFetching &&
          !error &&
          selectedMedia !== null ? (
            <div style={styles.detailView}>
              <div style={styles.detailToolbar}>
                <button
                  type="button"
                  style={styles.secondaryButton}
                  onClick={() => setSelectedIndex(null)}
                >
                  ← Back To Gallery
                </button>

                <div style={styles.detailCounter}>
                  {selectedIndex + 1} / {mediaItems.length}
                </div>

                <div style={styles.navigationButtons}>
                  <button
                    type="button"
                    style={styles.secondaryButton}
                    onClick={showPrevious}
                    disabled={mediaItems.length < 2}
                    aria-label="Previous media item"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    style={styles.secondaryButton}
                    onClick={showNext}
                    disabled={mediaItems.length < 2}
                    aria-label="Next media item"
                  >
                    Next
                  </button>
                </div>
              </div>

              <div style={styles.detailImageFrame}>
                <MediaImage
                  media={selectedMedia}
                  alt={selectedMedia.tag}
                  style={styles.detailImage}
                  eager
                />
              </div>

              <section style={styles.metadataSection}>
                <h3 style={styles.sectionTitle}>Media Detail</h3>

                <div style={styles.metadataGrid}>
                  <MetadataRow label="Tag" value={selectedMedia.tag} />
                  <MetadataRow label="Media Type" value={selectedMedia.type} />
                  <MetadataRow
                    label="Captured By"
                    value={selectedMedia.createdByUser}
                  />
                  <MetadataRow
                    label="Captured At"
                    value={formatDateTime(selectedMedia.createdAt)}
                  />
                  <MetadataRow
                    label="GPS Latitude"
                    value={formatCoordinate(selectedMedia.latitude)}
                  />
                  <MetadataRow
                    label="GPS Longitude"
                    value={formatCoordinate(selectedMedia.longitude)}
                  />
                </div>
              </section>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

const styles = {
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 1400,
    background: "rgba(15, 23, 42, 0.72)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "clamp(0rem, 2vw, 1.25rem)",
  },
  modal: {
    width: "min(1120px, 96vw)",
    maxHeight: "88vh",
    background: "#fff",
    borderRadius: "1rem",
    boxShadow: "0 24px 80px rgba(15, 23, 42, 0.35)",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    position: "sticky",
    top: 0,
    zIndex: 2,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "1rem",
    padding: "1rem 1.25rem",
    background: "#0f172a",
    color: "#fff",
    borderBottom: "1px solid rgba(148, 163, 184, 0.35)",
  },
  headerText: {
    minWidth: 0,
  },
  eyebrow: {
    fontSize: "0.72rem",
    fontWeight: 900,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "#93c5fd",
  },
  title: {
    margin: "0.2rem 0 0.35rem",
    fontSize: "clamp(1.25rem, 2.8vw, 1.75rem)",
    lineHeight: 1.15,
    overflowWrap: "anywhere",
  },
  contextLine: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.45rem 1rem",
    color: "#cbd5e1",
    fontSize: "0.82rem",
    overflowWrap: "anywhere",
  },
  closeButton: {
    flex: "0 0 auto",
    border: "1px solid rgba(255,255,255,0.32)",
    background: "rgba(255,255,255,0.08)",
    color: "#fff",
    borderRadius: "0.65rem",
    padding: "0.55rem 0.85rem",
    fontWeight: 850,
    cursor: "pointer",
  },
  body: {
    overflowY: "auto",
    padding: "1rem 1.25rem 1.35rem",
  },
  stateCard: {
    minHeight: "13rem",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.5rem",
    border: "1px dashed #cbd5e1",
    borderRadius: "0.9rem",
    background: "#f8fafc",
    color: "#475569",
    textAlign: "center",
    padding: "1.5rem",
  },
  errorCard: {
    minHeight: "13rem",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.5rem",
    border: "1px solid #fecaca",
    borderRadius: "0.9rem",
    background: "#fef2f2",
    color: "#991b1b",
    textAlign: "center",
    padding: "1.5rem",
  },
  summaryBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "1rem",
    flexWrap: "wrap",
    marginBottom: "1rem",
    padding: "0.8rem 0.9rem",
    border: "1px solid #e2e8f0",
    borderRadius: "0.8rem",
    background: "#f8fafc",
    color: "#334155",
  },
  summaryCount: {
    color: "#0f172a",
    fontSize: "1.05rem",
  },
  summaryHint: {
    color: "#64748b",
    fontSize: "0.82rem",
  },
  galleryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(230px, 100%), 1fr))",
    gap: "1rem",
  },
  galleryCard: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    border: "1px solid #e2e8f0",
    borderRadius: "0.85rem",
    padding: 0,
    background: "#fff",
    color: "#0f172a",
    overflow: "hidden",
    cursor: "pointer",
    textAlign: "left",
    boxShadow: "0 4px 14px rgba(15, 23, 42, 0.06)",
  },
  thumbnailFrame: {
    width: "100%",
    aspectRatio: "4 / 3",
    background: "#e2e8f0",
    overflow: "hidden",
  },
  thumbnail: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  },
  imageFallback: {
    width: "100%",
    height: "100%",
    minHeight: "10rem",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.45rem",
    background: "#e2e8f0",
    color: "#64748b",
    textAlign: "center",
  },
  fallbackIcon: {
    fontSize: "2rem",
  },
  cardBody: {
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
    padding: "0.8rem 0.9rem 0.9rem",
  },
  cardTitle: {
    fontSize: "0.95rem",
    overflowWrap: "anywhere",
  },
  cardMeta: {
    color: "#64748b",
    fontSize: "0.78rem",
    overflowWrap: "anywhere",
  },
  detailView: {
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
  },
  detailToolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.75rem",
    flexWrap: "wrap",
  },
  detailCounter: {
    color: "#475569",
    fontSize: "0.85rem",
    fontWeight: 800,
  },
  navigationButtons: {
    display: "flex",
    gap: "0.5rem",
  },
  secondaryButton: {
    border: "1px solid #cbd5e1",
    background: "#fff",
    color: "#0f172a",
    borderRadius: "0.65rem",
    padding: "0.52rem 0.75rem",
    fontWeight: 800,
    cursor: "pointer",
  },
  detailImageFrame: {
    minHeight: "18rem",
    maxHeight: "56vh",
    borderRadius: "0.9rem",
    background: "#0f172a",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  detailImage: {
    width: "100%",
    height: "100%",
    maxHeight: "56vh",
    objectFit: "contain",
    display: "block",
  },
  metadataSection: {
    border: "1px solid #e2e8f0",
    borderRadius: "0.9rem",
    padding: "1rem",
    background: "#fff",
  },
  sectionTitle: {
    margin: "0 0 0.75rem",
    fontSize: "0.88rem",
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "#334155",
  },
  metadataGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))",
    gap: "0.65rem",
  },
  metadataRow: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.15rem",
    padding: "0.65rem 0.7rem",
    borderRadius: "0.65rem",
    background: "#f8fafc",
  },
  metadataRowWide: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.15rem",
    padding: "0.65rem 0.7rem",
    borderRadius: "0.65rem",
    background: "#f8fafc",
    gridColumn: "1 / -1",
  },
  metadataLabel: {
    color: "#64748b",
    fontSize: "0.72rem",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  metadataValue: {
    color: "#0f172a",
    fontSize: "0.88rem",
    overflowWrap: "anywhere",
  },
};
