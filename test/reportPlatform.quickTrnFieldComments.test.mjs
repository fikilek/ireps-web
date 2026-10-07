import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, PDFHexString, decodePDFRawStream } from "pdf-lib";
import { buildQuickTrnPdfArtifact } from "../src/utils/reportPlatform/buildQuickTrnPdfArtifact.js";

const imageBytes = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1sAAAAASUVORK5CYII=",
  "base64",
));
const premise = {
  address: { strNo: "14", strName: "Mckenzie", strType: "Street", suburbName: "Dundee" },
  property: { type: "Residential" },
  occupancyStatus: "Accessed",
};
const comment = "The meter is found to have been bypassing electricity illegally.  Inspection shows the meter reflected zero credit, while electrical appliances within the premises were operational and receiving electricity supply";
const photo = (tag, extra = {}) => ({ tag, url: "https://example.test/evidence.png", ...extra });
const loadMediaBytes = async () => ({ bytes: imageBytes, contentType: "image/png" });

// Inspect the saved PDF, including the positions of rendered text and images.
// This exercises the real generator and embedding, without replacing PDF drawing.
async function inspect(raw, options = {}) {
  const bundle = await buildQuickTrnPdfArtifact(raw, { premise, loadMediaBytes, ...options });
  const doc = await PDFDocument.load(bundle.artifact.bytes);
  const pages = doc.getPages().map((page) => {
    const contents = page.node.Contents();
    const stream = contents.asArray().map((ref) => new TextDecoder().decode(
      decodePDFRawStream(doc.context.lookup(ref)).decode(),
    )).join("\n");
    const blocks = [...stream.matchAll(/BT\n([\s\S]*?)ET/g)].map((match) => {
      const body = match[1];
      const tm = body.match(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/);
      return {
        text: [...body.matchAll(/<([\da-f]+)> Tj/gi)].map((m) => PDFHexString.of(m[1]).decodeText()).join(""),
        x: Number(tm?.[1]), y: Number(tm?.[2]),
      };
    });
    return { blocks, text: blocks.map((b) => b.text).join("\n"), images: (stream.match(/\/Image[^\s]+ Do/g) || []).length };
  });
  return { bundle, pages, text: pages.map((p) => p.text).join("\n") };
}

test("prints the complete saved text after Premise Details and before existing evidence", async () => {
  const raw = {
    id: "TRN_MDIS_TEST", fieldComment: { text: comment },
    media: [photo("anomalyPhoto")],
  };
  const before = structuredClone(raw);
  const result = await inspect({ raw }, {
    premise: { ...premise, media: [photo("premisePhoto")] },
    loadPremiseMediaBytes: loadMediaBytes,
  });
  const compact = result.text.replace(/\s+/g, " ");
  assert.ok(compact.includes(comment.replace(/\s+/g, " ")));
  assert.ok(result.text.indexOf("Premise Details") < result.text.indexOf("Field Comments"));
  assert.ok(result.text.indexOf("Field Comments") < result.text.indexOf("Premise Photo"));
  assert.ok(result.text.indexOf("Premise Photo") < result.text.indexOf("Anomaly Photo"));
  assert.equal(result.bundle.metadata.sourceId, raw.id);
  assert.equal(result.bundle.artifact.fileName, "Quick-TRN-TRN_MDIS_TEST.pdf");
  assert.deepEqual(raw, before, "report generation never changes source data");
});

test("embeds tagged photos once, retaining original authenticated media indices", async () => {
  const calls = [];
  const result = await inspect({
    id: "TRN_PHOTOS", fieldComment: { text: "Comment with photos" },
    media: [photo("astNoPhoto"), photo("fieldCommentVoice"), photo("fieldCommentPhoto"),
      photo("fieldCommentVideo"), photo("fieldCommentPhoto", { mediaIndex: 9 })],
  }, {
    loadMediaBytes: async (args) => { calls.push(args); return loadMediaBytes(); },
  });
  assert.deepEqual(calls, [0, 2, 9].map((mediaIndex) => ({ trnId: "TRN_PHOTOS", mediaIndex })));
  assert.equal((result.text.match(/Field Comment Photo 1/g) || []).length, 1);
  assert.equal((result.text.match(/Field Comment Photo 2/g) || []).length, 1);
  assert.equal(result.pages.reduce((sum, p) => sum + p.images, 0), 3);
  assert.ok(result.text.indexOf("Field Comment Photo 2") < result.text.indexOf("AST No Photo"));
  assert.doesNotMatch(result.text, /Field Comment (Voice|Video)/);
});

test("supports photo-only comments and omits empty text labels", async () => {
  const result = await inspect({
    fieldComment: { text: "NAv" }, media: [photo("fieldCommentPhoto")],
  });
  assert.match(result.text, /Field Comments\nField Comment Photo 1/);
  assert.doesNotMatch(result.text, /Field Comment Text/);
  assert.equal(result.pages.reduce((sum, p) => sum + p.images, 0), 1);
});

test("omits empty comments and never relabels unrelated transaction or premise photos", async () => {
  for (const value of [undefined, null, "", "  ", "NAv", "N/A", "-"]) {
    const result = await inspect({
      fieldComment: { text: value }, media: [photo("sealPhoto")],
    }, { premise: { ...premise, fieldComment: { text: "Not this visit" } } });
    assert.doesNotMatch(result.text, /Field Comment|Not this visit/);
    assert.match(result.text, /Seal Photo/);
  }
});

test("long multiline comments continue across pages without losing their end or entering the footer", async () => {
  const lines = Array.from({ length: 180 }, (_, i) => `Inspection line ${i + 1}: The saved observation must remain readable in full.`);
  const result = await inspect({ fieldComment: { text: lines.join("\n") } });
  assert.ok(result.pages.length >= 4);
  assert.match(result.text, /Field Comments \(continued\)/);
  for (const line of lines) assert.ok(result.text.includes(line), line);
  for (const page of result.pages) {
    for (const block of page.blocks.filter((b) => b.text.startsWith("Inspection line"))) {
      assert.ok(block.y >= 54 && block.y < 722, JSON.stringify(block));
      assert.ok(block.x >= 42);
    }
  }
});

test("an unbroken long comment wraps without loss", async () => {
  const value = "Z".repeat(3000);
  const result = await inspect({ fieldComment: { text: value } });
  const printed = result.pages.flatMap((p) => p.blocks).filter((b) => /^Z+$/.test(b.text));
  assert.equal(printed.map((b) => b.text).join(""), value);
  assert.ok(printed.length > 1);
});

test("a failed photo retains the comment and clearly identifies the unavailable photo", async () => {
  const result = await inspect({
    fieldComment: { text: "Saved comment is still available" },
    media: [photo("fieldCommentPhoto"), photo("fieldCommentPhoto")],
  }, {
    loadMediaBytes: async ({ mediaIndex }) => {
      if (mediaIndex === 0) throw new Error("Network failure");
      return loadMediaBytes();
    },
  });
  assert.match(result.text, /Saved comment is still available/);
  assert.match(result.text, /Field Comment Photo 1\nField Comment photo could not be loaded/);
  assert.match(result.text, /Field Comment Photo 2/);
  assert.equal(result.pages.reduce((sum, p) => sum + p.images, 0), 1);
});

test("comments still print when there is no premise context", async () => {
  const result = await inspect({ fieldComment: { text: "Standalone transaction comment" } }, { premise: null });
  assert.match(result.text, /Field Comments\nField Comment Text\nStandalone transaction comment/);
});
