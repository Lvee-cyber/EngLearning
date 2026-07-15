import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const BASE_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SITE_CONFIG_PATH = path.join(BASE_DIR, "site-config.js");
const PRIVATE_DIR = path.join(BASE_DIR, "data", "private");

function parseArgs(argv) {
  const args = { profileId: "", outputPath: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--profile" || value === "-p") {
      args.profileId = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (value === "--output" || value === "-o") {
      args.outputPath = argv[index + 1] || "";
      index += 1;
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

function buildHeaders(apiKey) {
  return {
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
  };
}

async function requestJson(baseUrl, apiKey, requestPath, init = {}) {
  const response = await fetch(`${baseUrl}/rest/v1/${requestPath}`, {
    method: init.method || "GET",
    headers: {
      ...buildHeaders(apiKey),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GET ${requestPath} failed: ${response.status} ${body}`);
  }
  return response.json();
}

async function fetchAllProgress({ baseUrl, apiKey, tableName, profileId }) {
  const rows = await requestJson(baseUrl, apiKey, "rpc/get_review_progress", {
    method: "POST",
    body: JSON.stringify({ p_profile_id: profileId }),
  });
  return Array.isArray(rows) ? rows : [];
}

function normalizeProgress(item) {
  return {
    correct_count: Number(item.correct_count || 0),
    incorrect_count: Number(item.incorrect_count || 0),
    review_history: Array.isArray(item.review_history) ? item.review_history : [],
  };
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

  const progressRows = await fetchAllProgress({ baseUrl: supabaseUrl, apiKey: supabaseAnonKey, tableName, profileId });
  const exported = {
    profile_id: profileId,
    exported_at: new Date().toISOString(),
    progress: progressRows.map((item) => ({
      term: String(item.term || "").trim(),
      ...normalizeProgress(item),
    })),
  };
  await mkdir(PRIVATE_DIR, { recursive: true });
  const safeProfile = profileId.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "profile";
  const outputPath = cli.outputPath ? path.resolve(process.cwd(), cli.outputPath) : path.join(PRIVATE_DIR, `review-progress-${safeProfile}.json`);
  await writeFile(outputPath, `${JSON.stringify(exported, null, 2)}\n`, "utf8");

  const summary = {
    profile_id: profileId,
    fetched_progress_rows: progressRows.length,
    output: path.relative(BASE_DIR, outputPath),
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
