// One street address, written the way a person writes it.
//
// THIS IS A COPY OF THE MOBILE APP'S OWN FORMATTER — ireps-mobile
// src/features/premises/streetAddress.js. The two repos cannot import from each other, so the
// one well has to be a well in each. They must stay identical: an address written one way on
// the phone and another way on the server is the same fault as one field under five names.
//
// A premise keeps the street number, the street name and the street type apart. Joining all
// three blindly gives "26 OLDACRE ST Street", because the name people capture usually carries
// the type already (owner, 2026-09-24, on the map label). So the type is added only when the
// name does not already end in it, in full or in its usual short form.

const clean = (value) => String(value ?? "").trim().replace(/\s+/g, " ");

// The short forms a street name is written with. The type is the word iREPS keeps; the rest
// are what the name may end in.
const STREET_TYPE_FORMS = Object.freeze({
  street: ["street", "str", "st"],
  road: ["road", "rd"],
  avenue: ["avenue", "ave", "av"],
  drive: ["drive", "dr"],
  crescent: ["crescent", "cres"],
  close: ["close", "cl"],
  lane: ["lane", "ln"],
  place: ["place", "pl"],
  boulevard: ["boulevard", "blvd"],
  highway: ["highway", "hwy"],
  terrace: ["terrace", "terr"],
  way: ["way"],
  circle: ["circle", "cir"],
  court: ["court", "crt", "ct"],
});

/** Does the street name already end in this type, however it was written? */
export function streetNameCarriesType(strName, strType) {
  const name = clean(strName).toLowerCase().replace(/[.,]+$/, "");
  const type = clean(strType).toLowerCase();
  if (!name || !type) return false;

  const forms = STREET_TYPE_FORMS[type] || [type];
  return forms.some(
    (form) => name === form || name.endsWith(` ${form}`) || name.endsWith(` ${form}.`),
  );
}

export function formatStreetAddress(address = {}, { withNumber = true } = {}) {
  // Already words: a transaction stores the address as words (478 of 493 on DEV), so a value
  // that has been through here once comes back unchanged.
  if (typeof address === "string") return clean(address);

  const strNo = clean(address?.strNo);
  const strName = clean(address?.strName);
  const strType = clean(address?.strType);

  const type =
    !strType || strType === "Select..." || streetNameCarriesType(strName, strType)
      ? ""
      : strType;

  return [withNumber ? strNo : "", strName, type].filter(Boolean).join(" ").trim();
}

/**
 * The property type as words. A premise keeps it as { type, name, unitNo } — handing that
 * object to a screen crashes it with "Objects are not valid as a React child", which is
 * exactly what happened to the Submission Queue on 3 October.
 */
export function formatPropertyType(propertyType = {}) {
  if (typeof propertyType === "string") return clean(propertyType);

  return [propertyType?.type, propertyType?.name, propertyType?.unitNo]
    .map((value) => clean(value))
    .filter(Boolean)
    .join(" ");
}
