// The name of a service provider, resolved one way for the whole of iREPS.
//
// THE RULE (owner, 4 October 2026): "we should use registeredName. Use a fallback to
// tradingName. Lastly, fall back to NAv."
//
// `NAv` in a stored name means nothing was captured there, so it is skipped the same as blank -
// otherwise SP LgIrdHR7cnUPIHPzw5iZ, whose registeredName is the text "NAv" and whose
// tradingName is "RSTE", would be stamped NAv on every transaction it touches.
//
// WHY IT IS HERE AND NOT IN THREE PLACES. It was in three, and they disagreed: meterLifecycle's
// sanitizeServiceProvider and targetedBatches' getServiceProviderName both took tradingName
// first, and the No Access path read a top-level `name` that does not exist on a service
// provider document at all - which is how 20 of the last 25 DEV transactions came to be stamped
// "NAv" by a writer that had just resolved the right SP.
//
// PURE - no Firestore, no SDK. It is handed a service provider document and returns words.

/** NAv means "nothing was captured here", so for choosing a name it is the same as blank. */
function presentText(value) {
  const text = String(value ?? "").trim();
  return !text || text === "NAv" ? "" : text;
}

/**
 * Registered name, then trading name, then a name already resolved, then NAv.
 *
 * TWO SHAPES REACH THIS FUNCTION and they are not the same thing.
 *
 * A service provider DOCUMENT carries `profile.registeredName` and
 * `profile.tradingName`, and the first two links read it. A STAMP - the
 * `{ id, name }` an iREPS record keeps of the provider it belongs to - carries
 * neither, because its `name` was resolved by this same chain when it was
 * written.
 *
 * Handed a stamp, the chain used to run out and return NAv. Found by the owner
 * on 10 October 2026 in the first office job: the meter's own stamp said
 * `RSTE` and the job it produced said `NAv`, because the meter's stamp was
 * passed in where a document was expected.
 *
 * Reusing an already-resolved name is safe precisely because it came from
 * here: the chain is idempotent, and `NAv` in it still means nothing was
 * captured, so it is skipped like blank. It is LAST, so a real document always
 * wins over a copy of one.
 */
export function serviceProviderName(serviceProvider = {}) {
  return (
    presentText(serviceProvider?.profile?.registeredName) ||
    presentText(serviceProvider?.profile?.tradingName) ||
    presentText(serviceProvider?.name) ||
    "NAv"
  );
}
