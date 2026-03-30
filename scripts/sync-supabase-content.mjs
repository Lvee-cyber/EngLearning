import { readFile } from "node:fs/promises";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
}

const TABLES = [
  {
    filePath: "data/words.json",
    tableName: "vocabulary_words",
    label: "words",
  },
  {
    filePath: "data/dictionary.json",
    tableName: "dictionary_entries",
    label: "dictionary",
  },
];

function getHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

async function readJsonFile(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function normalizeEntries(raw, label) {
  if (!Array.isArray(raw)) {
    throw new Error(`${label} file must be a JSON array.`);
  }

  return raw.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`${label} entry at index ${index} is not an object.`);
    }
    const term = String(entry.term || "").trim();
    if (!term) {
      throw new Error(`${label} entry at index ${index} is missing term.`);
    }
    return {
      term,
      payload: entry,
      updated_at: new Date().toISOString(),
    };
  });
}

async function request(path, init = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: getHeaders(init.headers),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`${init.method || "GET"} ${path} failed: ${response.status} ${message}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return null;
}

function chunk(items, size) {
  const groups = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

async function fetchExistingTerms(tableName) {
  const data = await request(`${tableName}?select=term`, {
    method: "GET",
  });
  return new Set((data || []).map((item) => String(item.term || "")));
}

async function upsertEntries(tableName, entries) {
  for (const batch of chunk(entries, 200)) {
    await request(`${tableName}?on_conflict=term`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(batch),
    });
  }
}

function buildInFilter(values) {
  return values.map((value) => `"${String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`).join(",");
}

async function deleteTerms(tableName, terms) {
  for (const batch of chunk(terms, 100)) {
    const filter = encodeURIComponent(`in.(${buildInFilter(batch)})`);
    await request(`${tableName}?term=${filter}`, {
      method: "DELETE",
      headers: {
        Prefer: "return=minimal",
      },
    });
  }
}

async function syncTable({ filePath, tableName, label }) {
  const raw = await readJsonFile(filePath);
  const entries = normalizeEntries(raw, label);
  const currentTerms = new Set(entries.map((entry) => entry.term));
  const existingTerms = await fetchExistingTerms(tableName);
  const termsToDelete = [...existingTerms].filter((term) => !currentTerms.has(term));

  await upsertEntries(tableName, entries);
  if (termsToDelete.length) {
    await deleteTerms(tableName, termsToDelete);
  }

  console.log(`[sync] ${label}: upserted ${entries.length} rows, deleted ${termsToDelete.length} rows.`);
}

for (const table of TABLES) {
  await syncTable(table);
}
