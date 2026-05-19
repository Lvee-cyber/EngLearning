const APP_CONFIG = window.APP_CONFIG || {};
const STORAGE_KEYS = {
  profileId: "englearning.profile_id",
};
const MASTERED_THRESHOLD = Number(APP_CONFIG.masteredThreshold || 10);
const REVIEW_PROGRESS_TABLE = APP_CONFIG.reviewProgressTable || APP_CONFIG.supabaseTable || "review_progress";

const state = {
  words: [],
  wordsSource: "json",
  progressByTerm: {},
  supabase: null,
};

const elements = {
  profileIdInput: document.querySelector("#words-profile-id"),
  filter: document.querySelector("#words-filter"),
  filterPills: [...document.querySelectorAll(".words-filter-pill")],
  search: document.querySelector("#words-search"),
  syncStatus: document.querySelector("#words-sync-status"),
  list: document.querySelector("#words-list"),
  empty: document.querySelector("#words-empty"),
  totalCount: document.querySelector("#words-total-count"),
  reviewableCount: document.querySelector("#words-reviewable-count"),
  masteredCount: document.querySelector("#words-mastered-count"),
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

async function fetchWords() {
  const { items, source } = await window.ContentStore.fetchCollection({
    supabase: state.supabase,
    tableName: APP_CONFIG.wordsTable || "vocabulary_words",
    fallbackUrl: APP_CONFIG.wordsUrl || "./data/words.json",
    label: "词库",
  });
  const words = items;
  if (!Array.isArray(words)) throw new Error("words.json 格式不正确");
  state.words = words;
  state.wordsSource = source;
}

async function loadProgress() {
  const profileId = getProfileId();
  if (!state.supabase || !profileId) {
    elements.syncStatus.textContent = "当前未连接在线进度，展示的是词库内容和已有本地基线数据。";
    return;
  }

  const { data, error } = await state.supabase
    .from(REVIEW_PROGRESS_TABLE)
    .select("term, correct_count, incorrect_count, review_history")
    .eq("profile_id", profileId);

  if (error) throw error;
  state.progressByTerm = Object.fromEntries(
    (data || []).map((item) => [
      item.term,
      {
        correct_count: Number(item.correct_count || 0),
        incorrect_count: Number(item.incorrect_count || 0),
        review_history: Array.isArray(item.review_history) ? item.review_history : [],
      },
    ]),
  );
  elements.syncStatus.textContent = `已连接在线进度：${profileId}；词库来源：${state.wordsSource === "supabase" ? "Supabase" : "本地 JSON"}`;
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

function renderWords() {
  syncFilterPills();
  const hasSearchQuery = Boolean(String(elements.search.value || "").trim());
  const filtered = applySearch(applyFilter([...state.words]));
  filtered.sort((a, b) => {
    if (hasSearchQuery) return String(a.term || "").localeCompare(String(b.term || ""));
    if (isMastered(a) !== isMastered(b)) return isMastered(a) ? 1 : -1;
    return a.term.localeCompare(b.term);
  });

  if (!filtered.length) {
    elements.list.innerHTML = "";
    elements.empty.classList.remove("hidden");
    return;
  }

  elements.empty.classList.add("hidden");
  elements.list.innerHTML = filtered
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
}

async function reload() {
  window.localStorage.setItem(STORAGE_KEYS.profileId, getProfileId());
  await loadProgress();
  updateStats();
  renderWords();
}

async function init() {
  elements.profileIdInput.value = window.localStorage.getItem(STORAGE_KEYS.profileId) || APP_CONFIG.defaultProfileId || "";
  state.supabase = window.ContentStore.createSupabaseClient();
  await fetchWords();
  await reload();
}

elements.filter.addEventListener("change", renderWords);
elements.filterPills.forEach((pill) => {
  pill.addEventListener("click", () => {
    const nextFilter = pill.dataset.filterValue || "all";
    if (elements.filter.value === nextFilter) return;
    elements.filter.value = nextFilter;
    renderWords();
  });
});
elements.search.addEventListener("input", renderWords);
elements.profileIdInput.addEventListener("change", () => {
  reload().catch((error) => {
    elements.syncStatus.textContent = `同步读取失败：${error.message}`;
  });
});

init().catch((error) => {
  elements.syncStatus.textContent = `初始化失败：${error.message}`;
});
