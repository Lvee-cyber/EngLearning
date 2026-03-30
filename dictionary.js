const APP_CONFIG = window.APP_CONFIG || {};

const state = {
  entries: [],
  dictionaryLoaded: false,
  dictionarySource: "json",
  suggestions: [],
  activeSuggestionIndex: -1,
  supabase: null,
  addingTerms: new Set(),
  addedTerms: new Set(),
};

const elements = {
  searchInput: document.querySelector("#dictionary-search"),
  submitButton: document.querySelector("#dictionary-submit"),
  clearButton: document.querySelector("#dictionary-clear"),
  status: document.querySelector("#dictionary-status"),
  summary: document.querySelector("#dictionary-summary"),
  result: document.querySelector("#dictionary-result"),
  suggestions: document.querySelector("#dictionary-suggestions"),
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

function getSuggestionMatches(query) {
  const normalized = normalizeText(query);
  if (!normalized) return [];

  const ranked = state.entries
    .map((entry) => {
      const aliases = getAliases(entry);
      const startsWithTerm = normalizeText(entry.term).startsWith(normalized);
      const startsWithAlias = aliases.some((alias) => alias.startsWith(normalized));
      if (!startsWithAlias) return null;
      return {
        entry,
        score: startsWithTerm ? 0 : 1,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return a.entry.term.localeCompare(b.entry.term);
    })
    .slice(0, 8);

  return ranked.map((item) => item.entry);
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
  const term = normalizeText(entry.term);
  const isAdded = state.addedTerms.has(term);

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

      <div class="dictionary-card-actions">
        <button
          class="secondary-button dictionary-add-button"
          type="button"
          data-term="${escapeHtml(entry.term)}"
          ${isAdded ? "disabled" : ""}
        >
          ${isAdded ? "已加入单词本" : "添加到单词本"}
        </button>
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

function updateStatus(message) {
  elements.status.textContent = message;
}

function hideSuggestions() {
  state.suggestions = [];
  state.activeSuggestionIndex = -1;
  elements.suggestions.innerHTML = "";
  elements.suggestions.classList.add("hidden");
}

function selectSuggestion(index) {
  const entry = state.suggestions[index];
  if (!entry) return;
  elements.searchInput.value = entry.term;
  hideSuggestions();
  runSearch();
}

function renderSuggestions() {
  if (!state.suggestions.length) {
    elements.suggestions.innerHTML = "";
    elements.suggestions.classList.add("hidden");
    return;
  }

  elements.suggestions.innerHTML = state.suggestions
    .map((entry, index) => {
      const isActive = index === state.activeSuggestionIndex;
      return `
        <button
          class="dictionary-suggestion${isActive ? " is-active" : ""}"
          type="button"
          role="option"
          aria-selected="${isActive ? "true" : "false"}"
          data-index="${index}"
        >
          <span class="dictionary-suggestion-term">${escapeHtml(entry.term)}</span>
          <span class="dictionary-suggestion-translation">${escapeHtml(entry.translation || "暂无释义")}</span>
        </button>
      `;
    })
    .join("");
  elements.suggestions.classList.remove("hidden");
}

function updateSuggestions() {
  const query = String(elements.searchInput.value || "").trim();
  state.suggestions = getSuggestionMatches(query);
  state.activeSuggestionIndex = state.suggestions.length ? 0 : -1;
  renderSuggestions();
}

function moveActiveSuggestion(offset) {
  if (!state.suggestions.length) return;
  const total = state.suggestions.length;
  state.activeSuggestionIndex = (state.activeSuggestionIndex + offset + total) % total;
  renderSuggestions();

  const activeButton = elements.suggestions.querySelector(`[data-index="${state.activeSuggestionIndex}"]`);
  activeButton?.scrollIntoView({ block: "nearest" });
}

function runSearch() {
  const query = String(elements.searchInput.value || "").trim();
  hideSuggestions();
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
  hideSuggestions();
  updateSummary("输入单词后点击查询。");
  elements.searchInput.focus();
}

async function fetchDictionary() {
  const { items, source } = await window.ContentStore.fetchCollection({
    supabase: state.supabase,
    tableName: APP_CONFIG.dictionaryTable || "dictionary_entries",
    fallbackUrl: APP_CONFIG.dictionaryUrl || "./data/dictionary.json",
    label: "辞典",
  });
  const raw = items;
  state.entries = normalizeDictionary(raw);
  state.dictionaryLoaded = true;
  state.dictionarySource = source;
  updateStatus(`${source === "supabase" ? "Supabase" : "本地 JSON"} 辞典已载入，共 ${state.entries.length} 条记录。`);
  updateSummary("输入单词后点击查询。");
}

function buildWordPayload(entry) {
  return {
    ...entry,
    review: entry.review || {
      correct_count: 0,
      incorrect_count: 0,
      review_history: [],
    },
    added_at: entry.added_at || new Date().toISOString(),
  };
}

async function addToVocabulary(term) {
  if (!state.supabase) {
    updateSummary("当前未配置 Supabase，无法加入单词本。");
    return;
  }

  const normalizedTerm = normalizeText(term);
  const entry = state.entries.find((item) => normalizeText(item.term) === normalizedTerm);
  if (!entry || state.addingTerms.has(normalizedTerm)) return;

  state.addingTerms.add(normalizedTerm);
  updateStatus(`正在将 ${entry.term} 加入单词本...`);

  const payload = buildWordPayload(entry);
  const { error } = await state.supabase.from(APP_CONFIG.wordsTable || "vocabulary_words").upsert(
    {
      term: payload.term,
      payload,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "term" },
  );

  state.addingTerms.delete(normalizedTerm);

  if (error) {
    updateStatus(`加入单词本失败：${error.message}`);
    updateSummary(`未能把 ${entry.term} 写入单词本。`);
    return;
  }

  state.addedTerms.add(normalizedTerm);
  updateStatus(`${entry.term} 已同步加入单词本。`);
  updateSummary(`已将 ${entry.term} 同步到 Supabase 单词本。`);
  renderCurrentResults();
}

function renderCurrentResults() {
  const query = String(elements.searchInput.value || "").trim();
  if (!query) return;
  const matches = findMatches(query);
  if (!matches.length) {
    renderEmpty(query);
    return;
  }
  elements.result.innerHTML = matches.map((entry) => renderEntry(entry)).join("");
}

async function init() {
  state.supabase = window.ContentStore.createSupabaseClient();
  await fetchDictionary();
}

elements.submitButton.addEventListener("click", runSearch);
elements.clearButton.addEventListener("click", clearSearch);
elements.searchInput.addEventListener("input", () => {
  updateSuggestions();
});
elements.searchInput.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (!state.suggestions.length) {
      updateSuggestions();
    } else {
      moveActiveSuggestion(1);
    }
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    if (state.suggestions.length) moveActiveSuggestion(-1);
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    if (state.suggestions.length && state.activeSuggestionIndex >= 0) {
      selectSuggestion(state.activeSuggestionIndex);
      return;
    }
    runSearch();
    return;
  }

  if (event.key === "Escape") {
    hideSuggestions();
  }
});
elements.searchInput.addEventListener("blur", () => {
  window.setTimeout(() => {
    hideSuggestions();
  }, 120);
});
elements.searchInput.addEventListener("focus", () => {
  updateSuggestions();
});
elements.suggestions.addEventListener("mousedown", (event) => {
  const button = event.target.closest("[data-index]");
  if (!button) return;
  event.preventDefault();
  selectSuggestion(Number(button.dataset.index));
});
elements.result.addEventListener("click", (event) => {
  const button = event.target.closest(".dictionary-add-button");
  if (!button) return;
  addToVocabulary(button.dataset.term).catch((error) => {
    updateStatus(`加入单词本失败：${error.message}`);
  });
});

init().catch((error) => {
  updateStatus(`初始化失败：${error.message}`);
  updateSummary("请检查 dictionary.json 是否存在且格式正确。");
});
