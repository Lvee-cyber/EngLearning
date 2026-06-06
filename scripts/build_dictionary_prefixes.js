#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "data", "dictionary.json");
const wordsPath = path.join(root, "data", "words.json");
const outputDir = path.join(root, "data", "dictionary-prefix");
const suggestDir = path.join(root, "data", "dictionary-suggest");
const detailDir = path.join(root, "data", "dictionary-detail");
const configPath = path.join(root, "site-config.js");

function pickTerm(entry) {
  return String(entry?.term || entry?.word || entry?.headword || entry?.title || entry?.name || "").trim();
}

function prefixFor(term) {
  const match = String(term || "").trim().toLowerCase().match(/[a-z]/);
  return match ? match[0] : "_";
}

function detailPrefixFor(term) {
  const normalized = String(term || "").trim().toLowerCase().replace(/^[^a-z]+/, "");
  return normalized.match(/^[a-z]{1,2}/)?.[0] || prefixFor(term);
}

function briefText(value, maxLength = 80) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function isSuggestionTerm(term) {
  const normalized = String(term || "").trim();
  if (!normalized) return false;
  if (/^[A-Z]-/.test(normalized)) return false;
  return /^[A-Za-z][A-Za-z' -]*$/.test(normalized);
}

function toSuggestionItem(entry) {
  const senses = Array.isArray(entry.senses)
    ? entry.senses
        .map((sense) => briefText(sense?.translation || sense?.meaning || sense?.definition, 48))
        .filter(Boolean)
        .slice(0, 2)
    : [];
  const item = {
    term: pickTerm(entry),
    translation: senses.length ? senses.join("；") : briefText(entry.translation || entry.meaning || entry.definition, 80),
    pos: entry.pos || entry.part_of_speech,
    phonetic: entry.phonetic,
    pronunciation: entry.pronunciation,
  };
  return Object.fromEntries(Object.entries(item).filter(([, value]) => value != null && value !== ""));
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
const detailGroups = new Map();
const suggestGroups = new Map();
for (const entry of entries) {
  const term = pickTerm(entry);
  if (!term) continue;
  const prefix = prefixFor(term);
  if (!groups.has(prefix)) groups.set(prefix, []);
  groups.get(prefix).push({ ...entry, term });

  const detailPrefix = detailPrefixFor(term);
  if (!detailGroups.has(detailPrefix)) detailGroups.set(detailPrefix, []);
  detailGroups.get(detailPrefix).push({ ...entry, term });

  if (!suggestGroups.has(detailPrefix)) suggestGroups.set(detailPrefix, []);
  suggestGroups.get(detailPrefix).push({ ...entry, term });
}

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(suggestDir, { recursive: true });
fs.mkdirSync(detailDir, { recursive: true });

for (const [prefix, items] of groups) {
  items.sort((a, b) => pickTerm(a).localeCompare(pickTerm(b)));
  fs.writeFileSync(path.join(outputDir, `${prefix}.json`), `${JSON.stringify(items, null, 2)}\n`);
  fs.writeFileSync(path.join(suggestDir, `${prefix}.json`), JSON.stringify(items.filter((item) => isSuggestionTerm(pickTerm(item))).slice(0, 80).map(toSuggestionItem)));
}

for (const [prefix, items] of detailGroups) {
  items.sort((a, b) => pickTerm(a).localeCompare(pickTerm(b)));
  fs.writeFileSync(path.join(detailDir, `${prefix}.json`), JSON.stringify(items));
}

for (const [prefix, items] of suggestGroups) {
  if (prefix.length < 2) continue;
  items.sort((a, b) => pickTerm(a).localeCompare(pickTerm(b)));
  fs.writeFileSync(path.join(suggestDir, `${prefix}.json`), JSON.stringify(items.filter((item) => isSuggestionTerm(pickTerm(item))).map(toSuggestionItem)));
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
