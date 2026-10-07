import test from "node:test";
import assert from "node:assert/strict";
import { getFieldComments, fieldCommentMediaUrls } from "../src/utils/fieldComments.js";

test("all comment formats come from this transaction, excluding unrelated evidence", () => {
  const source = { fieldComment: { text: "Line 1\n  Line 2  " }, media: [
    { tag: "meterPhoto", url: "https://example.test/meter.jpg" },
    { tag: "fieldCommentPhoto", url: "https://example.test/one.jpg?token=abc" },
    { tag: "fieldCommentPhoto", url: "https://example.test/two.jpg" },
    { tag: "fieldCommentVoice", url: "https://example.test/voice.m4a" },
    { tag: "fieldCommentVideo", url: "https://example.test/video.mp4" },
    { tag: "noAccessPhoto", url: "https://example.test/visit.jpg" },
  ] };
  const before = structuredClone(source);
  const result = getFieldComments(source);
  assert.equal(result.text, source.fieldComment.text);
  assert.equal(result.photos.length, 2);
  assert.equal(result.voiceClips.length, 1);
  assert.equal(result.videos.length, 1);
  assert.equal(fieldCommentMediaUrls(result.photos), "https://example.test/one.jpg?token=abc\nhttps://example.test/two.jpg");
  assert.deepEqual(source, before);
});
test("missing content displays NAv; saved invalid media remains visibly unavailable", () => {
  for (const source of [undefined, null, {}, { fieldComment: { text: "  \n" } }, { fieldComment: null, media: {} }]) {
    assert.deepEqual(getFieldComments(source), { text: "NAv", photos: [], voiceClips: [], videos: [] });
  }
  const result = getFieldComments({ media: [null, {}, { tag: "__proto__" }, { tag: "constructor" }, { tag: "fieldCommentPhoto", url: "javascript:alert(1)" }, { tag: "fieldCommentVoice" }] });
  assert.equal(result.photos.length, 1);
  assert.equal(result.photos[0].url, null);
  assert.equal(result.voiceClips[0].url, null);
  assert.equal(fieldCommentMediaUrls(result.photos), "NAv");
  assert.equal(fieldCommentMediaUrls([]), "NAv");
});
