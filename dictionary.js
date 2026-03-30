const APP_CONFIG = window.APP_CONFIG || {};

const state = {
  entries: [],
  dictionaryLoaded: false,
};

const elements = {
  searchInput: document.querySelector("#dictionary-search"),
  submitButton: document.querySelector("#dictionary-submit"),
  clearButton: document.querySelector("#dictionary-clear"),
  status: document.querySelector("#dictionary-status"),
  summary: document.querySelector("#dictionary-summary"),
  result: document.querySelector("#dictionary-result"),
};

const COMMON_FIELDS = new Set([
  "term",
  "word",
  "headword",
  "title",
  "name",
  "translation",
  "meaning",
  "meanings",
  "definition",
  "definitions",
  "analysis",
  "explanation",
  "phonetic",
  "pronunciation",
  "expansions",
  "examples",
  "origin",
  "type",
  "accepted_answers",
  "review",
  "added_at",
]);

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function toArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value == null || value === "") return [];
  return [value];
}

function joinReadable(value) {
  return toArray(value)
    .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
    .join("；");
}

function pickTerm(entry, fallbackTerm = "") {
  return String(entry.term || entry.word || entry.headword || entry.title || entry.name || fallbackTerm || "").trim();
}

function normalizeEntry(item, fallbackTerm = "") {
  if (!item) return null;
  if (typeof item === "string") {
    const term = String(fallbackTerm || item).trim();
    return term ? { term, translation: item } : null;
  }
  if (typeof item !== "object") return null;

  const term = pickTerm(item, fallbackTerm);
  if (!term) return null;
  return {
    ...item,
    term,
  };
}

function normalizeDictionary(raw) {
  if (Array.isArray(raw)) {
    return raw.map((item) => normalizeEntry(item)).filter(Boolean);
  }
  if (raw && typeof raw === "object") {
    return Object.entries(raw)
      .map(([term, item]) => normalizeEntry(item, term))
      .filter(Boolean);
  }
  throw new Error("dictionary.json 格式不正确");
}

function getAliases(entry) {
  return [
    entry.term,
    entry.word,
    entry.headword,
    entry.title,
    entry.name,
    ...(Array.isArray(entry.aliases) ? entry.aliases : []),
    ...(Array.isArray(entry.forms) ? entry.forms : []),
  ]
    .filter(Boolean)
    .map((item) => normalizeText(item));
}

function findMatches(query) {
  const normalized = normalizeText(query);
  if (!normalized) return [];
  return state.entries.filter((entry) => getAliases(entry).includes(normalized));
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", { hour12: false });
}

function renderList(items) {
  const normalized = toArray(items).map((item) => escapeHtml(item));
  if (!normalized.length) return "";
  return `<ul>${normalized.map((item) => `<li>${item}</li>`).join("")}</ul>`;
}

function renderMetaItems(entry) {
  const items = [];
  if (entry.type) items.push(["词条类型", entry.type]);
  if (entry.origin) items.push(["词源", entry.origin]);
  if (entry.added_at) items.push(["收录时间", formatDate(entry.added_at)]);

  const extraItems = Object.entries(entry)
    .filter(([key, value]) => !COMMON_FIELDS.has(key) && value != null && value !== "" && !(Array.isArray(value) && value.length === 0))
    .map(([key, value]) => [key, joinReadable(value)]);

  return [...items, ...extraItems]
    .map(
      ([label, value]) => `
        <div class="dictionary-meta-item">
          <dt>${escapeHtml(label)}</dt>
          <dd>${escapeHtml(value)}</dd>
        </div>
      `,
    )
    .join("");
}

function renderEntry(entry) {
  const translation = entry.translation || joinReadable(entry.meaning || entry.meanings || entry.definition || entry.definitions) || "暂无释义";
  const analysis = entry.analysis || entry.explanation || joinReadable(entry.definition || entry.definitions);
  const examples = toArray(entry.expansions || entry.examples);
  const pronunciation = entry.pronunciation || entry.phonetic || "";
  const acceptedAnswers = toArray(entry.accepted_answers);
  const meta = renderMetaItems(entry);

  return `
    <article class="dictionary-result-card">
      <div class="dictionary-head">
        <div>
          <h2>${escapeHtml(entry.term)}</h2>
          <p class="dictionary-pronunciation">${escapeHtml(pronunciation || "暂无发音信息")}</p>
          <p class="dictionary-translation">${escapeHtml(translation)}</p>
        </div>
        <span class="word-state is-reviewable">已收录</span>
      </div>

      ${analysis ? `<section class="dictionary-section"><h3>词条解析</h3><p>${escapeHtml(analysis)}</p></section>` : ""}
      ${examples.length ? `<section class="dictionary-section"><h3>扩展表达</h3>${renderList(examples)}</section>` : ""}
      ${acceptedAnswers.length ? `<section class="dictionary-section"><h3>常见义项</h3>${renderList(acceptedAnswers)}</section>` : ""}
      ${meta ? `<dl class="dictionary-meta">${meta}</dl>` : ""}
    </article>
  `;
}

function renderEmpty(query) {
  elements.result.innerHTML = `<div class="dictionary-empty status-text">本地辞典查无此词：<strong>${escapeHtml(query)}</strong></div>`;
}

function updateSummary(message) {
  elements.summary.textContent = message;
}

function runSearch() {
  const query = String(elements.searchInput.value || "").trim();
  if (!query) {
    elements.result.innerHTML = "";
    updateSummary("输入单词后点击查询。");
    return;
  }

  const matches = findMatches(query);
  if (!matches.length) {
    renderEmpty(query);
    updateSummary("未命中本地辞典。");
    return;
  }

  elements.result.innerHTML = matches.map((entry) => renderEntry(entry)).join("");
  updateSummary(`命中 ${matches.length} 条本地辞典记录。`);
}

function clearSearch() {
  elements.searchInput.value = "";
  elements.result.innerHTML = "";
  updateSummary("输入单词后点击查询。");
  elements.searchInput.focus();
}

async function fetchDictionary() {
  const response = await fetch(APP_CONFIG.dictionaryUrl || "./data/dictionary.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`辞典读取失败：${response.status}`);
  const raw = await response.json();
  state.entries = normalizeDictionary(raw);
  state.dictionaryLoaded = true;
  elements.status.textContent = `本地辞典已载入，共 ${state.entries.length} 条记录。`;
  updateSummary("输入单词后点击查询。");
}

async function init() {
  await fetchDictionary();
}

elements.submitButton.addEventListener("click", runSearch);
elements.clearButton.addEventListener("click", clearSearch);
elements.searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    runSearch();
  }
});

init().catch((error) => {
  elements.status.textContent = `初始化失败：${error.message}`;
  updateSummary("请检查 dictionary.json 是否存在且格式正确。");
});
