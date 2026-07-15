(function attachContentStore(windowObject) {
  const APP_CONFIG = windowObject.APP_CONFIG || {};
  const PAGE_SIZE = 1000;
  const CACHE_PREFIX = "englearning.content.";
  const TERM_CACHE_PREFIX = "englearning.term.";
  const CACHE_TTL_MS = Number(APP_CONFIG.contentCacheTtlMs || 3 * 60 * 1000);
  const LOCAL_CACHE_TTL_MS = Number(APP_CONFIG.localContentCacheTtlMs || 24 * 60 * 60 * 1000);
  const memoryCache = new Map();
  const jsonMemoryCache = new Map();
  const jsonPromiseCache = new Map();

  function createSupabaseClient() {
    if (!APP_CONFIG.supabaseUrl || !APP_CONFIG.supabaseAnonKey) return null;
    if (!windowObject.supabase?.createClient) return null;
    return windowObject.supabase.createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseAnonKey, {
      auth: { persistSession: false },
    });
  }

  async function fetchJson(url, label, options = {}) {
    const cacheKey = String(url || "");
    if (options.memoryCache && jsonMemoryCache.has(cacheKey)) return jsonMemoryCache.get(cacheKey);
    if (options.memoryCache && jsonPromiseCache.has(cacheKey)) return jsonPromiseCache.get(cacheKey);

    const promise = fetch(url, { cache: "no-store" }).then((response) => {
      if (!response.ok) throw new Error(`${label}读取失败：${response.status}`);
      return response.json();
    });

    if (!options.memoryCache) return promise;

    jsonPromiseCache.set(cacheKey, promise);
    try {
      const data = await promise;
      jsonMemoryCache.set(cacheKey, data);
      return data;
    } finally {
      jsonPromiseCache.delete(cacheKey);
    }
  }

  function buildCacheKey({ tableName, fallbackUrl, label }) {
    return `${CACHE_PREFIX}${tableName || fallbackUrl || label}`;
  }

  function readStorageCache(storage, key) {
    try {
      const raw = storage?.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function writeStorageCache(storage, key, payload, label) {
    try {
      storage?.setItem(key, JSON.stringify(payload));
    } catch (error) {
      console.warn(`[ContentStore] ${label}缓存写入失败。`, error?.message || error);
    }
  }

  function removeStorageCache(storage, key) {
    try {
      storage?.removeItem(key);
    } catch {}
  }

  function getFreshCache(key, ttl = CACHE_TTL_MS) {
    const cached = memoryCache.get(key) || readStorageCache(windowObject.sessionStorage, key) || readStorageCache(windowObject.localStorage, key);
    if (!cached) return null;
    if (Date.now() - Number(cached.cachedAt || 0) > ttl) {
      memoryCache.delete(key);
      removeStorageCache(windowObject.sessionStorage, key);
      removeStorageCache(windowObject.localStorage, key);
      return null;
    }
    memoryCache.set(key, cached);
    return cached;
  }

  function saveCache(key, value) {
    const payload = {
      ...value,
      cachedAt: Date.now(),
    };
    memoryCache.set(key, payload);
    writeStorageCache(windowObject.sessionStorage, key, payload, "会话");
    writeStorageCache(windowObject.localStorage, key, payload, "本地");
    return payload;
  }

  function buildTermCacheKey({ tableName, term }) {
    return `${TERM_CACHE_PREFIX}${tableName || "local"}.${String(term || "").trim().toLowerCase()}`;
  }

  function getPrefixToken(value) {
    const first = String(value || "").trim().toLowerCase().match(/[a-z]/)?.[0];
    return first || "";
  }

  function getDetailToken(value) {
    const normalized = String(value || "").trim().toLowerCase().replace(/^[^a-z]+/, "");
    const token = normalized.match(/^[a-z]{1,2}/)?.[0] || "";
    return token || getPrefixToken(value);
  }

  function getSuggestToken(value) {
    const normalized = String(value || "").trim().toLowerCase().replace(/^[^a-z]+/, "");
    if (normalized.length >= 2) return normalized.match(/^[a-z]{2}/)?.[0] || getPrefixToken(value);
    return getPrefixToken(value);
  }

  function isDictionaryCollection({ tableName, fallbackUrl }) {
    return (
      Boolean(APP_CONFIG.dictionaryPrefixUrl) &&
      (String(tableName || "") === String(APP_CONFIG.dictionaryTable || "dictionary_entries") ||
        String(fallbackUrl || "") === String(APP_CONFIG.dictionaryUrl || "./data/dictionary.json"))
    );
  }

  function buildDictionaryUrl(templateKey, token, context = {}) {
    const template = APP_CONFIG[templateKey];
    if (!template || !token || !isDictionaryCollection(context)) return "";
    return String(template).replace("{prefix}", encodeURIComponent(token));
  }

  function buildPrefixUrl(prefix, context = {}) {
    const template = APP_CONFIG.dictionaryPrefixUrl;
    if (!template || !prefix || !isDictionaryCollection(context)) return "";
    return String(template).replace("{prefix}", encodeURIComponent(prefix));
  }

  function getEntryTerm(entry) {
    return String(entry?.term || entry?.word || entry?.headword || "").trim();
  }

  function pickPrefixItems(items, query, limit) {
    const lower = String(query || "").trim().toLowerCase();
    if (!lower) return [];
    return (items || [])
      .filter((entry) => getEntryTerm(entry).toLowerCase().startsWith(lower))
      .sort((a, b) => getEntryTerm(a).localeCompare(getEntryTerm(b)))
      .slice(0, limit);
  }

  function mergePrefixItems(groups, query, limit) {
    const merged = [];
    const seen = new Set();
    groups.forEach((items) => {
      pickPrefixItems(items, query, limit).forEach((entry) => {
        const term = getEntryTerm(entry).toLowerCase();
        if (!term || seen.has(term)) return;
        seen.add(term);
        merged.push(entry);
      });
    });
    return merged.sort((a, b) => getEntryTerm(a).localeCompare(getEntryTerm(b))).slice(0, limit);
  }

  async function fetchCollection({ supabase, tableName, fallbackUrl, label }) {
    const cacheKey = buildCacheKey({ tableName, fallbackUrl, label });
    const cached = getFreshCache(cacheKey);
    if (cached) {
      return {
        items: cached.items,
        source: cached.source,
        cached: true,
      };
    }

    if (supabase && tableName) {
      const items = [];
      let offset = 0;
      let error = null;

      while (true) {
        const response = await supabase
          .from(tableName)
          .select("term, payload")
          .order("term")
          .range(offset, offset + PAGE_SIZE - 1);

        if (response.error) {
          error = response.error;
          break;
        }

        const batch = Array.isArray(response.data) ? response.data : [];
        items.push(...batch);
        if (batch.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }

      if (!error && items.length) {
        return saveCache(cacheKey, {
          items: items.map((item) => item.payload).filter((item) => item && typeof item === "object"),
          source: "supabase",
        });
      }
      if (error) {
        console.warn(`[ContentStore] ${label} Supabase 读取失败，回退到 JSON。`, error.message || error);
      }
    }

    return saveCache(cacheKey, {
      items: await fetchJson(fallbackUrl, label),
      source: "json",
    });
  }

  async function fetchTerm({ supabase, tableName, fallbackUrl, label, term }) {
    const normalizedTerm = String(term || "").trim();
    if (!normalizedTerm) return { item: null, source: "empty", cached: false };

    const termCacheKey = buildTermCacheKey({ tableName, term: normalizedTerm });
    const cachedTerm = getFreshCache(termCacheKey, LOCAL_CACHE_TTL_MS);
    if (cachedTerm) {
      if (cachedTerm.item || !isDictionaryCollection({ tableName, fallbackUrl })) {
        return {
          item: cachedTerm.item || null,
          source: cachedTerm.source,
          cached: true,
        };
      }
    }

    const detailUrl = buildDictionaryUrl("dictionaryDetailUrl", getDetailToken(normalizedTerm), { tableName, fallbackUrl });
    if (detailUrl) {
      const localDetail = await fetchJson(detailUrl, label, { memoryCache: true }).catch(() => null);
      if (Array.isArray(localDetail)) {
        const item = localDetail.find((entry) => getEntryTerm(entry).toLowerCase() === normalizedTerm.toLowerCase()) || null;
        if (item) return saveCache(termCacheKey, { item, source: "json-detail" });
      }
    }

    if (supabase && tableName) {
      const response = await supabase.from(tableName).select("term, payload").eq("term", normalizedTerm).maybeSingle();
      if (!response.error && response.data?.payload) {
        return saveCache(termCacheKey, {
          item: response.data.payload,
          source: "supabase",
        });
      }
      if (!response.error) {
        return saveCache(termCacheKey, {
          item: null,
          source: "supabase",
        });
      }
      if (response.error) {
        console.warn(`[ContentStore] ${label} 单词查询失败。`, response.error.message || response.error);
      }
    }

    const prefixUrl = buildPrefixUrl(getPrefixToken(normalizedTerm), { tableName, fallbackUrl });
    if (prefixUrl) {
      const localPrefix = await fetchJson(prefixUrl, label).catch(() => null);
      if (Array.isArray(localPrefix)) {
        const item = localPrefix.find((entry) => getEntryTerm(entry).toLowerCase() === normalizedTerm.toLowerCase()) || null;
        if (item) return saveCache(termCacheKey, { item, source: "json-prefix" });
        return saveCache(termCacheKey, { item: null, source: "json-prefix" });
      }
    }

    if (isDictionaryCollection({ tableName, fallbackUrl })) {
      return saveCache(termCacheKey, { item: null, source: "dictionary-shards" });
    }

    const { items, source } = await fetchCollection({ supabase: null, tableName: "", fallbackUrl, label });
    const item = items.find((entry) => String(entry?.term || entry?.word || entry?.headword || "").trim().toLowerCase() === normalizedTerm.toLowerCase()) || null;
    return saveCache(termCacheKey, { item, source });
  }

  async function fetchPrefix({ supabase, tableName, fallbackUrl, label, query, limit = 8 }) {
    const normalizedQuery = String(query || "").trim();
    if (!normalizedQuery) return { items: [], source: "empty", cached: false };

    const suggestUrl = buildDictionaryUrl("dictionarySuggestUrl", getSuggestToken(normalizedQuery), { tableName, fallbackUrl });
    const localSuggest = suggestUrl ? await fetchJson(suggestUrl, label).catch(() => null) : null;
    if (Array.isArray(localSuggest)) {
      const items = pickPrefixItems(localSuggest, normalizedQuery, limit);
      if (items.length) return { items, source: "json-suggest", cached: false };
    }

    let supabaseItems = [];
    if (supabase && tableName) {
      const response = await supabase
        .from(tableName)
        .select("term, payload")
        .ilike("term", `${normalizedQuery.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`)
        .order("term")
        .limit(limit);
      if (!response.error) {
        supabaseItems = (response.data || []).map((item) => item.payload).filter((item) => item && typeof item === "object");
        if (supabaseItems.length >= limit) {
          return { items: supabaseItems, source: "supabase", cached: false };
        }
      } else {
        console.warn(`[ContentStore] ${label} 前缀查询失败。`, response.error.message || response.error);
      }
    }

    const prefixUrl = buildPrefixUrl(getPrefixToken(normalizedQuery), { tableName, fallbackUrl });
    const localPrefix = prefixUrl ? await fetchJson(prefixUrl, label).catch(() => null) : null;
    if (Array.isArray(localPrefix)) {
      return {
        items: mergePrefixItems([supabaseItems, localPrefix], normalizedQuery, limit),
        source: supabaseItems.length ? "supabase+json-prefix" : "json-prefix",
        cached: false,
      };
    }

    return { items: supabaseItems, source: supabaseItems.length ? "supabase" : "empty", cached: false };
  }

  function peekCollectionCache({ supabase, tableName, fallbackUrl, label }) {
    const cacheKey = buildCacheKey({ tableName, fallbackUrl, label });
    const cached = getFreshCache(cacheKey);
    if (!cached) return null;
    return {
      items: cached.items,
      source: cached.source,
      cached: true,
      hasSupabase: Boolean(supabase && tableName),
    };
  }

  const PROFILE_ID_KEY = "englearning.profile_id";
  const PROFILE_IDS_KEY = "englearning.profile_ids";

  function normalizeProfileId(value) {
    return String(value || "").trim();
  }

  function getRememberedProfileIds() {
    let remembered = [];
    try {
      const parsed = JSON.parse(windowObject.localStorage.getItem(PROFILE_IDS_KEY) || "[]");
      remembered = Array.isArray(parsed) ? parsed : [];
    } catch {}
    const current = normalizeProfileId(windowObject.localStorage.getItem(PROFILE_ID_KEY));
    return [...new Set([current, ...remembered].map(normalizeProfileId).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }

  function rememberProfileId(value) {
    const profileId = normalizeProfileId(value);
    windowObject.localStorage.setItem(PROFILE_ID_KEY, profileId);
    if (!profileId) return getRememberedProfileIds();
    const profileIds = [...new Set([...getRememberedProfileIds(), profileId])].sort((a, b) => a.localeCompare(b));
    windowObject.localStorage.setItem(PROFILE_IDS_KEY, JSON.stringify(profileIds));
    return profileIds;
  }

  async function listProfileIds(supabase) {
    const localIds = getRememberedProfileIds();
    if (!supabase) return { profileIds: localIds, online: false, error: null };
    const response = await supabase.rpc("list_profile_ids");
    let remoteIds = [];
    let mode = "rpc";
    if (!response.error) {
      remoteIds = (response.data || []).map((item) => normalizeProfileId(item?.profile_id)).filter(Boolean);
    } else {
      mode = "legacy";
      const pageSize = 1000;
      for (let offset = 0; ; offset += pageSize) {
        const legacyResponse = await supabase
          .from("review_progress")
          .select("profile_id")
          .order("profile_id")
          .range(offset, offset + pageSize - 1);
        if (legacyResponse.error) return { profileIds: localIds, online: false, error: response.error };
        const rows = legacyResponse.data || [];
        remoteIds.push(...rows.map((item) => normalizeProfileId(item?.profile_id)).filter(Boolean));
        if (rows.length < pageSize) break;
      }
    }
    const profileIds = [...new Set([...localIds, ...remoteIds])].sort((a, b) => a.localeCompare(b));
    try {
      windowObject.localStorage.setItem(PROFILE_IDS_KEY, JSON.stringify(profileIds));
    } catch {}
    return { profileIds, online: true, mode, error: null };
  }

  async function fetchReviewProgress(supabase, profileId) {
    const normalizedProfileId = normalizeProfileId(profileId);
    if (!supabase || !normalizedProfileId) return { data: [], error: null, mode: "local" };
    const response = await supabase.rpc("get_review_progress", { p_profile_id: normalizedProfileId });
    if (!response.error) return { data: response.data || [], error: null, mode: "rpc" };
    const legacyResponse = await supabase
      .from("review_progress")
      .select("term, correct_count, incorrect_count, review_history, updated_at")
      .eq("profile_id", normalizedProfileId)
      .order("term");
    if (!legacyResponse.error) return { data: legacyResponse.data || [], error: null, mode: "legacy" };
    return { data: [], error: response.error, mode: "offline" };
  }

  function renderProfileOptions(datalist, profileIds) {
    if (!datalist) return;
    datalist.replaceChildren(
      ...(profileIds || []).map((profileId) => {
        const option = document.createElement("option");
        option.value = profileId;
        return option;
      }),
    );
  }

  windowObject.ContentStore = {
    createSupabaseClient,
    fetchCollection,
    fetchTerm,
    fetchPrefix,
    peekCollectionCache,
    getRememberedProfileIds,
    rememberProfileId,
    listProfileIds,
    fetchReviewProgress,
    renderProfileOptions,
  };
})(window);

if ("serviceWorker" in navigator && /^https?:$/.test(window.location.protocol)) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("[EngLearning] 离线服务注册失败。", error?.message || error);
    });
  });
}
