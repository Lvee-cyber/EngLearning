const APP_CONFIG = window.APP_CONFIG || {};

const state = {
  words: [],
  dictionary: [],
  wordsSource: "json",
  dictionarySource: "json",
  supabase: null,
};

const elements = {
  contentStatus: document.querySelector("#landing-content-status"),
  progressStatus: document.querySelector("#landing-progress-status"),
  dictionaryInput: document.querySelector("#landing-dictionary-search"),
  dictionarySubmit: document.querySelector("#landing-dictionary-submit"),
  dictionaryResult: document.querySelector("#landing-query-result"),
  calendarWeekday: document.querySelector("#calendar-weekday"),
  calendarDay: document.querySelector("#calendar-day"),
  calendarMonth: document.querySelector("#calendar-month"),
  calendarDateText: document.querySelector("#calendar-date-text"),
  calendarTimeText: document.querySelector("#calendar-time-text"),
  calendarLunarText: document.querySelector("#calendar-lunar-text"),
};

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
  elements.dictionaryResult.innerHTML = `<p class="status-text">${escapeHtml(message)}</p>`;
}

function findDictionaryEntry(query) {
  const normalized = normalizeText(query);
  if (!normalized) return null;

  const exact = state.dictionary.find((entry) => getAliases(entry).includes(normalized));
  if (exact) return exact;

  return (
    state.dictionary.find((entry) => {
      const aliases = getAliases(entry);
      return aliases.some((alias) => alias.startsWith(normalized));
    }) || null
  );
}

function renderLookupResult(entry, query) {
  if (!entry) {
    elements.dictionaryResult.innerHTML = `
      <div class="landing-result-card">
        <strong>未命中词条</strong>
        <p class="status-text">没有找到 <code>${escapeHtml(query)}</code>，可前往完整辞典页继续查询。</p>
        <a class="secondary-button link-button" href="./dictionary.html?q=${encodeURIComponent(query)}">去辞典页搜索</a>
      </div>
    `;
    return;
  }

  const translation =
    entry.translation ||
    toArray(entry.meaning || entry.meanings || entry.definition || entry.definitions)
      .map((item) => String(item))
      .join("；") ||
    "暂无释义";
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
        <a class="secondary-button link-button" href="./dictionary.html?q=${encodeURIComponent(entry.term)}">详细查询</a>
      </div>
      <p class="landing-result-translation">${escapeHtml(translation)}</p>
      <p class="status-text">${escapeHtml(analysis)}</p>
    </article>
  `;
}

function runLookup() {
  const query = String(elements.dictionaryInput.value || "").trim();
  if (!query) {
    renderLookupState("输入单词后即可在主页快速查看简要释义。");
    return;
  }
  renderLookupResult(findDictionaryEntry(query), query);
}

async function init() {
  state.supabase = window.ContentStore.createSupabaseClient();

  const [wordsResult, dictionaryResult] = await Promise.all([
    window.ContentStore.fetchCollection({
      supabase: state.supabase,
      tableName: APP_CONFIG.wordsTable || "vocabulary_words",
      fallbackUrl: APP_CONFIG.wordsUrl || "./data/words.json",
      label: "词库",
    }),
    window.ContentStore.fetchCollection({
      supabase: state.supabase,
      tableName: APP_CONFIG.dictionaryTable || "dictionary_entries",
      fallbackUrl: APP_CONFIG.dictionaryUrl || "./data/dictionary.json",
      label: "辞典",
    }),
  ]);

  state.words = Array.isArray(wordsResult.items) ? wordsResult.items : [];
  state.wordsSource = wordsResult.source;
  state.dictionary = normalizeDictionary(dictionaryResult.items);
  state.dictionarySource = dictionaryResult.source;

  elements.contentStatus.textContent = `词库 ${state.words.length} 条，辞典 ${state.dictionary.length} 条。当前读取来源：词库 ${state.wordsSource === "supabase" ? "Supabase" : "本地 JSON"}，辞典 ${state.dictionarySource === "supabase" ? "Supabase" : "本地 JSON"}。`;
  elements.progressStatus.textContent = state.supabase
    ? "在线进度已配置。进入复习页后填写相同同步标识即可在多端共享记录。"
    : "当前未检测到 Supabase 配置，复习页将只能读取本地基线内容。";
  renderLookupState("输入单词后即可在主页快速查看简要释义。");
}

elements.dictionarySubmit?.addEventListener("click", runLookup);
elements.dictionaryInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    runLookup();
  }
});

updateCalendarCard();
window.setInterval(updateCalendarCard, 1000);

init().catch((error) => {
  elements.contentStatus.textContent = `主页初始化失败：${error.message}`;
  elements.progressStatus.textContent = "请检查内容源或 Supabase 配置。";
  renderLookupState("当前无法读取辞典内容，请稍后重试。");
});
