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

/** Registered name, then trading name, then NAv. */
export function serviceProviderName(serviceProvider = {}) {
  return (
    presentText(serviceProvider?.profile?.registeredName) ||
    presentText(serviceProvider?.profile?.tradingName) ||
    "NAv"
  );
}
