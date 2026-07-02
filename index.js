const APP_CONFIG = window.APP_CONFIG || {};

const state = {
  words: [],
  dictionary: [],
  wordsSource: "json",
  dictionarySource: "json",
  supabase: null,
  lookupTimer: null,
  lookupRequestId: 0,
  suggestions: [],
  suggestionTimer: null,
  suggestionRequestId: 0,
  activeSuggestionIndex: -1,
};

const elements = {
  contentStatus: document.querySelector("#landing-content-status"),
  progressStatus: document.querySelector("#landing-progress-status"),
  dictionaryInput: document.querySelector("#landing-dictionary-search"),
  dictionarySubmit: document.querySelector("#landing-dictionary-submit"),
  dictionarySuggestions: document.querySelector("#landing-dictionary-suggestions"),
  dictionaryResult: document.querySelector("#landing-query-result"),
  calendarWeekday: document.querySelector("#calendar-weekday"),
  calendarDay: document.querySelector("#calendar-day"),
  calendarMonth: document.querySelector("#calendar-month"),
  calendarDateText: document.querySelector("#calendar-date-text"),
  calendarTimeText: document.querySelector("#calendar-time-text"),
  calendarLunarText: document.querySelector("#calendar-lunar-text"),
};

const cacheHints = {
  words: null,
  dictionary: null,
};

const DETAIL_CACHE_KEY = "englearning.dictionary.detail";
const CONTENT_STATS = APP_CONFIG.contentStats || {};

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

function getPosText(entry) {
  if (!entry || typeof entry !== "object") return "";
  const direct = String(entry.pos || entry.part_of_speech || "").trim();
  if (direct) return direct;
  if (!Array.isArray(entry.senses)) return "";
  const values = [...new Set(entry.senses.map((item) => String(item?.pos || "").trim()).filter(Boolean))];
  return values.join(" / ");
}

function toArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value == null || value === "") return [];
  return [value];
}

function getSenseItems(entry) {
  if (!Array.isArray(entry?.senses)) return [];
  return entry.senses
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const pos = String(item.pos || "").trim();
      const translation = String(item.translation || item.meaning || item.definition || "").trim();
      if (!translation) return null;
      return { pos, translation };
    })
    .filter(Boolean);
}

function getTranslationText(entry) {
  const senses = getSenseItems(entry);
  if (senses.length) return senses.map((item) => `${item.pos ? `${item.pos} ` : ""}${item.translation}`).join("；");
  return (
    entry.translation ||
    toArray(entry.meaning || entry.meanings || entry.definition || entry.definitions)
      .map((item) => String(item))
      .join("；") ||
    "暂无释义"
  );
}

function getTranslationHtml(entry) {
  const senses = getSenseItems(entry);
  if (!senses.length) return `<p class="landing-result-translation">${escapeHtml(getTranslationText(entry))}</p>`;
  return `
    <div class="sense-list landing-result-translation">
      ${senses
        .map(
          (item) => `
            <div class="sense-item">
              ${item.pos ? `<span class="sense-pos">${escapeHtml(item.pos)}</span>` : ""}
              <span class="sense-meaning">${escapeHtml(item.translation)}</span>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
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
  return { ...item, term };
}

function normalizeDictionary(raw) {
  if (Array.isArray(raw)) return raw.map((item) => normalizeEntry(item)).filter(Boolean);
  if (raw && typeof raw === "object") {
    return Object.entries(raw)
      .map(([term, item]) => normalizeEntry(item, term))
      .filter(Boolean);
  }
  return [];
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

function formatLunarDate(date) {
  try {
    const formatter = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", {
      month: "long",
      day: "numeric",
    });
    return `农历 ${formatter.format(date).replaceAll("/", "")}`;
  } catch {
    return "农历 暂不可用";
  }
}

