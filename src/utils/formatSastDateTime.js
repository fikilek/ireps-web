const formatter = new Intl.DateTimeFormat("en-ZA", {
  timeZone: "Africa/Johannesburg",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

// Keep stored timestamps in UTC. Display the same South African clock for ISO
// strings and Firestore timestamps, regardless of the viewer's device timezone.
export function formatSastDateTime(value) {
  if (value == null || value === "" || value === "NAv") return "NAv";
  let date;
  if (typeof value?.toDate === "function") date = value.toDate();
  else if (typeof value?.toMillis === "function") date = new Date(value.toMillis());
  else if (typeof (value?.seconds ?? value?._seconds) === "number") {
    date = new Date((value.seconds ?? value._seconds) * 1000);
  } else if (value instanceof Date || typeof value === "string" || typeof value === "number") {
    date = new Date(value);
  }
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return "NAv";
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
