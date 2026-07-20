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
  progressByTerm: {},
  progressMode: "local",
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
  dueCount: document.querySelector("#landing-due-count"),
  masteredCount: document.querySelector("#landing-mastered-count"),
  todayCount: document.querySelector("#landing-today-count"),
  streakCount: document.querySelector("#landing-streak-count"),
  progressRing: document.querySelector("#landing-progress-ring"),
  studyNote: document.querySelector("#landing-study-note"),
  profilePicker: document.querySelector("#landing-profile-picker"),
  profilePickerToggle: document.querySelector("#landing-profile-picker-toggle"),
  profilePickerPanel: document.querySelector("#landing-profile-picker-panel"),
  profileIdInput: document.querySelector("#landing-profile-id"),
};
let profilePicker = null;

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
  const profileId = String(elements.profileIdInput?.value || window.localStorage.getItem("englearning.profile_id") || "").trim();
  if (!state.supabase) {
    elements.progressStatus.textContent = "当前未检测到 Supabase 配置，复习页将只能读取本地进度。";
    return;
  }
  if (!profileId) {
    elements.progressStatus.textContent = "请选择或输入同步标识，即可显示对应学习进度。";
    return;
  }
  if (state.progressMode === "rpc") {
    elements.progressStatus.textContent = `当前标识：${profileId}；在线进度已连接。`;
  } else if (state.progressMode === "legacy") {
    elements.progressStatus.textContent = `当前标识：${profileId}；已通过旧版数据表读取进度。`;
  } else {
    elements.progressStatus.textContent = `当前标识：${profileId}；在线进度暂不可用，已显示本机缓存。`;
  }
}

function hydrateProfileOptions() {
  const storedProfileId = String(window.localStorage.getItem("englearning.profile_id") || APP_CONFIG.defaultProfileId || "").trim();
  elements.profileIdInput.value = storedProfileId;
  profilePicker?.setOptions(window.ContentStore.getRememberedProfileIds());
  window.ContentStore
    .listProfileIds(state.supabase)
    .then((result) => profilePicker?.setOptions(result.profileIds))
    .catch((error) => console.warn("[home] 同步标识读取失败。", error.message || error));
}

function dayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function calculateStreak(history) {
  const days = new Set(history.map((item) => dayKey(item?.answered_at)).filter(Boolean));
  const cursor = new Date();
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

async function loadStudyDashboard() {
  const { items, source } = await window.ContentStore.fetchCollection({
    supabase: state.supabase,
    tableName: APP_CONFIG.wordsTable || "vocabulary_words",
    fallbackUrl: APP_CONFIG.wordsUrl || "./data/words.json",
    label: "词库",
  });
  state.words = Array.isArray(items) ? items : [];
  state.wordsSource = source;

  const profileId = String(elements.profileIdInput?.value || window.localStorage.getItem("englearning.profile_id") || APP_CONFIG.defaultProfileId || "").trim();
  state.progressByTerm = {};
  state.progressMode = profileId ? "offline" : "local";
  if (state.supabase && profileId) {
    const [progressResponse, personalResponse] = await Promise.all([
      window.ContentStore.fetchReviewProgress(state.supabase, profileId),
      state.supabase.rpc("get_personal_vocabulary", { p_profile_id: profileId }),
    ]);
    if (progressResponse.error) {
      try {
        state.progressByTerm = JSON.parse(window.localStorage.getItem(`englearning.progress.${profileId}`) || "{}");
      } catch {
        state.progressByTerm = {};
      }
      console.warn("[home] 在线进度暂不可用，已使用本机缓存。", progressResponse.error.message || progressResponse.error);
    } else {
      state.progressMode = progressResponse.mode;
      state.progressByTerm = Object.fromEntries((progressResponse.data || []).map((item) => [normalizeText(item.term), item]));
    }
    if (personalResponse.error) console.warn("[home] 个人词库暂不可用。", personalResponse.error.message || personalResponse.error);
    const merged = new Map(state.words.map((entry) => [normalizeText(entry.term), entry]));
    (personalResponse.data || []).forEach((row) => {
      const term = normalizeText(row?.payload?.term || row?.term);
      if (term && row?.payload && !merged.has(term)) merged.set(term, row.payload);
    });
    state.words = [...merged.values()];
  }

  const threshold = Number(APP_CONFIG.masteredThreshold || 10);
  const mastered = state.words.filter((entry) => Number(state.progressByTerm[normalizeText(entry.term)]?.correct_count || 0) >= threshold).length;
  const due = Math.max(0, state.words.length - mastered);
  const history = Object.values(state.progressByTerm).flatMap((item) => (Array.isArray(item.review_history) ? item.review_history : []));
  const today = dayKey(new Date());
  const todayCount = history.filter((item) => dayKey(item?.answered_at) === today).length;
  const progress = state.words.length ? Math.round((mastered / state.words.length) * 100) : 0;

  elements.dueCount.textContent = String(due);
  elements.masteredCount.textContent = String(mastered);
  elements.todayCount.textContent = String(todayCount);
  elements.streakCount.textContent = String(calculateStreak(history));
  elements.progressRing?.style.setProperty("--progress", `${progress}%`);
  elements.studyNote.textContent = profileId
    ? todayCount
      ? `今天已经完成 ${todayCount} 次回忆，再来一小轮巩固记忆。`
      : `今天有 ${due} 个词可以继续巩固，先完成一轮 5 到 10 个。`
    : `词库已有 ${state.words.length} 个词；选择同步标识后，这里会显示对应的每日进度。`;
  renderProgressStatus();
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
  renderLookupState("正在查询完整词条。");
  const entry = findDictionaryEntry(query) || (await findDictionaryEntryRemote(query));
  renderLookupResult(entry, query);
  showPrefixSuggestions(query).catch(() => {});
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
  renderLookupState("输入单词后即可联想匹配候选词。");
  hydrateProfileOptions();
  await loadStudyDashboard();
}

async function switchLandingProfile() {
  const profileId = String(elements.profileIdInput.value || "").trim();
  const profileIds = window.ContentStore.rememberProfileId(profileId);
  profilePicker?.setOptions(profileIds);
  elements.progressStatus.textContent = profileId ? `正在读取 ${profileId} 的学习进度。` : "请选择同步标识。";
  await loadStudyDashboard();
  const result = await window.ContentStore.listProfileIds(state.supabase);
  profilePicker?.setOptions(result.profileIds);
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
profilePicker = window.ProfilePicker?.create({
  root: elements.profilePicker,
  input: elements.profileIdInput,
  toggle: elements.profilePickerToggle,
  panel: elements.profilePickerPanel,
  onCommit: () => {
    switchLandingProfile().catch((error) => {
      elements.progressStatus.textContent = `进度读取失败：${error.message}`;
    });
  },
});
init().catch((error) => {
  elements.contentStatus.textContent = `主页初始化失败：${error.message}`;
  elements.progressStatus.textContent = "请检查内容源或 Supabase 配置。";
  renderLookupState("当前无法读取辞典内容，请稍后重试。");
});
