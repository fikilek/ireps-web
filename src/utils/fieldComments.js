const MEDIA_KINDS = Object.freeze({
  fieldCommentPhoto: "photos",
  fieldCommentVoice: "voiceClips",
  fieldCommentVideo: "videos",
});

function storedMediaUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

// A field comment is transaction-specific. Other evidence is deliberately not
// included, even if it has the same media type or filename.
export function getFieldComments(trn = {}) {
  const text = trn?.fieldComment?.text;
  const result = {
    text: typeof text === "string" && text.trim() ? text : "NAv",
    photos: [],
    voiceClips: [],
    videos: [],
  };
  const media = Array.isArray(trn?.media) ? trn.media : [];
  media.forEach((item, index) => {
    if (!Object.hasOwn(MEDIA_KINDS, item?.tag)) return;
    const kind = MEDIA_KINDS[item?.tag];
    result[kind].push({ key: `${item.tag}-${index}`, url: storedMediaUrl(item.url) });
  });
  return result;
}

export function fieldCommentMediaUrls(items) {
  return Array.isArray(items) && items.length
    ? items.map(item => item.url || "NAv").join("\n")
    : "NAv";
}
