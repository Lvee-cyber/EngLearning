const APP_CONFIG = window.APP_CONFIG || {};
const STORAGE_KEYS = {
  profileId: "englearning.profile_id",
};
const MASTERED_THRESHOLD = Number(APP_CONFIG.masteredThreshold || 10);
const REVIEW_PROGRESS_TABLE = APP_CONFIG.reviewProgressTable || APP_CONFIG.supabaseTable || "review_progress";
const CONTENT_STATS = APP_CONFIG.contentStats || {};
const PROGRESS_TIMEOUT_MS = Number(APP_CONFIG.progressTimeoutMs || 2500);
const WORDS_PAGE_SIZE = window.matchMedia?.("(max-width: 640px)").matches ? 12 : 24;

const state = {
  baseWords: [],
  words: [],
  wordsSource: "json",
  progressByTerm: {},
  supabase: null,
  sortKey: "added_at",
  sortDirection: "desc",
  searchSuggestions: [],
  activeSearchSuggestionIndex: -1,
  visibleCount: WORDS_PAGE_SIZE,
};

const elements = {
  profilePicker: document.querySelector("#words-profile-picker"),
  profilePickerToggle: document.querySelector("#words-profile-picker-toggle"),
  profilePickerPanel: document.querySelector("#words-profile-picker-panel"),
  profileIdInput: document.querySelector("#words-profile-id"),
  filter: document.querySelector("#words-filter"),
  filterPills: [...document.querySelectorAll(".words-filter-pill")],
  sortButtons: [...document.querySelectorAll(".words-sort-button")],
  search: document.querySelector("#words-search"),
  searchSuggestions: document.querySelector("#words-search-suggestions"),
  syncStatus: document.querySelector("#words-sync-status"),
  list: document.querySelector("#words-list"),
  empty: document.querySelector("#words-empty"),
  totalCount: document.querySelector("#words-total-count"),
  reviewableCount: document.querySelector("#words-reviewable-count"),
  masteredCount: document.querySelector("#words-mastered-count"),
  loadMoreRow: document.querySelector("#words-load-more-row"),
  loadMoreButton: document.querySelector("#words-load-more"),
  renderCount: document.querySelector("#words-render-count"),
};
let profilePicker = null;

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
  "pos",
  "part_of_speech",
  "senses",
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
  return String(entry.translation || joinReadable(entry.meaning || entry.meanings || entry.definition || entry.definitions) || "").trim();
}

function getTranslationHtml(entry) {
  const senses = getSenseItems(entry);
  if (!senses.length) return escapeHtml(getTranslationText(entry) || "暂无释义");
  return `
    <div class="sense-list word-translation">
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

function getPosText(entry) {
  if (!entry || typeof entry !== "object") return "";
  const direct = String(entry.pos || entry.part_of_speech || "").trim();
  if (direct) return direct;
  if (!Array.isArray(entry.senses)) return "";
  const values = [...new Set(entry.senses.map((item) => String(item?.pos || "").trim()).filter(Boolean))];
  return values.join(" / ");
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", { hour12: false });
}

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(`${label}超时`)), timeoutMs);
    }),
  ]);
}

function getStaticWordsStatus() {
  const total = Number(CONTENT_STATS.wordsCount || 0);
  const updatedAt = formatDate(CONTENT_STATS.wordsUpdatedAt) || "未知";
  const latestTerm = CONTENT_STATS.wordsLatestTerm || "未知";
  if (!total) return "";
  return `词库：${total}条（更新时间：${updatedAt}；最新：${latestTerm}）。`;
}

function renderStaticStats() {
  const total = Number(CONTENT_STATS.wordsCount || 0);
  if (total) elements.totalCount.textContent = String(total);
  if (!state.words.length) {
    elements.reviewableCount.textContent = "—";
    elements.masteredCount.textContent = "—";
  }
  const status = getStaticWordsStatus();
  if (status) elements.syncStatus.textContent = `${status}正在读取词条与在线进度。`;
}

function renderList(items) {
  const normalized = toArray(items).map((item) => escapeHtml(item));
  if (!normalized.length) return "";
  return `<ul>${normalized.map((item) => `<li>${item}</li>`).join("")}</ul>`;
}

function renderSearchSuggestions() {
  if (!elements.searchSuggestions) return;
  if (!state.searchSuggestions.length) {
    elements.searchSuggestions.innerHTML = "";
    elements.searchSuggestions.classList.add("hidden");
    return;
  }

  const query = String(elements.search.value || "").trim();
  elements.searchSuggestions.innerHTML = state.searchSuggestions
    .map((entry, index) => {
      const term = String(entry.term || "");
      const isActive = index === state.activeSearchSuggestionIndex;
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
            <span class="dictionary-suggestion-translation">${escapeHtml(getTranslationText(entry) || "暂无释义")}</span>
          </span>
          <span class="dictionary-suggestion-action" aria-hidden="true">筛选</span>
        </button>
      `;
    })
    .join("");
  elements.searchSuggestions.classList.remove("hidden");
}

