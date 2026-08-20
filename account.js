const elements = {
  username: document.querySelector("#account-username"),
  statusCopy: document.querySelector("#account-status-copy"),
  statusBadge: document.querySelector("#account-status-badge"),
  pending: document.querySelector("#account-pending"),
  dashboard: document.querySelector("#account-dashboard"),
  adminLink: document.querySelector("#account-admin-link"),
  homeLink: document.querySelector("#account-home-link"),
  logout: document.querySelector("#account-logout"),
  error: document.querySelector("#account-error"),
  vocabularyCount: document.querySelector("#account-vocabulary-count"),
  masteredCount: document.querySelector("#account-mastered-count"),
  reviewableCount: document.querySelector("#account-reviewable-count"),
  reviewCount: document.querySelector("#account-review-count"),
  correctCount: document.querySelector("#account-correct-count"),
  incorrectCount: document.querySelector("#account-incorrect-count"),
  accuracy: document.querySelector("#account-accuracy"),
  lastReview: document.querySelector("#account-last-review"),
  createdAt: document.querySelector("#account-created-at"),
  lastLogin: document.querySelector("#account-last-login"),
  role: document.querySelector("#account-role"),
};

function formatDate(value, fallback = "暂无记录") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString("zh-CN", { hour12: false });
}

async function init() {
  const user = await window.EngLearningAuth.requireActive({ allowPending: true });
  if (!user) return;
  elements.username.textContent = user.username;
  elements.createdAt.textContent = formatDate(user.created_at);
  elements.lastLogin.textContent = formatDate(user.last_login_at, "首次登录");
  elements.role.textContent = user.role === "admin" ? "管理员" : "普通用户";
  elements.adminLink.classList.toggle("hidden", user.role !== "admin");

  if (user.status !== "active") {
    elements.statusBadge.textContent = user.status === "pending" ? "待审批" : "已禁用";
    elements.statusBadge.dataset.status = user.status;
    elements.statusCopy.textContent = user.status === "pending" ? "账号正在等待 LvE 审批。" : "账号目前不可使用，请联系 LvE。";
    elements.pending.classList.remove("hidden");
    elements.homeLink.classList.add("hidden");
    return;
  }

  elements.statusBadge.textContent = "正常";
  elements.statusBadge.dataset.status = "active";
  elements.statusCopy.textContent = "这里汇总你的词库与复习进度。";
  const stats = await window.EngLearningAuth.call("get_my_dashboard", window.EngLearningAuth.tokenParams());
  const total = Number(stats?.review_count || 0);
  const correct = Number(stats?.correct_count || 0);
  elements.vocabularyCount.textContent = String(stats?.vocabulary_count || 0);
  elements.masteredCount.textContent = String(stats?.mastered_count || 0);
  elements.reviewableCount.textContent = String(stats?.reviewable_count || 0);
  elements.reviewCount.textContent = String(total);
  elements.correctCount.textContent = String(correct);
  elements.incorrectCount.textContent = String(stats?.incorrect_count || 0);
  elements.accuracy.textContent = total ? `${Math.round((correct / total) * 100)}%` : "—";
  elements.lastReview.textContent = formatDate(stats?.last_review_at);
  elements.dashboard.classList.remove("hidden");
}

elements.logout.addEventListener("click", () => window.EngLearningAuth.logout());
init().catch((error) => {
  elements.error.textContent = `个人信息读取失败：${error.message}`;
});
