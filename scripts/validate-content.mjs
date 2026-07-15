import { readFile } from "node:fs/promises";

async function readArray(filePath) {
  const parsed = JSON.parse(await readFile(filePath, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${filePath} must be a JSON array.`);
  return parsed;
}

function validateEntries(entries, label) {
  const errors = [];
  const seen = new Set();
  entries.forEach((entry, index) => {
    const term = String(entry?.term || "").trim();
    const normalized = term.toLowerCase();
    if (!term) errors.push(`${label}[${index}] is missing term`);
    if (normalized && seen.has(normalized)) errors.push(`${label} has duplicate term: ${term}`);
    seen.add(normalized);
    if (Object.hasOwn(entry || {}, "review")) errors.push(`${label}:${term || index} embeds private review state`);
    if (!String(entry?.translation || "").trim()) errors.push(`${label}:${term || index} is missing translation`);
    if (!Array.isArray(entry?.expansions) || !entry.expansions.length) errors.push(`${label}:${term || index} is missing expansions`);
  });
  return errors;
}

const words = await readArray("data/words.json");
const dictionary = await readArray("data/dictionary.json");
const errors = [...validateEntries(words, "words"), ...validateEntries(dictionary, "dictionary")];

if (errors.length) {
  throw new Error(`Content validation failed:\n${errors.slice(0, 30).join("\n")}${errors.length > 30 ? `\n...and ${errors.length - 30} more` : ""}`);
}

const warnings = {
  dictionary_missing_pos: dictionary.filter((entry) => !String(entry?.pos || "").trim()).length,
  dictionary_pending_origin: dictionary.filter((entry) => entry?.origin === "待查").length,
  dictionary_leading_close_paren: dictionary.filter((entry) => /^\)/.test(String(entry?.translation || ""))).length,
};

console.log(`Validated ${words.length} study words and ${dictionary.length} dictionary entries.`);
console.log(`Quality backlog: ${JSON.stringify(warnings)}`);
