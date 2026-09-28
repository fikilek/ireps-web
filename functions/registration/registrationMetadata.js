// RG-R001 1.1.0 section 2: a registration carries two times, and neither is guessed from the other.
//
// Work done on a phone with no signal can reach the server days later. Until this rule the phone's own
// metadata was deleted and only the server's time was kept, under `createdAt` — so a capture that
// waited three days was dated the day it arrived, and every report that counts field work by date was
// counting arrival dates (owner, 2026-09-28).
//
// `createdOnDevice` is when the worker finished the form. `createdOnServer` is when the submission was
// accepted. Everything that counts field work by date counts the device time.

/** An older app sends no device time. We do not refuse the work for it; we say so instead. */
export const DEVICE_TIME_MISSING = "deviceTimeMissing";

const iso = (value) => {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
};

/**
 * Build the metadata a registration is stored with.
 *
 * @param phoneMetadata what the phone sent (its own times; never its own identity)
 * @param actorUid      the signed-in caller, from the server
 * @param actorName     the caller's name, from the server
 * @param nowIso        the server's own time for this submission
 */
export function buildRegistrationMetadata({
  phoneMetadata = {},
  actorUid,
  actorName,
  nowIso = new Date().toISOString(),
}) {
  // The phone's own time, whatever name the build it came from used for it.
  const deviceCreated =
    iso(phoneMetadata?.createdOnDevice) || iso(phoneMetadata?.createdAt);
  const deviceUpdated =
    iso(phoneMetadata?.updatedOnDevice) ||
    iso(phoneMetadata?.updatedAt) ||
    deviceCreated;

  return {
    // When the work was done. Field work is counted by this.
    createdOnDevice: deviceCreated || nowIso,
    updatedOnDevice: deviceUpdated || nowIso,
    // When the server accepted it.
    createdOnServer: nowIso,
    updatedOnServer: nowIso,
    // Kept under their old names while readers still use them (opt01 retires them).
    createdAt: nowIso,
    updatedAt: nowIso,
    // Who, always from the signed-in caller and never from the phone.
    createdByUid: actorUid,
    createdByUser: actorName,
    updatedByUid: actorUid,
    updatedByUser: actorName,
    // An old build sent no device time, so the office can see why the two times are the same.
    ...(deviceCreated ? {} : { [DEVICE_TIME_MISSING]: true }),
  };
}
