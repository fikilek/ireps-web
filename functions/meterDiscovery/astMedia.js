const FIELD_COMMENT_MEDIA_TAGS = new Set([
  "fieldCommentPhoto",
  "fieldCommentVoice",
  "fieldCommentVideo",
]);

export function projectMeterDiscoveryAstMedia(media = []) {
  if (!Array.isArray(media)) return [];

  return media.filter((item) => !FIELD_COMMENT_MEDIA_TAGS.has(item?.tag));
}
