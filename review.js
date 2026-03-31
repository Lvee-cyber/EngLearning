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
  profileSuggestions: [],
  queue: [],
  currentIndex: 0,
  currentItem: null,
  lastResult: null,
  supabase: null,
  syncReady: false,
  historyVisible: false,
  currentSessionId: "",
  currentSessionStartedAt: "",
  currentSlotChars: [],
};

const elements = {
  homeView: document.querySelector("#home-view"),
  startButton: document.querySelector("#start-button"),
  submitButton: document.querySelector("#submit-button"),
  nextButton: document.querySelector("#next-button"),
  restartButton: document.querySelector("#restart-button"),
  exitButton: document.querySelector("#exit-button"),
  wordsButton: document.querySelector("#words-button"),
  dictionaryButton: document.querySelector("#dictionary-button"),
  reviewCount: document.querySelector("#review-count"),
  profileIdInput: document.querySelector("#profile-id"),
  profileIdToggle: document.querySelector("#profile-id-toggle"),
  profileIdSuggestions: document.querySelector("#profile-id-suggestions"),
  setupStatus: document.querySelector("#setup-status"),
  syncStatus: document.querySelector("#sync-status"),
  historyToggleButton: document.querySelector("#history-toggle-button"),
  historyOverviewPanel: document.querySelector("#history-overview-panel"),
  historyOverviewSummary: document.querySelector("#history-overview-summary"),
  historyOverviewRecords: document.querySelector("#history-overview-records"),
  newWordsCount: document.querySelector("#new-words-count"),
  masteredWordsCount: document.querySelector("#mastered-words-count"),
  quizPanel: document.querySelector("#quiz-panel"),
  resultPanel: document.querySelector("#result-panel"),
  resultModal: document.querySelector(".result-modal"),
  progressText: document.querySelector("#progress-text"),
  libraryCountText: document.querySelector("#library-count-text"),
  spellingSlots: document.querySelector("#spelling-slots"),
  translationText: document.querySelector("#translation-text"),
  resultTitle: document.querySelector("#result-title"),
  resultIcon: document.querySelector("#result-icon"),
  resultMessage: document.querySelector("#result-message"),
  userAnswerText: document.querySelector("#user-answer-text"),
  userAnswerBlock: document.querySelector("#user-answer-block"),
  correctAnswerText: document.querySelector("#correct-answer-text"),
  pronunciationText: document.querySelector("#pronunciation-text"),
  analysisText: document.querySelector("#analysis-text"),
  expansionsList: document.querySelector("#expansions-list"),
  historyText: document.querySelector("#history-text"),
  actionRows: Array.from(document.querySelectorAll(".setup-grid, .setup-actions, .quiz-topbar, .answer-row, .result-actions")),
};

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function normalizeWord(value) {
  return String(value || "").trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function updateSetupStatus(message) {
  elements.setupStatus.innerHTML = message;
}

function updateSyncStatus(message, tone = "muted") {
  elements.syncStatus.textContent = message;
  elements.syncStatus.dataset.tone = tone;
}

function showElement(element, visible) {
  element.classList.toggle("hidden", !visible);
}

function setReviewMode(active) {
  showElement(elements.homeView, !active);
  showElement(elements.quizPanel, active && !state.lastResult);
  if (!active) showElement(elements.resultPanel, false);
}

function getProfileId() {
  return String(elements.profileIdInput.value || "").trim();
}

function saveProfileId() {
  const profileId = getProfileId();
  window.localStorage.setItem(STORAGE_KEYS.profileId, profileId);
  return profileId;
}

function hydrateProfileId() {
  const fromStorage = window.localStorage.getItem(STORAGE_KEYS.profileId);
  elements.profileIdInput.value = fromStorage || APP_CONFIG.defaultProfileId || "";
}

function getFilteredProfileSuggestions(includeAllWhenEmpty = false) {
  const keyword = normalizeWord(elements.profileIdInput?.value || "");
  if (!keyword) return includeAllWhenEmpty ? state.profileSuggestions.slice(0, 8) : [];
  return state.profileSuggestions.filter((profileId) => normalizeWord(profileId).includes(keyword)).slice(0, 8);
}

function closeProfileSuggestions() {
  if (!elements.profileIdSuggestions || !elements.profileIdToggle) return;
  elements.profileIdSuggestions.classList.add("hidden");
  elements.profileIdToggle.setAttribute("aria-expanded", "false");
}

function openProfileSuggestions(includeAllWhenEmpty = false) {
  if (!elements.profileIdSuggestions || !elements.profileIdToggle) return;
  renderProfileSuggestions(includeAllWhenEmpty);
  const suggestions = getFilteredProfileSuggestions(includeAllWhenEmpty);
  if (!suggestions.length) {
    closeProfileSuggestions();
    return;
  }
  elements.profileIdSuggestions.classList.remove("hidden");
  elements.profileIdToggle.setAttribute("aria-expanded", "true");
}

function selectProfileSuggestion(profileId) {
  elements.profileIdInput.value = profileId;
  saveProfileId();
  closeProfileSuggestions();
  elements.profileIdInput.focus();
}

function renderProfileSuggestions(includeAllWhenEmpty = false) {
  if (!elements.profileIdSuggestions) return;
  const suggestions = getFilteredProfileSuggestions(includeAllWhenEmpty);
  elements.profileIdSuggestions.innerHTML = suggestions
    .map(
      (profileId, index) =>
        `<button class="suggest-option" type="button" role="option" data-profile-id="${escapeHtml(profileId)}" aria-selected="${index === 0 ? "true" : "false"}">${escapeHtml(profileId)}</button>`,
    )
    .join("");
  if (!suggestions.length) {
    closeProfileSuggestions();
    return;
  }
  elements.profileIdSuggestions.querySelectorAll(".suggest-option").forEach((button) => {
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      selectProfileSuggestion(button.dataset.profileId || "");
    });
  });
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