function updateSearchSuggestions() {
  const query = String(elements.search.value || "").trim().toLowerCase();
  if (!query) {
    hideSearchSuggestions();
    return;
  }

  state.searchSuggestions = state.words
    .map((entry) => {
      const term = String(entry.term || "").trim().toLowerCase();
      const translation = getTranslationText(entry).toLowerCase();
      if (term.startsWith(query)) return { entry, score: 0 };
      if (term.includes(query)) return { entry, score: 1 };
      if (translation.includes(query)) return { entry, score: 2 };
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return String(a.entry.term || "").localeCompare(String(b.entry.term || ""));
    })
    .slice(0, 8)
    .map((item) => item.entry);
  state.activeSearchSuggestionIndex = state.searchSuggestions.length ? 0 : -1;
  renderSearchSuggestions();
}

function hideSearchSuggestions() {
  state.searchSuggestions = [];
  state.activeSearchSuggestionIndex = -1;
  if (!elements.searchSuggestions) return;
  elements.searchSuggestions.innerHTML = "";
  elements.searchSuggestions.classList.add("hidden");
}

function moveSearchSuggestion(offset) {
  if (!state.searchSuggestions.length) return;
  const total = state.searchSuggestions.length;
  state.activeSearchSuggestionIndex = (state.activeSearchSuggestionIndex + offset + total) % total;
  renderSearchSuggestions();
}

function selectSearchSuggestion(index) {
  const entry = state.searchSuggestions[index];
  if (!entry) return;
  elements.search.value = entry.term;
  hideSearchSuggestions();
  renderWords();
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

function renderReviewHistory(progress) {
  const history = Array.isArray(progress?.review_history) ? progress.review_history : [];
  if (!history.length) return "";

  const rows = history
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const result = item.result === "correct" ? "正确" : item.result === "incorrect" ? "错误" : item.result || "未知";
      const answeredAt = formatDate(item.answered_at);
      const mode = item.mode ? ` · ${item.mode}` : "";
      const answer = item.user_answer ? ` · ${item.user_answer}` : "";
      return `<li>${escapeHtml(`${answeredAt || "未知时间"} · ${result}${mode}${answer}`)}</li>`;
    })
    .filter(Boolean)
    .join("");

  if (!rows) return "";
  return `
    <section class="dictionary-section">
      <details class="word-review-history">
        <summary>复习记录 ${history.length} 条</summary>
        <ul>${rows}</ul>
      </details>
    </section>
  `;
}

function getProfileId() {
  return String(elements.profileIdInput.value || "").trim();
}

function getEmbeddedReview(entry) {
  const review = entry.review || {};
  return {
    correct_count: Number(review.correct_count || 0),
    incorrect_count: Number(review.incorrect_count || 0),
    review_history: Array.isArray(review.review_history) ? review.review_history : [],
  };
}

function getProgress(entry) {
  return state.progressByTerm[entry.term] || getEmbeddedReview(entry);
}

function getCorrectCount(entry) {
  return Number(getProgress(entry).correct_count || 0);
}

