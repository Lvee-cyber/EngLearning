import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DATA_FILES = [
  { label: "words", path: path.join(ROOT, "data", "words.json") },
  { label: "dictionary", path: path.join(ROOT, "data", "dictionary.json") },
];
const PRIVATE_DIR = path.join(ROOT, "data", "private");
const checkOnly = process.argv.includes("--check");

async function readEntries(filePath) {
  const parsed = JSON.parse(await readFile(filePath, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${path.relative(ROOT, filePath)} must be a JSON array.`);
  return parsed;
}

function hasReviewData(review) {
  if (!review || typeof review !== "object") return false;
  return (
    Number(review.correct_count || 0) > 0 ||
    Number(review.incorrect_count || 0) > 0 ||
    (Array.isArray(review.review_history) && review.review_history.length > 0)
  );
}

const loaded = await Promise.all(
  DATA_FILES.map(async (item) => ({
    ...item,
    entries: await readEntries(item.path),
  })),
);

const embeddedCount = loaded.reduce(
  (total, item) => total + item.entries.filter((entry) => entry && Object.hasOwn(entry, "review")).length,
  0,
);

if (checkOnly) {
  if (embeddedCount) {
    throw new Error(`Found ${embeddedCount} content entries with embedded review state. Run: node scripts/separate-review-progress.mjs`);
  }
  console.log("Content files do not contain embedded review state.");
  process.exit(0);
}

const backup = {
  created_at: new Date().toISOString(),
  note: "Private backup created before review state was removed from public content files.",
  sources: {},
};

for (const item of loaded) {
  backup.sources[item.label] = item.entries
    .filter((entry) => hasReviewData(entry?.review))
    .map((entry) => ({ term: entry.term, review: entry.review }));
}

await mkdir(PRIVATE_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = path.join(PRIVATE_DIR, `embedded-review-backup-${stamp}.json`);
await writeFile(backupPath, `${JSON.stringify(backup, null, 2)}\n`, "utf8");

for (const item of loaded) {
  const sanitized = item.entries.map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const { review: _review, ...content } = entry;
    return content;
  });
  await writeFile(item.path, `${JSON.stringify(sanitized, null, 2)}\n`, "utf8");
}

console.log(`Removed embedded review state from ${embeddedCount} content entries.`);
console.log(`Private backup: ${path.relative(ROOT, backupPath)}`);
