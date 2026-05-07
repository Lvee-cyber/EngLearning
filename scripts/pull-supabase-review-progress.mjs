import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const BASE_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const WORDS_PATH = path.join(BASE_DIR, "data", "words.json");
const DICTIONARY_PATH = path.join(BASE_DIR, "data", "dictionary.json");
const SITE_CONFIG_PATH = path.join(BASE_DIR, "site-config.js");
const PAGE_SIZE = 1000;

function parseArgs(argv) {
  const args = { profileId: "", syncDictionary: true };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--profile" || value === "-p") {
      args.profileId = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (value === "--words-only") {
      args.syncDictionary = false;
      continue;
    }
    if (!args.profileId && !value.startsWith("-")) {
      args.profileId = value;
    }
  }
  return args;
}

function extractConfigValue(source, key) {
  const pattern = new RegExp(`${key}\\s*:\\s*["']([^"']+)["']`);
  const match = source.match(pattern);
  return match ? match[1] : "";
}

async function loadSiteConfig() {
  const raw = await readFile(SITE_CONFIG_PATH, "utf8");
  return {
    supabaseUrl: extractConfigValue(raw, "supabaseUrl"),
    supabaseAnonKey: extractConfigValue(raw, "supabaseAnonKey"),
    reviewProgressTable: extractConfigValue(raw, "reviewProgressTable") || "review_progress",
  };
}

async function readJson(filePath, label) {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON array.`);
  }
  return parsed;
}

function buildHeaders(apiKey) {
  return {
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
  };
}

async function requestJson(baseUrl, apiKey, requestPath) {
  const response = await fetch(`${baseUrl}/rest/v1/${requestPath}`, {
    method: "GET",
    headers: buildHeaders(apiKey),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GET ${requestPath} failed: ${response.status} ${body}`);
  }
  return response.json();
}

async function fetchAllProgress({ baseUrl, apiKey, tableName, profileId }) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const requestPath = `${tableName}?profile_id=eq.${encodeURIComponent(profileId)}&select=term,correct_count,incorrect_count,review_history&limit=${PAGE_SIZE}&offset=${offset}`;
    const batch = await requestJson(baseUrl, apiKey, requestPath);
    rows.push(...batch);
    if (!Array.isArray(batch) || batch.length < PAGE_SIZE) break;
  }
  return rows;
}

function normalizeProgress(item) {
  return {
    correct_count: Number(item.correct_count || 0),
    incorrect_count: Number(item.incorrect_count || 0),
    review_history: Array.isArray(item.review_history) ? item.review_history : [],
  };
}

function mergeProgress(entries, progressByTerm) {
  let updated = 0;
  for (const entry of entries) {
    const term = String(entry?.term || "").trim().toLowerCase();
    if (!term || !progressByTerm.has(term)) continue;
    entry.review = normalizeProgress(progressByTerm.get(term));
    updated += 1;
  }
  return updated;
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const fileConfig = await loadSiteConfig();
  const profileId = cli.profileId || process.env.PROFILE_ID || fileConfig.defaultProfileId || "";
  const supabaseUrl = process.env.SUPABASE_URL || fileConfig.supabaseUrl;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || fileConfig.supabaseAnonKey;
  const tableName = process.env.REVIEW_PROGRESS_TABLE || fileConfig.reviewProgressTable;

  if (!profileId) {
    throw new Error("Missing profile id. Use --profile <id> or set PROFILE_ID.");
  }
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase connection info. Check site-config.js or env.");
  }

  const [words, dictionary, progressRows] = await Promise.all([
    readJson(WORDS_PATH, "words.json"),
    cli.syncDictionary ? readJson(DICTIONARY_PATH, "dictionary.json") : Promise.resolve([]),
    fetchAllProgress({ baseUrl: supabaseUrl, apiKey: supabaseAnonKey, tableName, profileId }),
  ]);

  const progressByTerm = new Map(
    progressRows
      .map((item) => [String(item.term || "").trim().toLowerCase(), normalizeProgress(item)])
      .filter(([term]) => term),
  );

  const wordsUpdated = mergeProgress(words, progressByTerm);
  const dictionaryUpdated = cli.syncDictionary ? mergeProgress(dictionary, progressByTerm) : 0;

  await writeFile(WORDS_PATH, `${JSON.stringify(words, null, 2)}\n`, "utf8");
  if (cli.syncDictionary) {
    await writeFile(DICTIONARY_PATH, `${JSON.stringify(dictionary, null, 2)}\n`, "utf8");
  }

  const summary = {
    profile_id: profileId,
    fetched_progress_rows: progressRows.length,
    words_updated: wordsUpdated,
    dictionary_updated: dictionaryUpdated,
    dictionary_sync: cli.syncDictionary,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
