#!/usr/bin/env node

/**
 * UI-R004 — on a form, every word a worker reads is black.
 *
 * The web app gets this from three rules in src/index.css: every box, every
 * hint inside an empty box, and every field name. This check fails the build
 * when a screen overrides one of them with a grey of its own.
 *
 * The same rule and the same colours as the phone app
 * (ireps-mobile/src/theme/formColors.js).
 */

import fs from "node:fs";
import { execSync } from "node:child_process";

const GREY =
  /^(#(64748b|94a3b8|9ca3af|6b7280|475569|334155|1e293b|111827|1f2937|4b5563|71717a|0f172a|8e8e93|757575|888888|999999|666666|333333|888|999|666|333)|grey|gray|darkgrey|darkgray|lightgrey|lightgray|dimgrey|dimgray|silver)$/i;

function fail(message) {
  console.error(`\n[iREPS CI] ${message}`);
  process.exit(1);
}

const files = execSync("git ls-files src", { encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(jsx?|tsx?)$/.test(f));

const offenders = [];
let checked = 0;

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  if (!/<(input|textarea|select|label)\b/.test(source)) continue;
  checked += 1;

  const lines = source.split(/\r?\n/);
  // Walk each <input>, <textarea>, <select> or <label> tag and look for a
  // colour written into it, however many lines the tag runs over.
  let open = -1;
  let buffer = "";
  lines.forEach((line, index) => {
    if (/<(input|textarea|select|label)\b/.test(line)) {
      open = index;
      buffer = "";
    }
    if (open < 0) return;
    buffer += line;
    if (!buffer.includes(">")) return;
    const colour = buffer.match(/color:\s*["']([^"']+)["']/);
    if (colour && GREY.test(colour[1])) {
      offenders.push(`${file}:${open + 1}  ${colour[1]}`);
    }
    open = -1;
  });
}

// The three rules themselves must stay black.
const css = fs.readFileSync("src/index.css", "utf8");
for (const selector of ["input,", "label {", "input::placeholder,"]) {
  if (!css.includes(selector)) {
    offenders.push(`src/index.css  the "${selector}" rule is missing`);
  }
}

if (offenders.length) {
  fail(
    `UI-R004: ${offenders.length} grey word(s) on a form. The colour comes from the rules in src/index.css:\n  ` +
      offenders.join("\n  "),
  );
}

console.log(
  `[iREPS CI] UI-R004: every box, hint and field name is black (${checked} screens checked).`,
);
