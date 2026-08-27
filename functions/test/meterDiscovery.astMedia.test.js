import test from "node:test";
import assert from "node:assert/strict";

import { projectMeterDiscoveryAstMedia } from "../meterDiscovery/astMedia.js";

test("Meter Discovery AST projection removes only General Comment media", () => {
  const media = [
    { tag: "fieldCommentPhoto", url: "https://example.test/comment.jpg" },
    { tag: "fieldCommentVoice", url: "https://example.test/comment.m4a" },
    { tag: "fieldCommentVideo", url: "https://example.test/comment.mp4" },
    { tag: "remainingCreditPhoto", url: "https://example.test/credit.jpg" },
    { tag: "astNoPhoto", url: "https://example.test/meter.jpg" },
    { tag: "anomalyPhoto", url: "https://example.test/anomaly.jpg" },
  ];

  assert.deepEqual(projectMeterDiscoveryAstMedia(media), [
    media[3],
    media[4],
    media[5],
  ]);
});

test("Meter Discovery AST projection is safe for missing media", () => {
  assert.deepEqual(projectMeterDiscoveryAstMedia(), []);
  assert.deepEqual(projectMeterDiscoveryAstMedia(null), []);
});
