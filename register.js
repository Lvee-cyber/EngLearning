const form = document.querySelector("#register-form");
const usernameInput = document.querySelector("#register-username");
const passwordInput = document.querySelector("#register-password");
const confirmInput = document.querySelector("#register-confirm");
const submitButton = document.querySelector("#register-submit");
const statusText = document.querySelector("#register-status");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (passwordInput.value !== confirmInput.value) {
    statusText.textContent = "两次输入的密码不一致。";
    confirmInput.select();
    return;
  }
  submitButton.disabled = true;
  statusText.textContent = "正在提交申请…";
  try {
    await window.EngLearningAuth.register(usernameInput.value, passwordInput.value);
    form.reset();
    statusText.innerHTML = '申请已提交，请等待 LvE 审批。审批后可从<a href="./login.html">登录页</a>进入。';
  } catch (error) {
    statusText.textContent = error.message || "提交失败，请稍后再试。";
  } finally {
    submitButton.disabled = false;
  }
});
