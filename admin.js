const state = { users: [], filter: "all", pendingAction: null };
const elements = {
  list: document.querySelector("#admin-users"),
  empty: document.querySelector("#admin-empty"),
  status: document.querySelector("#admin-status"),
  refresh: document.querySelector("#admin-refresh"),
  logout: document.querySelector("#admin-logout"),
  filters: [...document.querySelectorAll(".admin-filter")],
  countAll: document.querySelector("#admin-count-all"),
  countPending: document.querySelector("#admin-count-pending"),
  countActive: document.querySelector("#admin-count-active"),
  countDisabled: document.querySelector("#admin-count-disabled"),
  dialog: document.querySelector("#admin-confirm"),
  dialogTitle: document.querySelector("#admin-confirm-title"),
  dialogCopy: document.querySelector("#admin-confirm-copy"),
  dialogSubmit: document.querySelector("#admin-confirm-submit"),
};

function escapeHtml(value) {
  return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function formatDate(value, fallback = "从未登录") {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString("zh-CN", { hour12: false });
}

function statusLabel(status) {
  return { pending: "待审批", active: "正常", disabled: "已禁用" }[status] || status;
}

function actionButtons(user) {
  if (user.role === "admin") return '<span class="admin-protected">管理员账号</span>';
  const primary =
    user.status === "pending"
      ? '<button class="table-action is-primary" data-action="active">批准</button>'
      : user.status === "disabled"
        ? '<button class="table-action is-primary" data-action="active">恢复</button>'
        : '<button class="table-action" data-action="disabled">禁用</button>';
  return `${primary}<button class="table-action" data-action="reset">重置密码</button><button class="table-action is-danger" data-action="delete">删除</button>`;
}

function render() {
  const visible = state.filter === "all" ? state.users : state.users.filter((user) => user.status === state.filter);
  elements.list.innerHTML = visible
    .map(
      (user) => `<tr data-user-id="${escapeHtml(user.user_id)}" data-username="${escapeHtml(user.username)}">
        <td><strong>${escapeHtml(user.username)}</strong>${user.role === "admin" ? "<small>LvE</small>" : ""}</td>
        <td><span class="user-status" data-status="${escapeHtml(user.status)}">${escapeHtml(statusLabel(user.status))}</span></td>
        <td>${escapeHtml(formatDate(user.created_at, "—"))}</td>
        <td>${escapeHtml(formatDate(user.last_login_at))}</td>
        <td><strong>${Number(user.vocabulary_count || 0)}</strong></td>
        <td><div class="table-actions">${actionButtons(user)}</div></td>
      </tr>`,
    )
    .join("");
  elements.empty.classList.toggle("hidden", visible.length > 0);
  elements.countAll.textContent = String(state.users.length);
  ["pending", "active", "disabled"].forEach((status) => {
    const target = elements[`count${status[0].toUpperCase()}${status.slice(1)}`];
    if (target) target.textContent = String(state.users.filter((user) => user.status === status).length);
  });
}

async function loadUsers() {
  elements.refresh.disabled = true;
  elements.status.textContent = "正在读取用户列表…";
  try {
    state.users = (await window.EngLearningAuth.call("admin_list_app_users", window.EngLearningAuth.tokenParams())) || [];
    render();
    elements.status.textContent = `共 ${state.users.length} 位用户。`;
  } finally {
    elements.refresh.disabled = false;
  }
}

function askForConfirmation(action, userId, username) {
  const copy = {
    active: [`批准 ${username}`, `批准后，${username} 可以登录并使用全部学习功能。`],
    disabled: [`禁用 ${username}`, `该用户将立即无法继续使用学习功能，但学习数据会保留。`],
    reset: [`重置 ${username} 的密码`, "重置后密码固定为 123。"],
    delete: [`删除 ${username}`, "账号、生词和全部复习记录都会永久删除。"],
  }[action];
  state.pendingAction = { action, userId, username };
  elements.dialogTitle.textContent = copy[0];
  elements.dialogCopy.textContent = copy[1];
  elements.dialogSubmit.className = action === "delete" ? "danger-button" : "primary-button";
  elements.dialog.showModal();
}

async function runAction({ action, userId, username }) {
  elements.status.textContent = `正在处理 ${username}…`;
  if (action === "reset") {
    await window.EngLearningAuth.call("admin_reset_app_password", window.EngLearningAuth.tokenParams({ p_user_id: userId }));
    elements.status.textContent = `${username} 的密码已重置为 123。`;
  } else if (action === "delete") {
    await window.EngLearningAuth.call("admin_delete_app_user", window.EngLearningAuth.tokenParams({ p_user_id: userId }));
    elements.status.textContent = `${username} 已删除。`;
  } else {
    await window.EngLearningAuth.call("admin_set_app_user_status", window.EngLearningAuth.tokenParams({ p_user_id: userId, p_status: action }));
    elements.status.textContent = action === "active" ? `${username} 已获批准。` : `${username} 已禁用。`;
  }
  await loadUsers();
}

elements.filters.forEach((button) => {
  button.addEventListener("click", () => {
    state.filter = button.dataset.filter || "all";
    elements.filters.forEach((item) => item.classList.toggle("is-active", item === button));
    render();
  });
});
elements.list.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  const row = event.target.closest("[data-user-id]");
  if (!button || !row) return;
  askForConfirmation(button.dataset.action, row.dataset.userId, row.dataset.username);
});
elements.dialog.addEventListener("close", () => {
  const action = state.pendingAction;
  state.pendingAction = null;
  if (elements.dialog.returnValue !== "confirm" || !action) return;
  runAction(action).catch((error) => {
    elements.status.textContent = `操作失败：${error.message}`;
  });
});
elements.refresh.addEventListener("click", () => loadUsers().catch((error) => (elements.status.textContent = `读取失败：${error.message}`)));
elements.logout.addEventListener("click", () => window.EngLearningAuth.logout());

window.EngLearningAuth
  .requireActive({ admin: true })
  .then((user) => user && loadUsers())
  .catch((error) => (elements.status.textContent = `初始化失败：${error.message}`));