function getIncorrectCount(entry) {
  return Number(getProgress(entry).incorrect_count || 0);
}

function isMastered(entry) {
  return getCorrectCount(entry) >= MASTERED_THRESHOLD;
}

function isHard(entry) {
  return getIncorrectCount(entry) >= 3;
}

async function fetchWords(options = {}) {
  const useOnlineSource = options.online !== false;
  const { items, source } = await window.ContentStore.fetchCollection({
    supabase: useOnlineSource ? state.supabase : null,
    tableName: useOnlineSource ? APP_CONFIG.wordsTable || "vocabulary_words" : "",
    fallbackUrl: APP_CONFIG.wordsUrl || "./data/words.json",
    label: "词库",
  });
  const words = items;
  if (!Array.isArray(words)) throw new Error("words.json 格式不正确");
  state.baseWords = words;
  state.words = [...words];
  state.wordsSource = source;
}

async function fetchPersonalVocabulary() {
  const user = window.EngLearningAuth.getCurrentUser();
  state.words = user?.role === "admin" ? [...state.baseWords] : [];
  const profileId = getProfileId();
  if (!state.supabase || !profileId) return;

  const { data, error } = await window.ContentStore.fetchPersonalVocabulary(state.supabase);
  if (error) {
    console.warn("[words] 个人词库暂不可用。", error.message || error);
    return;
  }

  const merged = new Map(state.words.map((entry) => [String(entry.term || "").trim().toLowerCase(), entry]));
  (data || []).forEach((row) => {
    const payload = row?.payload;
    const term = String(payload?.term || row?.term || "").trim().toLowerCase();
    if (term && payload && !merged.has(term)) merged.set(term, payload);
  });
  state.words = [...merged.values()];
}

async function loadProgress() {
  const profileId = getProfileId();
  try {
    state.progressByTerm = profileId ? JSON.parse(window.localStorage.getItem(`englearning.progress.${profileId}`) || "{}") : {};
  } catch {
    state.progressByTerm = {};
  }
  if (!state.supabase || !profileId) {
    const status = getStaticWordsStatus();
    elements.syncStatus.textContent = `${status ? `${status}` : ""}当前未连接在线进度，展示的是词库内容和已有本地基线数据。`;
    return;
  }

  let data = [];
  let progressMode = "rpc";
  try {
    const response = await withTimeout(
      window.ContentStore.fetchReviewProgress(state.supabase, profileId),
      PROGRESS_TIMEOUT_MS,
      "在线进度读取",
    );
    if (response.error) throw response.error;
    data = response.data || [];
    progressMode = response.mode;
  } catch (error) {
    const status = getStaticWordsStatus();
    elements.syncStatus.textContent = `${status ? `${status}` : ""}在线进度暂未返回，已先展示本地词库；稍后可重试同步。`;
    return;
  }

  state.progressByTerm = Object.fromEntries(
    data.map((item) => [
      item.term,
      {
        correct_count: Number(item.correct_count || 0),
        incorrect_count: Number(item.incorrect_count || 0),
        review_history: Array.isArray(item.review_history) ? item.review_history : [],
      },
    ]),
  );
  try {
    window.localStorage.setItem(`englearning.progress.${profileId}`, JSON.stringify(state.progressByTerm));
  } catch {}
  elements.syncStatus.textContent = `已连接 ${profileId} 的个人词库与复习进度。`;
}

function updateStats() {
  elements.totalCount.textContent = String(state.words.length);
  elements.reviewableCount.textContent = String(state.words.filter((entry) => !isMastered(entry)).length);
  elements.masteredCount.textContent = String(state.words.filter((entry) => isMastered(entry)).length);
}

