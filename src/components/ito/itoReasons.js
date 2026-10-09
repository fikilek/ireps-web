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
// ONLY DISCONNECTION IS SETTLED. The owner deferred the option lists for every
// other transaction until its own process is designed, so there is nothing
// here for them. An empty list is the honest answer; an invented one is not.

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
