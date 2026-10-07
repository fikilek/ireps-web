// NA-R065 — the captures the APP built wrong, as opposed to the ones a worker filled in wrong.
//
// The owner, 7 October 2026: "if somehow the system does the ID wrong, you can't submit that
// because the ID doesn't meet the rules. But then in situations like that, we need to have a way
// to know, because then it means the problem is not from the user, it's from the system."
//
// None of these can be put right by the worker, and none can come right on a later try - the
// payload is built wrong on every attempt. So the phone stops retrying them and tells the worker
// it is not their fault, and the server records them where the office can see them.
//
// THE PHONE HOLDS THE SAME LIST, in ireps-mobile src/features/meters/noAccessSubmitMessages.js
// (SYSTEM_FAULT_CODES). The two repos cannot import from each other, so the one well is a well in
// each, and they must stay in step: a code the server treats as a system fault but the phone does
// not will be retried for ever, and one the phone treats as a system fault but the server does not
// will reach the worker with words that tell them it is nobody's fault to fix.
export const SYSTEM_FAULT_CODES = Object.freeze([
  "INVALID_TRN_ID",
  "INVALID_ACCESS_DATA",
  "INVALID_LIFECYCLE_TRN_TYPE",
  "INVALID_AST_ID",
  "INVALID_PREMISE_ID",
  "LCT_TYPE_NOT_IMPLEMENTED",
]);

/** Did the app build this capture wrong, rather than the worker filling it in wrong? */
export function isSystemFault(code) {
  return SYSTEM_FAULT_CODES.includes(String(code || "").trim().toUpperCase());
}