function getReviewHistory(entry) {
  return Array.isArray(getProgress(entry).review_history) ? getProgress(entry).review_history : [];
}

function getReviewableWords() {
  return state.words.filter((entry) => getCorrectCount(entry) < MASTERED_THRESHOLD);
}

function getMasteredWords() {
  return state.words.filter((entry) => getCorrectCount(entry) >= MASTERED_THRESHOLD);
}

function updateHomeStats() {
  elements.newWordsCount.textContent = String(getReviewableWords().length);
  elements.masteredWordsCount.textContent = String(getMasteredWords().length);
}

function parseAnsweredAt(value) {
  if (!value) return Number.NaN;
  const normalized = String(value).replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  return Date.parse(normalized);
}

function formatDateTime(value) {
  const time = parseAnsweredAt(value);
  if (Number.isNaN(time)) return String(value || "");
  return new Date(time).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function createSessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildHistorySessions() {
  const rawRecords = Object.entries(state.progressByTerm)
    .flatMap(([term, progress]) =>
      (Array.isArray(progress.review_history) ? progress.review_history : []).map((item) => ({
        term,
        answered_at: item.answered_at || "",
        result: item.result || "",
        user_answer: item.user_answer || "",
        session_id: item.session_id || "",
        session_started_at: item.session_started_at || "",
      })),
    )
    .sort((a, b) => parseAnsweredAt(a.answered_at) - parseAnsweredAt(b.answered_at));

  const sessions = [];
  let legacyGroupIndex = 0;
  const thresholdMs = 45 * 60 * 1000;

  rawRecords.forEach((record) => {
    const answeredAtMs = parseAnsweredAt(record.answered_at);
    let sessionKey = record.session_id || "";
    let sessionStartedAt = record.session_started_at || record.answered_at;

    if (!sessionKey) {
      const previous = sessions[sessions.length - 1];
      const previousAnsweredAt = previous ? parseAnsweredAt(previous.lastAnsweredAt) : Number.NaN;
      const shouldStartNew =
        !previous ||
        Number.isNaN(answeredAtMs) ||
        Number.isNaN(previousAnsweredAt) ||
        answeredAtMs - previousAnsweredAt > thresholdMs;

      if (shouldStartNew) legacyGroupIndex += 1;
      sessionKey = `legacy-${legacyGroupIndex}`;
      sessionStartedAt = previous && !shouldStartNew ? previous.sessionStartedAt : record.answered_at;
    }

    let session = sessions.find((item) => item.id === sessionKey);
    if (!session) {
      session = {
        id: sessionKey,
        sessionStartedAt,
        lastAnsweredAt: record.answered_at,
        records: [],
      };
      sessions.push(session);
    }

    session.records.push(record);
    session.lastAnsweredAt = record.answered_at;
    if (!session.sessionStartedAt || parseAnsweredAt(record.answered_at) < parseAnsweredAt(session.sessionStartedAt)) {
      session.sessionStartedAt = record.answered_at;
    }
  });

  return sessions
    .map((session) => {
      const correctWords = session.records.filter((item) => item.result === "correct").map((item) => item.term);
      const wrongWords = session.records.filter((item) => item.result !== "correct").map((item) => item.term);
      return {
        ...session,
        total: session.records.length,
        correctCount: correctWords.length,
        wrongCount: wrongWords.length,
        correctWords,
        wrongWords,
      };
    })
    .sort((a, b) => parseAnsweredAt(b.sessionStartedAt) - parseAnsweredAt(a.sessionStartedAt));
}

function moveButtonFocus(container, direction) {
  const buttons = getVisibleNavigables(container);
  if (!buttons.length) return;
  const currentIndex = buttons.indexOf(document.activeElement);
  const baseIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (baseIndex + direction + buttons.length) % buttons.length;
  buttons[nextIndex].focus();
}

function getVisibleNavigables(container) {
  return Array.from(container.querySelectorAll("button, select")).filter((element) => !element.disabled && element.offsetParent !== null);
}

function handleActionRowKeydown(event) {
  const target = event.target.closest("button, select");
  if (!target) return;
  if (target.tagName === "SELECT" && (event.key === "ArrowUp" || event.key === "ArrowDown")) return;

  const container = event.currentTarget;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    event.preventDefault();
    moveButtonFocus(container, 1);
    return;
  }
  if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    event.preventDefault();
    moveButtonFocus(container, -1);
    return;
  }
  if ((event.key === " " || event.code === "Space") && target.tagName === "BUTTON") {
    event.preventDefault();
    target.click();
  }
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
    state.syncReady = false;
    state.progressByTerm = {};
    updateSyncStatus("未启用在线同步。请填写同步标识并配置 Supabase。", "warn");
    return;
  }

  const { data, error } = await state.supabase
    .from(REVIEW_PROGRESS_TABLE)
    .select("term, correct_count, incorrect_count, review_history, updated_at")
    .eq("profile_id", profileId);

  if (error) throw error;

  state.progressByTerm = Object.fromEntries(
    (data || []).map((item) => [
      item.term,
      {
        correct_count: Number(item.correct_count || 0),
        incorrect_count: Number(item.incorrect_count || 0),
        review_history: Array.isArray(item.review_history) ? item.review_history : [],
        updated_at: item.updated_at || "",
      },
    ]),
  );

  state.syncReady = true;
  updateSyncStatus(`在线同步已连接：${profileId}`, "ok");
}

