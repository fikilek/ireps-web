// RG-R001 1.1.0 section 2: a registration carries two times, and neither is guessed from the other.
//
// Work done on a phone with no signal can reach the server days later. Until this rule the phone's own
// metadata was deleted and only the server's time was kept, under `createdAt` — so a capture that
// waited three days was dated the day it arrived, and every report that counts field work by date was
// counting arrival dates (owner, 2026-09-28).
//
// `createdOnDevice` is when the worker finished the form. `createdOnServer` is when the submission was
// accepted. Everything that counts field work by date counts the device time.

/**
 * RETIRED (TR-R002, 3 Oct 2026). It marked a record whose phone sent no device time, beside a
 * createdOnDevice that had been filled with the SERVER's time - so the flag was the only thing
 * saying the date was not real. The device time is now simply empty, which says it by itself.
 * The name is kept because 2 records on DEV still carry it.
 */
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

  // TR-R002 (0.6.0): TWELVE KEYS. Two matching sets of six - the server's, and the device's.
  return {
    // THE SERVER SET - the standard iREPS block, on every document in iREPS.
    createdAt: nowIso,
    createdByUid: actorUid,
    createdByUser: actorName,
    updatedAt: nowIso,
    updatedByUid: actorUid,
    updatedByUser: actorName,

    // THE DEVICE SET - the same six, for the phone. When and WHO, because the two actors can
    // genuinely differ: a field worker captures on the phone, an office supervisor corrects it
    // on the web. At capture they are the same person, and the identity is still taken from
    // the signed-in caller and never from the phone.
    //
    // NULL WHERE NOTHING WAS CAPTURED, never the server's time (owner, 3 Oct 2026: "leave them
    // empty for the true reflection of what they truly are"). This used to fall back to
    // `nowIso`, so a record from an older build CLAIMED a work date that nobody had recorded -
    // the arrival date wearing the work date's name, which is the exact fault RG-R001 was
    // written to stop. The empty value is the flag; it needs no second field beside it saying
    // the same thing, which is why deviceTimeMissing is gone.
    createdOnDevice: deviceCreated || null,
    createdOnDeviceByUid: deviceCreated ? actorUid : null,
    createdOnDeviceByUser: deviceCreated ? actorName : null,
    updatedOnDevice: deviceUpdated || null,
    updatedOnDeviceByUid: deviceUpdated ? actorUid : null,
    updatedOnDeviceByUser: deviceUpdated ? actorName : null,
  };
}
