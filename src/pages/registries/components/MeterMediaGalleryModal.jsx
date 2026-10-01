/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
// The Meter Registry's pictures window.
//
// A meter's pictures live in two places: the photographs taken when it was
// registered, and the photographs of every transaction it has been through
// since. The office has never been able to see them in one place. This window
// gathers both, newest work first, and says where each one came from.
import { useEffect, useMemo, useState } from "react";

import { useGetMeterDossierQuery } from "../../../redux/creditControlApi";

const MODAL_CSS = `
.mm-overlay {
  position: fixed; inset: 0; z-index: 1200;
  background: rgba(15, 23, 42, .6);
  display: flex; align-items: center; justify-content: center; padding: 16px;
}
.mm-card {
  background: #fff; border-radius: 10px; width: min(960px, 100%);
  max-height: 88vh; display: flex; flex-direction: column;
  box-shadow: 0 18px 40px rgba(15, 23, 42, .3);
}
.mm-header {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  padding: 14px 18px; border-bottom: 1px solid #e2e8f0;
}
.mm-eyebrow { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #64748b; }
.mm-header h2 { margin: 2px 0 0; font-size: 18px; }
.mm-sub { font-size: 12.5px; color: #64748b; margin-top: 2px; }
.mm-close { border: 1px solid #cbd5e1; background: #f8fafc; border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 13px; }
.mm-body { padding: 14px 18px 18px; overflow: auto; }
.mm-group { margin-bottom: 18px; }
.mm-group-title {
  font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: #334155;
  font-weight: 800; margin-bottom: 8px;
}
.mm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 12px; }
.mm-item {
  border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; background: #f8fafc;
  display: flex; flex-direction: column; cursor: pointer; padding: 0; font: inherit; text-align: left;
}
.mm-thumb { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; display: block; background: #e2e8f0; }
.mm-missing {
  width: 100%; aspect-ratio: 4 / 3; display: flex; align-items: center; justify-content: center;
  color: #94a3b8; font-size: 12px; background: #e2e8f0;
}
.mm-meta { padding: 7px 9px; display: flex; flex-direction: column; gap: 2px; }
.mm-tag { font-size: 12px; font-weight: 700; color: #0f172a; }
.mm-when { font-size: 11px; color: #64748b; font-variant-numeric: tabular-nums; }
.mm-state { padding: 18px; color: #64748b; font-size: 14px; }
.mm-full {
  position: fixed; inset: 0; z-index: 1300; background: rgba(15, 23, 42, .85);
  display: flex; align-items: center; justify-content: center; padding: 24px; cursor: zoom-out;
}
.mm-full img { max-width: 100%; max-height: 100%; border-radius: 8px; }
`;

function formatTag(value) {
  const text = String(value || "").trim();

  if (!text) return "Photograph";

  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function formatWork(value) {
  return String(value || "NAv")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatWhen(value) {
  if (!value || value === "NAv") return "NAv";
  if (typeof value === "string") return value.slice(0, 16).replace("T", " ");
  if (typeof value?.toDate === "function") return value.toDate().toLocaleString();

  return "NAv";
}

function pictureOf(item, source, index) {
  return {
    key: `${source}-${index}-${item?.url || item?.tag || "media"}`,
    url: String(item?.url || "").trim(),
    tag: formatTag(item?.tag),
    when: item?.created?.at || item?.updated?.at || null,
    by: item?.created?.byUser || "NAv",
  };
}

export default function MeterMediaGalleryModal({
  meterId,
  meterNo,
  premiseAddress,
  onClose,
}) {
  const [fullSize, setFullSize] = useState(null);

  const {
    data: dossier,
    isLoading,
    isFetching,
    error,
  } = useGetMeterDossierQuery(meterId, { skip: !meterId });

  const groups = useMemo(() => {
    if (!dossier) return [];

    const meterPictures = (Array.isArray(dossier.meter?.media) ? dossier.meter.media : [])
      .map((item, index) => pictureOf(item, "meter", index))
      .filter((picture) => picture.url);

    const fromWork = (dossier.transactions || [])
      .map((trn) => ({
        title: `${formatWork(trn?.accessData?.trnType || trn?.trnType)} · ${formatWhen(trn?.metadata?.updatedAt)}`,
        pictures: (Array.isArray(trn.media) ? trn.media : [])
          .map((item, index) => pictureOf(item, trn.id, index))
          .filter((picture) => picture.url),
      }))
      .filter((group) => group.pictures.length > 0);

    return [
      ...(meterPictures.length
        ? [{ title: "When the meter was registered", pictures: meterPictures }]
        : []),
      ...fromWork,
    ];
  }, [dossier]);

  const total = groups.reduce((count, group) => count + group.pictures.length, 0);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key !== "Escape") return;
      if (fullSize) setFullSize(null);
      else onClose?.();
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, fullSize]);

  return (
    <div
      className="mm-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="meter-media-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <style>{MODAL_CSS}</style>

      <div className="mm-card">
        <header className="mm-header">
          <div>
            <div className="mm-eyebrow">Pictures of this meter</div>
            <h2 id="meter-media-title">{meterNo || meterId}</h2>
            <div className="mm-sub">
              {premiseAddress || "NAv"}
              {total ? ` · ${total} picture${total === 1 ? "" : "s"}` : ""}
            </div>
          </div>

          <button type="button" className="mm-close" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="mm-body">
          {isLoading || isFetching ? (
            <div className="mm-state">Gathering this meter's pictures…</div>
          ) : error ? (
            <div className="mm-state">
              The pictures could not be read. {error?.error || ""}
            </div>
          ) : total === 0 ? (
            <div className="mm-state">
              No pictures have been taken of this meter.
            </div>
          ) : (
            groups.map((group) => (
              <div className="mm-group" key={group.title}>
                <div className="mm-group-title">{group.title}</div>

                <div className="mm-grid">
                  {group.pictures.map((picture) => (
                    <button
                      type="button"
                      className="mm-item"
                      key={picture.key}
                      onClick={() => setFullSize(picture)}
                      title="Open this picture"
                    >
                      <img
                        className="mm-thumb"
                        src={picture.url}
                        alt={picture.tag}
                        loading="lazy"
                      />
                      <span className="mm-meta">
                        <span className="mm-tag">{picture.tag}</span>
                        <span className="mm-when">
                          {formatWhen(picture.when)} · {picture.by}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {fullSize ? (
        <div className="mm-full" onClick={() => setFullSize(null)}>
          <img src={fullSize.url} alt={fullSize.tag} />
        </div>
      ) : null}
    </div>
  );
}
