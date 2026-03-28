const APP_CONFIG = window.APP_CONFIG || {};
const STORAGE_KEYS = {
  profileId: "englearning.profile_id",
};
const MASTERED_THRESHOLD = Number(APP_CONFIG.masteredThreshold || 10);

const state = {
  words: [],
  progressByTerm: {},
  supabase: null,
};

const elements = {
  profileIdInput: document.querySelector("#words-profile-id"),
  filter: document.querySelector("#words-filter"),
  search: document.querySelector("#words-search"),
  syncStatus: document.querySelector("#words-sync-status"),
  list: document.querySelector("#words-list"),
  empty: document.querySelector("#words-empty"),
  totalCount: document.querySelector("#words-total-count"),
  reviewableCount: document.querySelector("#words-reviewable-count"),
  masteredCount: document.querySelector("#words-mastered-count"),
};

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

function createSupabaseClient() {
  if (!APP_CONFIG.supabaseUrl || !APP_CONFIG.supabaseAnonKey) return null;
  if (!window.supabase?.createClient) return null;
  return window.supabase.createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseAnonKey, {
    auth: { persistSession: false },
  });
}

async function fetchWords() {
  const response = await fetch(APP_CONFIG.wordsUrl || "./data/words.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`词库读取失败：${response.status}`);
  const words = await response.json();
  if (!Array.isArray(words)) throw new Error("words.json 格式不正确");
  state.words = words;
}

async function loadProgress() {
  const profileId = getProfileId();
  if (!state.supabase || !profileId) {
    elements.syncStatus.textContent = "当前未连接在线进度，展示的是词库内容和已有本地基线数据。";
    return;
  }

  const { data, error } = await state.supabase
    .from(APP_CONFIG.supabaseTable || "review_progress")
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
  elements.syncStatus.textContent = `已连接在线进度：${profileId}`;
}

function updateStats() {
  elements.totalCount.textContent = String(state.words.length);
  elements.reviewableCount.textContent = String(state.words.filter((entry) => !isMastered(entry)).length);
  elements.masteredCount.textContent = String(state.words.filter((entry) => isMastered(entry)).length);
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
  return words.filter((entry) => {
    const haystack = [entry.term, entry.translation, entry.analysis, ...(entry.expansions || [])].join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

function renderWords() {
  const filtered = applySearch(applyFilter([...state.words]));
  filtered.sort((a, b) => {
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
      const chips = (entry.expansions || []).slice(0, 4).map((item) => `<span class="expansion-chip">${escapeHtml(item)}</span>`).join("");
      const status = isMastered(entry) ? "熟词" : "待复习";
      return `
        <article class="word-card">
          <div class="word-card-head">
            <div>
              <h3>${escapeHtml(entry.term)}</h3>
              <p class="word-pronunciation">${escapeHtml(entry.pronunciation || entry.phonetic || "暂无发音信息")}</p>
              <p class="word-translation">${escapeHtml(entry.translation)}</p>
            </div>
            ${isMastered(entry) ? `<span class="word-state is-mastered">${status}</span>` : ""}
          </div>
          <p class="word-analysis">${escapeHtml(entry.analysis || "当前词条还没有解析说明。")}</p>
          <div class="word-meta">
            <span>答对 ${Number(progress.correct_count || 0)}</span>
            <span>答错 ${Number(progress.incorrect_count || 0)}</span>
          </div>
          <div class="expansions-list">${chips}</div>
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
  state.supabase = createSupabaseClient();
  await fetchWords();
  await reload();
}

elements.filter.addEventListener("change", renderWords);
elements.search.addEventListener("input", renderWords);
elements.profileIdInput.addEventListener("change", () => {
  reload().catch((error) => {
    elements.syncStatus.textContent = `同步读取失败：${error.message}`;
  });
});

init().catch((error) => {
  elements.syncStatus.textContent = `初始化失败：${error.message}`;
});