function syncFilterPills() {
  const activeFilter = elements.filter.value;
  elements.filterPills.forEach((pill) => {
    const isActive = pill.dataset.filterValue === activeFilter;
    pill.classList.toggle("is-active", isActive);
    pill.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function syncSortButtons() {
  elements.sortButtons.forEach((button) => {
    const isActive = button.dataset.sortKey === state.sortKey;
    const arrow = button.querySelector(".sort-arrow");
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
    if (arrow) arrow.textContent = isActive ? (state.sortDirection === "asc" ? "▲" : "▼") : "▲▼";
  });
}

function getAddedTimestamp(entry) {
  const rawValue = entry.added_at || entry.created_at || entry.updated_at || "";
  const timestamp = Date.parse(rawValue);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getSortValue(entry, key) {
  if (key === "term") return String(entry.term || "").trim().toLowerCase();
  if (key === "correct_count") return getProgress(entry).correct_count || 0;
  return getAddedTimestamp(entry);
}

function compareWordsBySort(a, b) {
  const direction = state.sortDirection === "asc" ? 1 : -1;
  const aValue = getSortValue(a, state.sortKey);
  const bValue = getSortValue(b, state.sortKey);
  let result = 0;

  if (typeof aValue === "string" || typeof bValue === "string") {
    result = String(aValue).localeCompare(String(bValue));
  } else {
    result = Number(aValue || 0) - Number(bValue || 0);
  }

  if (result !== 0) return result * direction;
  return String(a.term || "").localeCompare(String(b.term || ""));
}

function getDefaultSortDirection(key) {
  if (key === "term") return "asc";
  return "desc";
}

function setSort(key) {
  if (state.sortKey === key) {
    state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
  } else {
    state.sortKey = key;
    state.sortDirection = getDefaultSortDirection(key);
  }
  renderWords();
}

function applyFilter(words) {
  const filter = elements.filter.value;
  if (filter === "reviewable") return words.filter((entry) => !isMastered(entry));
  if (filter === "mastered") return words.filter((entry) => isMastered(entry));
  if (filter === "hard") return words.filter((entry) => isHard(entry));
  return words;
}

function applySearch(words) {
  const query = String(elements.search.value || "").trim().toLowerCase();
  if (!query) return words;
  const ranked = words
    .map((entry) => {
      const term = String(entry.term || "").trim().toLowerCase();
      const haystack = [entry.term, getTranslationText(entry), entry.analysis, ...(entry.expansions || [])].join(" ").toLowerCase();
      if (term.startsWith(query)) return { entry, score: 0 };
      if (term.includes(query)) return { entry, score: 1 };
      if (haystack.includes(query)) return { entry, score: 2 };
      return null;
    })
    .filter(Boolean);

  const hasPrefixMatches = ranked.some((item) => item.score === 0);
  return ranked
    .filter((item) => (hasPrefixMatches ? item.score === 0 : true))
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return String(a.entry.term || "").localeCompare(String(b.entry.term || ""));
    })
    .map((item) => item.entry);
}

function renderWords(options = {}) {
  if (options.reset !== false) state.visibleCount = WORDS_PAGE_SIZE;
  syncFilterPills();
  syncSortButtons();
  const filtered = applySearch(applyFilter([...state.words]));
  filtered.sort(compareWordsBySort);

  if (!filtered.length) {
    elements.list.innerHTML = "";
    elements.empty.classList.remove("hidden");
    elements.loadMoreRow.classList.add("hidden");
    return;
  }

  elements.empty.classList.add("hidden");
  const visibleItems = filtered.slice(0, state.visibleCount);
  elements.list.innerHTML = visibleItems
    .map((entry) => {
      const progress = getProgress(entry);
      const status = isMastered(entry) ? "熟词" : "待复习";
      const analysis = entry.analysis || entry.explanation || joinReadable(entry.definition || entry.definitions);
      const examples = toArray(entry.expansions || entry.examples);
      const acceptedAnswers = toArray(entry.accepted_answers);
      const meta = renderMetaItems(entry);
      return `
        <article class="word-card">
          <div class="word-card-head">
            <div>
              <h3>${escapeHtml(entry.term)}</h3>
              ${getPosText(entry) ? `<p class="word-pos">${escapeHtml(`词性：${getPosText(entry)}`)}</p>` : ""}
              <p class="word-pronunciation">${escapeHtml(entry.pronunciation || entry.phonetic || "暂无发音信息")}</p>
              ${getTranslationHtml(entry)}
            </div>
            ${isMastered(entry) ? `<span class="word-state is-mastered">${status}</span>` : ""}
          </div>
          <p class="word-analysis">${escapeHtml(entry.analysis || "当前词条还没有解析说明。")}</p>
          <div class="word-meta">
            <span>答对 ${Number(progress.correct_count || 0)}</span>
            <span>答错 ${Number(progress.incorrect_count || 0)}</span>
          </div>
          ${analysis ? `<section class="dictionary-section"><h3>词条解析</h3><p>${escapeHtml(analysis)}</p></section>` : ""}
          ${examples.length ? `<section class="dictionary-section"><h3>扩展表达</h3>${renderList(examples)}</section>` : ""}
          ${acceptedAnswers.length ? `<section class="dictionary-section"><h3>常见义项</h3>${renderList(acceptedAnswers)}</section>` : ""}
          ${renderReviewHistory(progress)}
          ${meta ? `<dl class="dictionary-meta">${meta}</dl>` : ""}
        </article>
      `;
    })
    .join("");

  const remaining = Math.max(0, filtered.length - visibleItems.length);
  elements.renderCount.textContent = `已显示 ${visibleItems.length} / ${filtered.length} 个词条`;
  elements.loadMoreButton.textContent = remaining ? `再显示 ${Math.min(WORDS_PAGE_SIZE, remaining)} 个` : "已显示全部";
  elements.loadMoreButton.disabled = remaining === 0;
  elements.loadMoreRow.classList.remove("hidden");
}

async function reload() {
  await fetchPersonalVocabulary();
  await loadProgress();
  updateStats();
  renderWords();
}

async function syncOnlineData() {
  try {
    await fetchWords({ online: true });
  } catch (error) {
    console.warn("[words] 在线词库刷新失败，继续使用本地词库。", error.message || error);
  }
  await reload();
}

async function init() {
  const user = await window.EngLearningAuth.requireActive();
  if (!user) return;
  elements.profileIdInput.value = user.username;
  state.supabase = window.ContentStore.createSupabaseClient();
  if (user.role === "admin") renderStaticStats();
  await fetchWords({ online: false });
  await fetchPersonalVocabulary();
  updateStats();
  renderWords();
  syncOnlineData().catch((error) => {
    elements.syncStatus.textContent = `在线数据同步失败，当前已展示本地词库：${error.message}`;
  });
}

elements.filter.addEventListener("change", renderWords);
document.querySelector(".words-toolbar")?.addEventListener("submit", (event) => event.preventDefault());
elements.filterPills.forEach((pill) => {
  pill.addEventListener("click", () => {
    const nextFilter = pill.dataset.filterValue || "all";
    if (elements.filter.value === nextFilter) return;
    elements.filter.value = nextFilter;
    renderWords();
  });
});
elements.sortButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setSort(button.dataset.sortKey || "added_at");
  });
});
elements.search.addEventListener("input", () => {
  renderWords();
  updateSearchSuggestions();
});
elements.search.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveSearchSuggestion(1);
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    moveSearchSuggestion(-1);
    return;
  }
  if (event.key === "Enter" && state.activeSearchSuggestionIndex >= 0) {
    event.preventDefault();
    selectSearchSuggestion(state.activeSearchSuggestionIndex);
  }
});
elements.search.addEventListener("focus", updateSearchSuggestions);
elements.search.addEventListener("blur", () => {
  window.setTimeout(hideSearchSuggestions, 120);
});
elements.searchSuggestions?.addEventListener("mousedown", (event) => {
  const button = event.target.closest("[data-index]");
  if (!button) return;
  event.preventDefault();
  selectSearchSuggestion(Number(button.dataset.index));
});
elements.loadMoreButton?.addEventListener("click", () => {
  state.visibleCount += WORDS_PAGE_SIZE;
  renderWords({ reset: false });
});

init().catch((error) => {
  elements.syncStatus.textContent = `初始化失败：${error.message}`;
});
