// Targeted Batch rules 1.3.86 and 1.3.88: a batch the server recognised is not a capture made from a
// batch row.
//
// Since 1.3.86 the server stamps every capture on a batched ERF with the batch it recognised, so the row
// learns its meter was found. That stamp is marked `recognisedBy: "IREPS"`, and 1.3.86 says in terms that
// nothing may read it as the worker having taken the Sales Path.
//
// Two readers did exactly that: TB-R056 stood down on the very finds it exists to close (the meter went
// VISIBLE and its row stayed Not Started), and the team's field work summary counted such a find as batch
// work. So the question lives here, once, in a module with no imports of its own — the two places that ask
// it sit on opposite sides of the import graph.
export const RECOGNISED_BATCH_CONTEXT_BY = "IREPS";
export const RECOGNISED_BATCH_CONTEXT_RULE = "GMR-R038";

/** Was this batch context stamped by the server, rather than sent by a worker on the Sales Path? */
export function isServerRecognisedBatchContext(context = {}) {
  return (
    String(context?.recognisedBy || "").trim().toUpperCase() ===
      RECOGNISED_BATCH_CONTEXT_BY &&
    String(context?.rule || "").trim().toUpperCase() ===
      RECOGNISED_BATCH_CONTEXT_RULE
  );
}
