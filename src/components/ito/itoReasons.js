// Why the office is originating this transaction. `DR-R001` 3.4.
//
// ONE WELL. The office picks the reason here, the worker reads it on his card,
// and it is stored on the transaction. There is one list and this is it — a
// screen that writes its own options is how two lists for one thing start.
//
// THE CODE IS NOT THE WORDS, and that is the whole point of this file.
// `DR-R001` 3.4 (1.10.1, owner 9 October 2026): the reason is stored as a code
// as well as words, because "a wording that changes leaves old records
// uncountable; a code survives it" — and this wording is changing now, from
// Credit Control Instruction and Non Payment to Client instruction and
// Customer instruction. The codes below are the ones the phone already writes
// (`ireps-mobile` `src/features/meters/formOptions.js`,
// `disconnection_instructions`), so every record captured under the old words
// stays countable under the new ones. Never renumber a code to tidy it.
//
// ALL FIVE ARE NOW SETTLED (owner, 13 October 2026). Disconnection was first;
// the rest follow here.
//
// MOST OF THEM WERE NOT INVENTED - THEY WERE ALREADY ON THE PHONE. Inspection,
// Removal and Meter Reading have had real lists in `ireps-mobile`
// `src/features/meters/formOptions.js` all along, and those CODES are used
// here unchanged so every record already captured stays countable. The same
// reason the disconnection codes were kept: never renumber a code to tidy it.
//
// Reconnection is the exception. Its phone list held one entry, `RECONNECT_METER`
// - "Reconnect meter" - which restates the transaction rather than saying why
// it was sent. The owner settled the real three on 13 October: payment
// received, client instruction, other.
//
// `CLIENT_INSTRUCTION` ON RECONNECTION IS A NEW CODE, not disconnection's
// `CREDIT_CONTROL_INSTRUCTION`. The words are the same because the owner
// settled one word for one thing - "lets stick to 'client instruction' for
// both DCN and RCN" - but the codes stay apart, because a reason belongs to
// its transaction and the office wants to count a client's disconnection
// instruction separately from a client's reconnection instruction. Reusing the
// disconnection code would merge two different facts under one number, which
// no rewording could later undo.

const reason = (code, words, needsExplanation = false) =>
  Object.freeze({ code, words, needsExplanation });

/**
 * The reasons, by the transaction they belong to.
 *
 * `needsExplanation` carries `UI-R006` 1.2.0, the owner's global rule: **no
 * iREPS form may ever be submitted with an empty Other.** Choosing Other
 * without saying what it is leaves a record that says a reason was given and
 * does not say what it was, which is worse than no reason at all.
 */
export const ITO_REASONS_BY_WORK = Object.freeze({
  disconnect: Object.freeze([
    reason("ILLEGAL_CONNECTION", "Illegal connection"),
    reason("CREDIT_CONTROL_INSTRUCTION", "Client instruction"),
    reason("NON_PAYMENT", "Customer instruction"),
    reason("OTHER", "Other", true),
  ]),

  // Owner, 13 October 2026: "payment received, lm instruction , Other", then
  // "lets stick to 'client instruction' for both DCN and RCN" - so the LM's
  // instruction carries the same words as the client's on a disconnection,
  // because the LM IS the client and one thing has one word.
  reconnect: Object.freeze([
    reason("PAYMENT_RECEIVED", "Payment received"),
    reason("CLIENT_INSTRUCTION", "Client instruction"),
    reason("OTHER", "Other", true),
  ]),

  // The phone's own list, codes unchanged.
  inspect: Object.freeze([
    reason("CHECK_ILLEGAL_CONNECTION", "Check illegal connection"),
    reason("GENERAL_INSPECTION", "General inspection"),
    reason("OTHER", "Other", true),
  ]),

  // `REPLACE_METER_STEP_1` keeps its name: it is step one of a replacement,
  // and the installation opens after it. Renaming it would lose that.
  remove: Object.freeze([
    reason("REMOVE_METER", "Remove meter"),
    reason("REPLACE_METER_STEP_1", "Replace meter"),
    reason("OTHER", "Other", true),
  ]),

  read: Object.freeze([
    reason("MONTHLY_METER_READING", "Monthly meter reading"),
    reason("ROUTINE_METER_READING", "Routine meter reading"),
    reason("VERIFY_METER_READING", "Verify meter reading"),
    reason("FINAL_METER_READING", "Final meter reading"),
    reason("INVESTIGATION_METER_READING", "Investigation meter reading"),
    reason("BULK_METER_READING", "Bulk meter reading"),
    reason("OTHER", "Other", true),
  ]),
});

/** The reasons offered for one transaction, or none where none are settled. */
export function itoReasonsFor(work) {
  return ITO_REASONS_BY_WORK[String(work || "").toLowerCase()] || [];
}

/** One reason by its code, or null. The code is what is stored, so it leads. */
export function itoReasonByCode(work, code) {
  const wanted = String(code || "").trim().toUpperCase();

  return itoReasonsFor(work).find((item) => item.code === wanted) || null;
}

/**
 * What stops this reason being sent, in the office's own words — or `null`
 * when nothing does.
 *
 * It answers in plain words rather than true/false because the words are what
 * the office is shown, and a rule that cannot say why it refused is a rule
 * nobody can act on.
 */
export function itoReasonProblem({ work, code, explanation } = {}) {
  const chosen = itoReasonByCode(work, code);

  if (!chosen) return "Choose why this work is being sent.";

  if (!chosen.needsExplanation) return null;

  // UI-R006: missing, null, empty and whitespace all fail, and so does a
  // placeholder somebody left sitting in the box.
  const said = String(explanation ?? "").trim();

  if (!said) return "Say what the other reason is.";

  return null;
}
