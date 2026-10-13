export const qaDate = value => value ? new Date(value).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", hour12: false }) + " SAST" : "NAv";
