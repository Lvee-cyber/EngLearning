#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "data", "dictionary.json");
const outputDir = path.join(root, "data", "dictionary-prefix");

function pickTerm(entry) {
  return String(entry?.term || entry?.word || entry?.headword || entry?.title || entry?.name || "").trim();
}

function prefixFor(term) {
  const match = String(term || "").trim().toLowerCase().match(/[a-z]/);
  return match ? match[0] : "_";
}

const raw = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const entries = Array.isArray(raw)
  ? raw
  : Object.entries(raw).map(([term, entry]) => ({
      ...entry,
      term: pickTerm(entry) || term,
    }));

const groups = new Map();
for (const entry of entries) {
  const term = pickTerm(entry);
  if (!term) continue;
  const prefix = prefixFor(term);
  if (!groups.has(prefix)) groups.set(prefix, []);
  groups.get(prefix).push({ ...entry, term });
}

fs.mkdirSync(outputDir, { recursive: true });

for (const [prefix, items] of groups) {
  items.sort((a, b) => pickTerm(a).localeCompare(pickTerm(b)));
  fs.writeFileSync(path.join(outputDir, `${prefix}.json`), `${JSON.stringify(items, null, 2)}\n`);
}

console.log(`Wrote ${groups.size} dictionary prefix files to ${path.relative(root, outputDir)}.`);
