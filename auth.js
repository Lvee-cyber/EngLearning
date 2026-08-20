(function attachEngLearningAuth(windowObject) {
  const TOKEN_KEY = "englearning.auth_token";
  const USER_KEY = "englearning.auth_user";
  const PROFILE_KEY = "englearning.profile_id";
  let client = null;
  let currentUser = null;

  function getClient() {
    if (!client) client = windowObject.ContentStore?.createSupabaseClient?.() || null;
    return client;
  }

  function getToken() {
    return String(windowObject.localStorage.getItem(TOKEN_KEY) || "").trim();
  }

  function readCachedUser() {
    try {
      return JSON.parse(windowObject.localStorage.getItem(USER_KEY) || "null");
    } catch {
      return null;
    }
  }

  function saveSession(token, user) {
    currentUser = user || null;
    if (token) windowObject.localStorage.setItem(TOKEN_KEY, token);
    if (user) {
      windowObject.localStorage.setItem(USER_KEY, JSON.stringify(user));
      windowObject.localStorage.setItem(PROFILE_KEY, user.username || "");
    }
  }

  function clearSession() {
    const username = currentUser?.username || readCachedUser()?.username || "";
    windowObject.localStorage.removeItem(TOKEN_KEY);
    windowObject.localStorage.removeItem(USER_KEY);
    windowObject.localStorage.removeItem(PROFILE_KEY);
    if (username) windowObject.localStorage.removeItem(`englearning.progress.${username}`);
    currentUser = null;
  }

  async function call(name, params = {}) {
    const supabase = getClient();
    if (!supabase) throw new Error("当前未配置在线服务。");
    const response = await supabase.rpc(name, params);
    if (response.error) throw new Error(response.error.message || "请求失败");
    return response.data;
  }

  async function login(username, password) {
    const result = await call("login_app_user", {
      p_username: String(username || "").trim(),
      p_password: String(password || ""),
    });
    saveSession(result?.token, result?.user);
    return result?.user || null;
  }

  async function register(username, password) {
    return call("register_app_user", {
      p_username: String(username || "").trim(),
      p_password: String(password || ""),
    });
  }

  async function refreshUser() {
    const token = getToken();
    if (!token) return null;
    try {
      const user = await call("get_app_session", { p_token: token });
      saveSession(token, user);
      return user;
    } catch (error) {
      clearSession();
      throw error;
    }
  }

  function redirectToLogin() {
    const page = windowObject.location.pathname.split("/").pop() || "index.html";
    const next = encodeURIComponent(`${page}${windowObject.location.search || ""}`);
    windowObject.location.replace(`./login.html?next=${next}`);
  }

  async function requireActive(options = {}) {
    if (!getToken()) {
      redirectToLogin();
      return null;
    }
    let user;
    try {
      user = await refreshUser();
    } catch {
      redirectToLogin();
      return null;
    }
    if (!user) {
      redirectToLogin();
      return null;
    }
    if (user.status !== "active" && !options.allowPending) {
      windowObject.location.replace("./account.html");
      return null;
    }
    if (options.admin && user.role !== "admin") {
      windowObject.location.replace("./index.html");
      return null;
    }
    document.documentElement.classList.add("auth-ready");
    return user;
  }

  async function logout() {
    const token = getToken();
    try {
      if (token) await call("logout_app_user", { p_token: token });
    } catch {}
    clearSession();
    windowObject.location.replace("./login.html");
  }

  function tokenParams(extra = {}) {
    return { p_token: getToken(), ...extra };
  }

  currentUser = readCachedUser();
  windowObject.EngLearningAuth = {
    call,
    clearSession,
    getClient,
    getCurrentUser: () => currentUser || readCachedUser(),
    getToken,
    login,
    logout,
    refreshUser,
    register,
    requireActive,
    tokenParams,
  };
})(window);