function updateCalendarCard() {
  const now = new Date();
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  elements.calendarWeekday.textContent = weekdays[now.getDay()];
  elements.calendarDay.textContent = String(now.getDate()).padStart(2, "0");
  elements.calendarMonth.textContent = months[now.getMonth()];
  elements.calendarDateText.textContent = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}.${String(now.getDate()).padStart(2, "0")}`;
  elements.calendarTimeText.textContent = now.toLocaleTimeString("zh-CN", { hour12: false });
  elements.calendarLunarText.textContent = formatLunarDate(now);
}

function renderLookupState(message) {
  const isLoading = /正在/.test(message);
  elements.dictionaryResult.innerHTML = isLoading
    ? `
      <div class="lookup-skeleton" aria-label="${escapeHtml(message)}">
        <span></span>
        <span></span>
        <span></span>
      </div>
    `
    : `<p class="status-text">${escapeHtml(message)}</p>`;
}

function renderSuggestionLoading(query) {
  if (!elements.dictionarySuggestions || !query) return;
  elements.dictionarySuggestions.innerHTML = `<div class="dictionary-suggestion-loading">正在联想 ${escapeHtml(query)}...</div>`;
  elements.dictionarySuggestions.classList.remove("hidden");
}

function hideSuggestions() {
  if (state.suggestionTimer) {
    window.clearTimeout(state.suggestionTimer);
    state.suggestionTimer = null;
  }
  state.suggestions = [];
  state.activeSuggestionIndex = -1;
  if (!elements.dictionarySuggestions) return;
  elements.dictionarySuggestions.innerHTML = "";
  elements.dictionarySuggestions.classList.add("hidden");
}

function cacheDictionaryDetail(entry) {
  try {
    window.sessionStorage?.setItem(
      DETAIL_CACHE_KEY,
      JSON.stringify({
        term: entry.term,
        entry,
        cachedAt: Date.now(),
      }),
    );
  } catch {}
}

function renderContentStatus() {
  const wordsCount = Number(CONTENT_STATS.wordsCount || state.words.length || 0);
  const dictionaryCount = Number(CONTENT_STATS.dictionaryCount || state.dictionary.length || 0);
  if (wordsCount || dictionaryCount) {
    const wordsUpdated = formatContentTimestamp(CONTENT_STATS.wordsUpdatedAt);
    const dictionaryUpdated = formatContentTimestamp(CONTENT_STATS.dictionaryUpdatedAt);
    const wordsTerm = CONTENT_STATS.wordsLatestTerm ? CONTENT_STATS.wordsLatestTerm : "未知";
    const dictionaryTerm = CONTENT_STATS.dictionaryLatestTerm ? CONTENT_STATS.dictionaryLatestTerm : "未知";
    elements.contentStatus.innerHTML = `
      <span class="content-status-line">词库：${escapeHtml(wordsCount)}条（更新时间：${escapeHtml(wordsUpdated)}；最新：${escapeHtml(wordsTerm)}）。</span>
      <span class="content-status-line">辞典：${escapeHtml(dictionaryCount)}条（更新时间：${escapeHtml(dictionaryUpdated)}；最新：${escapeHtml(dictionaryTerm)}）。</span>
    `;
    return;
  }
  if (cacheHints.words || cacheHints.dictionary) {
    elements.contentStatus.textContent = "已命中最近缓存，正在同步最新内容。";
    return;
  }
  elements.contentStatus.textContent = "正在读取词库与辞典。";
}

function formatContentTimestamp(value) {
  if (!value) return "未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", { hour12: false });
}

function renderProgressStatus() {
  elements.progressStatus.textContent = state.supabase
    ? "在线进度已配置。进入复习页后填写相同同步标识即可在多端共享记录。"
    : "当前未检测到 Supabase 配置，复习页将只能读取本地基线内容。";
}

function findDictionaryEntry(query) {
  const normalized = normalizeText(query);
  if (!normalized) return null;

  return state.dictionary.find((entry) => getAliases(entry).includes(normalized)) || null;
}

async function fetchDictionarySuggestions(query) {
  const { items } = await window.ContentStore.fetchPrefix({
    supabase: state.supabase,
    tableName: APP_CONFIG.dictionaryTable || "dictionary_entries",
    fallbackUrl: APP_CONFIG.dictionaryUrl || "./data/dictionary.json",
    label: "辞典",
    query,
    limit: 8,
  });
  return normalizeDictionary(items);
}

function renderSuggestions() {
  if (!elements.dictionarySuggestions) return;
  if (!state.suggestions.length) {
    elements.dictionarySuggestions.innerHTML = "";
    elements.dictionarySuggestions.classList.add("hidden");
    return;
  }

  const query = String(elements.dictionaryInput.value || "").trim();
  elements.dictionarySuggestions.innerHTML = state.suggestions
    .map((entry, index) => {
      const isActive = index === state.activeSuggestionIndex;
      const term = String(entry.term || "");
      const highlightedTerm =
        query && term.toLowerCase().startsWith(query.toLowerCase())
          ? `<mark>${escapeHtml(term.slice(0, query.length))}</mark>${escapeHtml(term.slice(query.length))}`
          : escapeHtml(term);
      return `
        <button
          class="dictionary-suggestion${isActive ? " is-active" : ""}"
          type="button"
          role="option"
          aria-selected="${isActive ? "true" : "false"}"
          data-index="${index}"
        >
          <span class="dictionary-suggestion-main">
            <span class="dictionary-suggestion-term">${highlightedTerm}</span>
            <span class="dictionary-suggestion-translation">${escapeHtml(getTranslationText(entry))}</span>
          </span>
          <span class="dictionary-suggestion-action" aria-hidden="true">查看</span>
        </button>
      `;
    })
    .join("");
  elements.dictionarySuggestions.classList.remove("hidden");
}

async function updateSuggestions() {
  const query = String(elements.dictionaryInput.value || "").trim();
  const requestId = ++state.suggestionRequestId;
  if (!query) {
    hideSuggestions();
    return;
  }

  const suggestions = await fetchDictionarySuggestions(query).catch(() => []);
  if (requestId !== state.suggestionRequestId) return;
  state.suggestions = suggestions.slice(0, 8);
  state.activeSuggestionIndex = state.suggestions.length ? 0 : -1;
  renderSuggestions();
}

async function showPrefixSuggestions(query) {
  const normalizedQuery = String(query || "").trim();
  if (!normalizedQuery) return false;
  const suggestions = state.suggestions.length ? state.suggestions : await fetchDictionarySuggestions(normalizedQuery).catch(() => []);
  state.suggestions = suggestions.slice(0, 8);
  state.activeSuggestionIndex = state.suggestions.length ? 0 : -1;
  renderSuggestions();
  if (!state.suggestions.length) return false;
  renderLookupState(`找到 ${state.suggestions.length} 个以 ${normalizedQuery} 开头的候选词，点击候选词进入辞典页。`);
  return true;
}

function scheduleSuggestions() {
  const query = String(elements.dictionaryInput.value || "").trim();
  if (state.suggestionTimer) window.clearTimeout(state.suggestionTimer);
  if (!query) {
    hideSuggestions();
    return;
  }
  renderSuggestionLoading(query);
  state.suggestionTimer = window.setTimeout(() => {
    state.suggestionTimer = null;
    updateSuggestions().catch(() => {
      hideSuggestions();
    });
  }, 80);
}

function moveActiveSuggestion(offset) {
  if (!state.suggestions.length) return;
  const total = state.suggestions.length;
  state.activeSuggestionIndex = (state.activeSuggestionIndex + offset + total) % total;
  renderSuggestions();
}

function selectSuggestion(index) {
  const entry = state.suggestions[index];
  if (!entry) return;
  elements.dictionaryInput.value = entry.term;
  hideSuggestions();
  window.location.href = `./dictionary.html?q=${encodeURIComponent(entry.term)}`;
}

function renderLookupResult(entry, query) {
  if (!entry) {
    elements.dictionaryResult.innerHTML = `
      <div class="landing-result-card">
        <strong>未命中词条</strong>
        <p class="status-text">没有找到 <code>${escapeHtml(query)}</code>，可前往完整辞典页继续查询。</p>
        <a class="secondary-button link-button dictionary-detail-link" href="./dictionary.html?q=${encodeURIComponent(query)}">去辞典页搜索</a>
      </div>
    `;
    return;
  }

  const analysis = entry.analysis || entry.explanation || "当前词条还没有更多解析说明。";
  const posText = getPosText(entry);

  elements.dictionaryResult.innerHTML = `
    <article class="landing-result-card">
      <div class="landing-result-head">
        <div>
          <h3>${escapeHtml(entry.term)}</h3>
          ${posText ? `<p class="word-pos">${escapeHtml(`词性：${posText}`)}</p>` : ""}
          <p class="word-pronunciation">${escapeHtml(entry.pronunciation || entry.phonetic || "暂无发音信息")}</p>
        </div>
        <a class="secondary-button link-button dictionary-detail-link" data-term="${escapeHtml(entry.term)}" href="./dictionary.html?q=${encodeURIComponent(entry.term)}">详细查询</a>
      </div>
      ${getTranslationHtml(entry)}
      <p class="status-text">${escapeHtml(analysis)}</p>
    </article>
  `;
}

async function findDictionaryEntryRemote(query) {
  const { item } = await window.ContentStore.fetchTerm({
    supabase: state.supabase,
    tableName: APP_CONFIG.dictionaryTable || "dictionary_entries",
    fallbackUrl: APP_CONFIG.dictionaryUrl || "./data/dictionary.json",
    label: "辞典",
    term: query,
  });
  const entry = normalizeEntry(item, query);
  if (!entry) return null;
  state.dictionary.push(entry);
  return entry;
}

async function runLookup() {
  if (state.lookupTimer) {
    window.clearTimeout(state.lookupTimer);
    state.lookupTimer = null;
  }
  const query = String(elements.dictionaryInput.value || "").trim();
  state.lookupRequestId += 1;
  if (!query) {
    renderLookupState("输入单词后即可联想匹配候选词。");
    return;
  }
  renderLookupState("正在匹配候选词。");
  if (await showPrefixSuggestions(query)) return;
  elements.dictionaryResult.innerHTML = `
    <div class="landing-result-card">
      <strong>未找到候选词</strong>
      <p class="status-text">没有找到以 <code>${escapeHtml(query)}</code> 开头的候选词，可前往完整辞典页继续查询。</p>
      <a class="secondary-button link-button dictionary-detail-link" href="./dictionary.html?q=${encodeURIComponent(query)}">去辞典页搜索</a>
    </div>
  `;
}

function scheduleLookup() {
  const query = String(elements.dictionaryInput.value || "").trim();
  if (state.lookupTimer) window.clearTimeout(state.lookupTimer);
  scheduleSuggestions();
  if (!query) {
    state.lookupRequestId += 1;
    renderLookupState("输入单词后即可在主页快速查看简要释义。");
    return;
  }
  state.lookupRequestId += 1;
  renderLookupState("点击候选词进入辞典页，或继续输入缩小范围。");
}

function hydrateLandingCache() {
  state.supabase = window.ContentStore.createSupabaseClient();
  cacheHints.words = window.ContentStore.peekCollectionCache({
    supabase: state.supabase,
    tableName: APP_CONFIG.wordsTable || "vocabulary_words",
    fallbackUrl: APP_CONFIG.wordsUrl || "./data/words.json",
    label: "词库",
  });

  if (cacheHints.words) {
    state.words = Array.isArray(cacheHints.words.items) ? cacheHints.words.items : [];
    state.wordsSource = cacheHints.words.source || "json";
  }

  renderContentStatus();
  renderProgressStatus();
}

async function init() {
  if (!state.supabase) {
    state.supabase = window.ContentStore.createSupabaseClient();
  }

  renderContentStatus();
  renderProgressStatus();
  renderLookupState("输入单词后即可联想匹配候选词。");
}

elements.dictionarySubmit?.addEventListener("click", () => {
  runLookup().catch((error) => {
    renderLookupState(`查询失败：${error.message}`);
  });
});
elements.dictionaryInput?.addEventListener("input", scheduleLookup);
elements.dictionaryInput?.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveActiveSuggestion(1);
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    moveActiveSuggestion(-1);
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    if (state.activeSuggestionIndex >= 0 && state.suggestions[state.activeSuggestionIndex]) {
      selectSuggestion(state.activeSuggestionIndex);
      return;
    }
    runLookup().catch((error) => {
      renderLookupState(`查询失败：${error.message}`);
    });
  }
});
elements.dictionaryInput?.addEventListener("blur", () => {
  window.setTimeout(hideSuggestions, 120);
});
elements.dictionaryInput?.addEventListener("focus", () => {
  scheduleSuggestions();
});
elements.dictionarySuggestions?.addEventListener("mousedown", (event) => {
  const button = event.target.closest("[data-index]");
  if (!button) return;
  event.preventDefault();
  selectSuggestion(Number(button.dataset.index));
});
function prepareDictionaryDetailHandoff(event) {
  const link = event.target.closest(".dictionary-detail-link");
  if (!link) return;
  const term = String(link.dataset.term || "").trim();
  if (!term) return;
  const entry = findDictionaryEntry(term);
  if (!entry) return;
  cacheDictionaryDetail(entry);
}

elements.dictionaryResult?.addEventListener("pointerdown", prepareDictionaryDetailHandoff);
elements.dictionaryResult?.addEventListener("mousedown", prepareDictionaryDetailHandoff);
elements.dictionaryResult?.addEventListener("click", prepareDictionaryDetailHandoff);

updateCalendarCard();
window.setInterval(updateCalendarCard, 1000);

hydrateLandingCache();
init().catch((error) => {
  elements.contentStatus.textContent = `主页初始化失败：${error.message}`;
  elements.progressStatus.textContent = "请检查内容源或 Supabase 配置。";
  renderLookupState("当前无法读取辞典内容，请稍后重试。");
});
