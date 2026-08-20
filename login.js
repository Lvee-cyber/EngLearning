const form = document.querySelector("#login-form");
const usernameInput = document.querySelector("#login-username");
const passwordInput = document.querySelector("#login-password");
const submitButton = document.querySelector("#login-submit");
const statusText = document.querySelector("#login-status");

function getNextPage(user) {
  if (user?.status !== "active") return "./account.html";
  const requested = new URLSearchParams(window.location.search).get("next") || "";
  if (/^[a-z0-9_.-]+(?:\?.*)?$/i.test(requested) && !requested.startsWith("login") && !requested.startsWith("register")) {
    return `./${requested}`;
  }
  return "./index.html";
}

if (window.EngLearningAuth.getToken()) {
  window.EngLearningAuth
    .refreshUser()
    .then((user) => {
      if (user) window.location.replace(getNextPage(user));
    })
    .catch(() => {});
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submitButton.disabled = true;
  statusText.textContent = "正在登录…";
  try {
    const user = await window.EngLearningAuth.login(usernameInput.value, passwordInput.value);
    statusText.textContent = user?.status === "active" ? "登录成功，正在进入学习空间。" : "登录成功，账号仍在等待审批。";
    window.location.replace(getNextPage(user));
  } catch (error) {
    statusText.textContent = error.message || "登录失败，请检查用户名和密码。";
    passwordInput.select();
  } finally {
    submitButton.disabled = false;
  }
});