async function fetchProfileSuggestions() {
  if (!state.supabase) {
    state.profileSuggestions = [];
    renderProfileSuggestions();
    return;
  }

  const seen = new Set();
  const suggestions = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await state.supabase
      .from(REVIEW_PROGRESS_TABLE)
      .select("profile_id, updated_at")
      .order("updated_at", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) throw error;

    const batch = Array.isArray(data) ? data : [];
    batch.forEach((item) => {
      const profileId = String(item.profile_id || "").trim();
      if (!profileId || seen.has(profileId)) return;
      seen.add(profileId);
      suggestions.push(profileId);
    });

    if (batch.length < pageSize) break;
    offset += pageSize;
  }

  state.profileSuggestions = suggestions;
  renderProfileSuggestions();
}

async function bootData() {
  state.supabase = window.ContentStore.createSupabaseClient();
  await fetchWords();
  await fetchProfileSuggestions();
  await loadProgress();
  updateHomeStats();
  updateSetupStatus(
    `已读取${state.wordsSource === "supabase" ? " Supabase " : "本地 JSON "}词库，共 ${state.words.length} 个词条。当前待复习 ${getReviewableWords().length} 个。`,
  );
}

function renderHistoryOverview(message = "") {
  if (message) {
    elements.historyOverviewSummary.innerHTML = `<p class="status-text">${escapeHtml(message)}</p>`;
    elements.historyOverviewRecords.innerHTML = "";
    return;
  }

  const entries = Object.entries(state.progressByTerm);
  if (!entries.length) {
    elements.historyOverviewSummary.innerHTML = `<p class="status-text">当前同步标识还没有复习记录。</p>`;
    elements.historyOverviewRecords.innerHTML = "";
    return;
  }

  const totalCorrect = entries.reduce((sum, [, progress]) => sum + Number(progress.correct_count || 0), 0);
  const totalIncorrect = entries.reduce((sum, [, progress]) => sum + Number(progress.incorrect_count || 0), 0);
  const masteredCount = entries.filter(([, progress]) => Number(progress.correct_count || 0) >= MASTERED_THRESHOLD).length;
  const reviewableCount = entries.length - masteredCount;
  const sessions = buildHistorySessions();

  elements.historyOverviewSummary.innerHTML = `
    <div class="history-overview-stats">
      <span class="history-overview-chip">复习场次 ${sessions.length}</span>
      <span class="history-overview-chip">记录词条 ${entries.length}</span>
      <span class="history-overview-chip">待复习 ${reviewableCount}</span>
      <span class="history-overview-chip">熟词 ${masteredCount}</span>
      <span class="history-overview-chip is-ok">累计答对 ${totalCorrect}</span>
      <span class="history-overview-chip is-bad">累计答错 ${totalIncorrect}</span>
    </div>
  `;

  if (!sessions.length) {
    elements.historyOverviewRecords.innerHTML = `<p class="status-text">当前标识还没有可展示的详细作答记录。</p>`;
    return;
  }

  elements.historyOverviewRecords.innerHTML = `
    <div class="history-overview-list">
      ${sessions
        .map(
          (session) => `
            <article class="history-overview-item">
              <div class="history-session-head">
                <strong>${escapeHtml(formatDateTime(session.sessionStartedAt))}</strong>
                <span class="history-session-meta">复习 ${session.total} 个单词，答对 ${session.correctCount} 个，答错 ${session.wrongCount} 个</span>
              </div>
              <div class="history-session-groups">
                <div class="history-session-group">
                  <span class="history-session-label is-ok">答对单词</span>
                  <div class="history-session-words">
                    ${
                      session.correctWords.length
                        ? session.correctWords.map((word) => `<span class="history-word-chip is-ok">${escapeHtml(word)}</span>`).join("")
                        : `<span class="history-word-chip is-empty">本场无答对词</span>`
                    }
                  </div>
                </div>
                <div class="history-session-group">
                  <span class="history-session-label is-bad">答错单词</span>
                  <div class="history-session-words">
                    ${
                      session.wrongWords.length
                        ? session.wrongWords.map((word) => `<span class="history-word-chip is-bad">${escapeHtml(word)}</span>`).join("")
                        : `<span class="history-word-chip is-empty">本场无答错词</span>`
                    }
                  </div>
                </div>
              </div>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

async function toggleHistoryOverview() {
  const nextVisible = !state.historyVisible;
  state.historyVisible = nextVisible;
  showElement(elements.historyOverviewPanel, nextVisible);
  elements.historyToggleButton.textContent = nextVisible ? "收起历史记录" : "查看历史记录";
  elements.historyToggleButton.setAttribute("aria-expanded", String(nextVisible));

  if (!nextVisible) return;

  const profileId = saveProfileId();
  if (!profileId) {
    renderHistoryOverview("请先填写同步标识，再查看该标识下的历史复习记录。");
    return;
  }

  try {
    await loadProgress();
    updateHomeStats();
    renderHistoryOverview();
  } catch (error) {
    renderHistoryOverview(`历史记录读取失败：${error.message}`);
  }
}

function pickReviewItems() {
  const total = Number(elements.reviewCount.value);
  const reviewable = getReviewableWords();
  const selected = shuffle(reviewable).slice(0, Math.min(total, reviewable.length));
  state.queue = selected.map((item) => item.term);
  state.currentIndex = 0;
}

function renderQuestion() {
  const term = state.queue[state.currentIndex];
  const entry = state.words.find((item) => item.term === term);
  state.currentItem = entry;
  state.lastResult = null;

  setReviewMode(true);
  showElement(elements.resultPanel, false);
  elements.progressText.textContent = `第 ${state.currentIndex + 1} 题 / 共 ${state.queue.length} 题`;
  elements.libraryCountText.textContent = `待复习 ${getReviewableWords().length} 个`;
  renderSpellingSlots(entry.term);
  elements.translationText.textContent = entry.translation;
}

async function startReview() {
  const profileId = saveProfileId();
  if (!profileId) {
    updateSetupStatus("请先填写同步标识，用同一个标识可以在多端共享进度。");
    elements.profileIdInput.focus();
    return;
  }
  try {
    await loadProgress();
    updateHomeStats();
  } catch (error) {
    updateSyncStatus(`同步读取失败：${error.message}`, "bad");
  }
  if (!state.syncReady) {
    updateSetupStatus("当前在线同步未就绪，请先完成 Supabase 配置。");
    return;
  }
  if (!getReviewableWords().length) {
    updateSetupStatus(`当前没有待复习词条。累计词条 ${state.words.length} 个。`);
    return;
  }

  pickReviewItems();
  state.currentSessionId = createSessionId();
  state.currentSessionStartedAt = nowIso();
  renderQuestion();
}

function exitToHome() {
  state.queue = [];
  state.currentIndex = 0;
  state.currentItem = null;
  state.lastResult = null;
  showElement(elements.resultPanel, false);
  setReviewMode(false);
  elements.startButton.focus();
}

function buildUserAnswer(entry, typedTail) {
  return `${entry.term[0] || ""}${typedTail.trim()}`;
}

function isCorrect(entry, typedTail) {
  return normalizeWord(buildUserAnswer(entry, typedTail)) === normalizeWord(entry.term);
}

function nowIso() {
  const date = new Date();
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}${sign}${hh}${mm}`;
}

function getSlotInputs() {
  return Array.from(elements.spellingSlots.querySelectorAll(".slot-input"));
}

function focusSlot(index) {
  const inputs = getSlotInputs();
  if (inputs[index]) inputs[index].focus();
}

function getTypedTailFromSlots() {
  const inputs = getSlotInputs();
  let inputIndex = 0;
  return state.currentSlotChars
    .slice(1)
    .map((char) => {
      if (char === " ") return " ";
      const input = inputs[inputIndex];
      inputIndex += 1;
      return input ? input.value.trim() : "";
    })
    .join("");
}

function handleSlotInput(event) {
  const input = event.target;
  const index = Number(input.dataset.index || "0");
  const letters = input.value.replace(/[^a-zA-Z]/g, "");
  if (!letters) {
    input.value = "";
    return;
  }

  const chars = [...letters];
  input.value = chars[0];
  const inputs = getSlotInputs();
  for (let offset = 1; offset < chars.length; offset += 1) {
    const next = inputs[index + offset];
    if (!next) break;
    next.value = chars[offset];
  }
  if (index < inputs.length - 1) {
    focusSlot(Math.min(index + chars.length, inputs.length - 1));
  }
}

function handleSlotKeydown(event) {
  const input = event.target;
  const index = Number(input.dataset.index || "0");
  const inputs = getSlotInputs();
  if (event.key === "Backspace" && !input.value && index > 0) {
    event.preventDefault();
    const prev = inputs[index - 1];
    prev.value = "";
    prev.focus();
    return;
  }
  if (event.key === "ArrowLeft" && index > 0) {
    event.preventDefault();
    focusSlot(index - 1);
    return;
  }
  if (event.key === "ArrowRight" && index < inputs.length - 1) {
    event.preventDefault();
    focusSlot(index + 1);
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    submitAnswer().catch((error) => updateSetupStatus(`提交失败：${error.message}`));
  }
}

function handleSlotPaste(event) {
  event.preventDefault();
  const text = (event.clipboardData?.getData("text") || "").replace(/[^a-zA-Z]/g, "");
  if (!text) return;

  const inputs = getSlotInputs();
  const startIndex = Number(event.target.dataset.index || "0");
  [...text].forEach((char, offset) => {
    const target = inputs[startIndex + offset];
    if (target) target.value = char;
  });
  focusSlot(Math.min(startIndex + text.length, inputs.length - 1));
}

function renderSpellingSlots(term) {
  const chars = [...term];
  state.currentSlotChars = chars;
  let editableIndex = -1;
  const slotsHtml = [
    `<span class="slot-fixed">${escapeHtml(chars[0] || "")}</span>`,
    ...chars.slice(1).map(
      (char, index) =>
        char === " "
          ? `<span class="slot-gap" aria-hidden="true"></span>`
          : (() => {
              editableIndex += 1;
              return `<input class="slot-input" data-index="${editableIndex}" maxlength="1" inputmode="text" autocapitalize="off" autocomplete="off" spellcheck="false" aria-label="第 ${index + 2} 个字符" />`;
            })(),
    ),
  ].join("");

  elements.spellingSlots.innerHTML = slotsHtml;
  getSlotInputs().forEach((input) => {
    input.addEventListener("input", handleSlotInput);
    input.addEventListener("keydown", handleSlotKeydown);
    input.addEventListener("paste", handleSlotPaste);
  });
  focusSlot(0);
}

function renderExpansions(expansions) {
  const items = Array.isArray(expansions) ? expansions.filter(Boolean) : [];
  elements.expansionsList.innerHTML = items.map((item) => `<span class="expansion-chip">${escapeHtml(item)}</span>`).join("");
}

function formatHistory(entry) {
  const history = getReviewHistory(entry);
  const latest = history.slice(-3).map((item) => `${item.result === "correct" ? "答对" : "答错"}：${item.user_answer}`).join("；");
  return `累计答对 ${getCorrectCount(entry)} 次，答错 ${getIncorrectCount(entry)} 次。${latest ? `最近记录：${latest}` : "还没有历史记录。"} `;
}

function renderResult() {
  const { correct, entry, movedToMastered, userAnswer } = state.lastResult;
  setReviewMode(true);
  showElement(elements.quizPanel, false);
  showElement(elements.resultPanel, true);
  window.scrollTo({ top: 0, behavior: "instant" });
  if (elements.resultModal) elements.resultModal.scrollTop = 0;
  elements.resultTitle.textContent = correct ? "回答正确" : "回答错误";
  elements.resultTitle.className = correct ? "is-correct" : "is-wrong";
  elements.resultIcon.className = `result-icon ${correct ? "is-correct" : "is-wrong"}`;
  elements.userAnswerBlock.className = `result-block answer-block ${correct ? "answer-correct" : "answer-user"}`;
  elements.resultMessage.textContent = movedToMastered
    ? `该词累计答对达到 ${MASTERED_THRESHOLD} 次，已进入熟词状态。`
    : correct
      ? "拼写正确，结果已同步到在线进度。"
      : "拼写不正确，先看一眼正确拼写和用法。";
  elements.userAnswerText.textContent = userAnswer;
  elements.correctAnswerText.textContent = entry.term;
  elements.analysisText.textContent = entry.analysis || "当前词条还没有解析说明。";
  elements.pronunciationText.textContent = entry.pronunciation || entry.phonetic || "";
  showElement(elements.pronunciationText, Boolean(elements.pronunciationText.textContent));
  renderExpansions(entry.expansions);
  elements.historyText.textContent = formatHistory(entry);
  elements.nextButton.textContent = state.currentIndex + 1 >= state.queue.length ? "完成" : "下一题";
  requestAnimationFrame(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    if (elements.resultModal) elements.resultModal.scrollTop = 0;
  });
  elements.nextButton.focus();
}

async function persistResult(correct, typedTail) {
  const entry = state.words.find((item) => item.term === state.currentItem.term);
  const prev = getProgress(entry);
  const next = {
    correct_count: Number(prev.correct_count || 0),
    incorrect_count: Number(prev.incorrect_count || 0),
    review_history: [...getReviewHistory(entry)],
  };

  if (correct) next.correct_count += 1;
  else next.incorrect_count += 1;

  next.review_history.push({
    answered_at: nowIso(),
    result: correct ? "correct" : "incorrect",
    user_answer: buildUserAnswer(entry, typedTail),
    mode: "spelling",
    session_id: state.currentSessionId || createSessionId(),
    session_started_at: state.currentSessionStartedAt || nowIso(),
  });

  const payload = {
    profile_id: getProfileId(),
    term: entry.term,
    correct_count: next.correct_count,
    incorrect_count: next.incorrect_count,
    review_history: next.review_history,
    updated_at: new Date().toISOString(),
  };

  const { error } = await state.supabase
    .from(REVIEW_PROGRESS_TABLE)
    .upsert(payload, { onConflict: "profile_id,term" });

  if (error) throw error;

  state.progressByTerm[entry.term] = next;
  updateHomeStats();
  state.lastResult = {
    correct,
    entry,
    movedToMastered: Number(prev.correct_count || 0) < MASTERED_THRESHOLD && next.correct_count >= MASTERED_THRESHOLD,
    userAnswer: buildUserAnswer(entry, typedTail),
  };
}

async function submitAnswer() {
  if (!state.currentItem) return;
  const typedTail = getTypedTailFromSlots();
  const correct = isCorrect(state.currentItem, typedTail);
  await persistResult(correct, typedTail);
  renderResult();
}

function nextQuestion() {
  state.currentIndex += 1;
  if (state.currentIndex >= state.queue.length) {
    exitToHome();
    updateSetupStatus(`本轮复习结束。当前待复习 ${getReviewableWords().length} 个，熟词 ${getMasteredWords().length} 个。`);
    return;
  }
  renderQuestion();
}

function openWordsPage() {
  window.location.href = "./words.html";
}

function openDictionaryPage() {
  window.location.href = "./dictionary.html";
}

elements.startButton.addEventListener("click", () => {
  startReview().catch((error) => updateSetupStatus(`开始复习失败：${error.message}`));
});
elements.submitButton.addEventListener("click", () => {
  submitAnswer().catch((error) => updateSetupStatus(`提交失败：${error.message}`));
});
elements.nextButton.addEventListener("click", nextQuestion);
elements.restartButton.addEventListener("click", () => {
  startReview().catch((error) => updateSetupStatus(`重新开始失败：${error.message}`));
});
elements.exitButton.addEventListener("click", exitToHome);
elements.wordsButton?.addEventListener("click", openWordsPage);
elements.dictionaryButton?.addEventListener("click", openDictionaryPage);
elements.profileIdToggle?.addEventListener("click", () => {
  if (elements.profileIdSuggestions.classList.contains("hidden")) openProfileSuggestions(true);
  else closeProfileSuggestions();
});
elements.profileIdInput?.addEventListener("focus", () => {
  openProfileSuggestions(false);
});
elements.profileIdInput?.addEventListener("input", () => {
  openProfileSuggestions(false);
});
elements.profileIdInput?.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeProfileSuggestions();
  if (event.key === "ArrowDown") {
    event.preventDefault();
    openProfileSuggestions(true);
  }
});
elements.profileIdInput?.addEventListener("blur", () => {
  window.setTimeout(() => {
    closeProfileSuggestions();
  }, 120);
});
elements.historyToggleButton?.addEventListener("click", () => {
  toggleHistoryOverview().catch((error) => {
    renderHistoryOverview(`历史记录读取失败：${error.message}`);
  });
});
elements.profileIdInput.addEventListener("change", async () => {
  saveProfileId();
  try {
    await loadProgress();
    updateHomeStats();
    if (state.historyVisible) renderHistoryOverview();
    updateSetupStatus(`已切换同步标识。当前待复习 ${getReviewableWords().length} 个，熟词 ${getMasteredWords().length} 个。`);
  } catch (error) {
    updateSyncStatus(`同步读取失败：${error.message}`, "bad");
  }
});
elements.actionRows.forEach((row) => row.addEventListener("keydown", handleActionRowKeydown));
document.addEventListener("pointerdown", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest(".suggest-input-wrap")) return;
  closeProfileSuggestions();
});

hydrateProfileId();
bootData().catch((error) => {
  updateSetupStatus(`初始化失败：${error.message}`);
  updateSyncStatus("请检查 words.json 地址或 Supabase 配置。", "bad");
});
