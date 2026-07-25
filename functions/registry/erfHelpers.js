// registry/erfHelpers.js

// -----------------------------
// 🧩 Build ERF Number (STRING)
// -----------------------------
export const buildErfNo = (sg = {}) => {
  const parcelNo = String(sg?.parcelNo ?? "").trim();
  const portion = Number(sg?.portion ?? 0);

  if (!parcelNo) return "NAv";
  if (portion > 0) return `${parcelNo}/${portion}`;
  return parcelNo;
};

// -----------------------------
// 🔤 Normalize meter type
// -----------------------------
export const normalizeMeterType = (meterType) => {
  return String(meterType || "").toLowerCase();
};

// -----------------------------
// 🔎 Build searchable text
// -----------------------------
export const buildErfSearchableText = ({ erfNo, type, lmPcode, wardPcode }) => {
  return [erfNo, type, lmPcode, wardPcode]
    .filter((value) => value && value !== "NAv")
    .join(" ")
    .toLowerCase();
};
