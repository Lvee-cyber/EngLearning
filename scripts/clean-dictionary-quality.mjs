import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

const FILE_PATH = "data/dictionary.json";
const checkOnly = process.argv.includes("--check");

function cleanLeadingArtifacts(value) {
  return String(value || "")
    .replace(/^\)+\(?[；;]?\s*/, "")
    .trim();
}

const entries = JSON.parse(await readFile(FILE_PATH, "utf8"));
if (!Array.isArray(entries)) throw new Error(`${FILE_PATH} must be a JSON array.`);

let changed = 0;
const cleaned = entries.map((entry) => {
  if (!entry || typeof entry !== "object") return entry;
  const translation = cleanLeadingArtifacts(entry.translation);
  const acceptedAnswers = Array.isArray(entry.accepted_answers)
    ? [...new Set(entry.accepted_answers.map(cleanLeadingArtifacts).filter(Boolean))]
    : entry.accepted_answers;
  const didChange = translation !== String(entry.translation || "") || JSON.stringify(acceptedAnswers) !== JSON.stringify(entry.accepted_answers);
  if (!didChange) return entry;
  changed += 1;
  return { ...entry, translation, accepted_answers: acceptedAnswers };
});

if (checkOnly) {
  if (changed) throw new Error(`Found ${changed} dictionary entries with removable leading parsing artifacts.`);
  console.log("Dictionary translations do not contain known leading parsing artifacts.");
} else {
  await writeFile(FILE_PATH, `${JSON.stringify(cleaned, null, 2)}\n`, "utf8");
  console.log(`Cleaned ${changed} dictionary entries.`);
}
