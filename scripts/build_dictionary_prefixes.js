#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "data", "dictionary.json");
const wordsPath = path.join(root, "data", "words.json");
const outputDir = path.join(root, "data", "dictionary-prefix");
const configPath = path.join(root, "site-config.js");

function pickTerm(entry) {
  return String(entry?.term || entry?.word || entry?.headword || entry?.title || entry?.name || "").trim();
}

function prefixFor(term) {
  const match = String(term || "").trim().toLowerCase().match(/[a-z]/);
  return match ? match[0] : "_";
}

const raw = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const words = JSON.parse(fs.readFileSync(wordsPath, "utf8"));
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

function latestAdded(items) {
  return items
    .map((entry) => ({ term: pickTerm(entry), addedAt: String(entry?.added_at || "") }))
    .filter((entry) => entry.addedAt)
    .sort((a, b) => a.addedAt.localeCompare(b.addedAt))
    .at(-1) || { term: "", addedAt: "" };
}

function updateConfigStats() {
  const wordsLatest = latestAdded(words);
  const dictionaryLatest = latestAdded(entries);
  const stats = {
    wordsCount: words.length,
    dictionaryCount: entries.length,
    wordsUpdatedAt: wordsLatest.addedAt,
    dictionaryUpdatedAt: dictionaryLatest.addedAt,
    wordsLatestTerm: wordsLatest.term,
    dictionaryLatestTerm: dictionaryLatest.term,
  };
  const rows = Object.entries(stats).map(([key, value]) => `    ${key}: ${typeof value === "number" ? value : JSON.stringify(value)},`);
  const statsSource = `contentStats: {\n${rows.join("\n")}\n  },`;
  const config = fs.readFileSync(configPath, "utf8");
  const statsPattern = /contentStats:\s*\{[\s\S]*?\n  \},/;
  if (!statsPattern.test(config)) {
    throw new Error("Could not update contentStats in site-config.js");
  }
  const nextConfig = config.replace(statsPattern, statsSource);
  fs.writeFileSync(configPath, nextConfig);
}

updateConfigStats();
console.log(`Wrote ${groups.size} dictionary prefix files to ${path.relative(root, outputDir)}.`);
