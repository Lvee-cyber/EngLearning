const APP_CONFIG = window.APP_CONFIG || {};
const STORAGE_KEYS = {
  profileId: "englearning.profile_id",
};
const MASTERED_THRESHOLD = Number(APP_CONFIG.masteredThreshold || 10);

const state = {
  words: [],
  progressByTerm: {},
  queue: [],
  currentIndex: 0,
  currentItem: null,
  lastResult: null,
  supabase: null,
  syncReady: false,
};

const elements = {
  homeView: document.querySelector("#home-view"),
  startButton: document.querySelector("#start-button"),
  submitButton: document.querySelector("#submit-button"),
  nextButton: document.querySelector("#next-button"),
  restartButton: document.querySelector("#restart-button"),
  exitButton: document.querySelector("#exit-button"),
  wordsButton: document.querySelector("#words-button"),
  reviewCount: document.querySelector("#review-count"),
  profileIdInput: document.querySelector("#profile-id"),
  setupStatus: document.querySelector("#setup-status"),
  syncStatus: document.querySelector("#sync-status"),
  newWordsCount: document.querySelector("#new-words-count"),
  masteredWordsCount: document.querySelector("#mastered-words-count"),
  calendarWeekday: document.querySelector("#calendar-weekday"),
  calendarDay: document.querySelector("#calendar-day"),
  calendarMonth: document.querySelector("#calendar-month"),
  calendarDateText: document.querySelector("#calendar-date-text"),
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

function createSupabaseClient() {
  if (!APP_CONFIG.supabaseUrl || !APP_CONFIG.supabaseAnonKey) return null;
  if (!window.supabase?.createClient) return null;
  return window.supabase.createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseAnonKey, {
    auth: { persistSession: false },
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

function updateCalendarCard() {
  const now = new Date();
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  elements.calendarWeekday.textContent = weekdays[now.getDay()];
  elements.calendarDay.textContent = String(now.getDate()).padStart(2, "0");
  elements.calendarMonth.textContent = months[now.getMonth()];
  elements.calendarDateText.textContent = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}.${String(now.getDate()).padStart(2, "0")}`;
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
  const response = await fetch(APP_CONFIG.wordsUrl || "./data/words.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`词库读取失败：${response.status}`);
  const words = await response.json();
  if (!Array.isArray(words)) throw new Error("words.json 格式不正确");
  state.words = words;
}

async function loadProgress() {
  const profileId = getProfileId();
  if (!state.supabase || !profileId) {
    state.syncReady = false;
    updateSyncStatus("未启用在线同步。请填写同步标识并配置 Supabase。", "warn");
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

  state.syncReady = true;
  updateSyncStatus(`在线同步已连接：${profileId}`, "ok");
}

async function bootData() {
  state.supabase = createSupabaseClient();
  await fetchWords();
  await loadProgress();
  updateHomeStats();
  updateSetupStatus(`已读取词库，共 ${state.words.length} 个词条。当前待复习 ${getReviewableWords().length} 个。`);
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
  return getSlotInputs().map((input) => input.value.trim()).join("");
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
  const slotsHtml = [
    `<span class="slot-fixed">${escapeHtml(chars[0] || "")}</span>`,
    ...chars.slice(1).map(
      (_, index) =>
        `<input class="slot-input" data-index="${index}" maxlength="1" inputmode="text" autocapitalize="off" autocomplete="off" spellcheck="false" aria-label="第 ${index + 2} 个字母" />`,
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
    .from(APP_CONFIG.supabaseTable || "review_progress")
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
elements.profileIdInput.addEventListener("change", async () => {
  saveProfileId();
  try {
    await loadProgress();
    updateHomeStats();
    updateSetupStatus(`已切换同步标识。当前待复习 ${getReviewableWords().length} 个，熟词 ${getMasteredWords().length} 个。`);
  } catch (error) {
    updateSyncStatus(`同步读取失败：${error.message}`, "bad");
  }
});
elements.actionRows.forEach((row) => row.addEventListener("keydown", handleActionRowKeydown));

hydrateProfileId();
updateCalendarCard();
bootData().catch((error) => {
  updateSetupStatus(`初始化失败：${error.message}`);
  updateSyncStatus("请检查 words.json 地址或 Supabase 配置。", "bad");
});
