(function attachContentStore(windowObject) {
  const APP_CONFIG = windowObject.APP_CONFIG || {};
  const PAGE_SIZE = 1000;
  const CACHE_PREFIX = "englearning.content.";
  const CACHE_TTL_MS = Number(APP_CONFIG.contentCacheTtlMs || 3 * 60 * 1000);
  const memoryCache = new Map();

  function createSupabaseClient() {
    if (!APP_CONFIG.supabaseUrl || !APP_CONFIG.supabaseAnonKey) return null;
    if (!windowObject.supabase?.createClient) return null;
    return windowObject.supabase.createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseAnonKey, {
      auth: { persistSession: false },
    });
  }

  async function fetchJson(url, label) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`${label}读取失败：${response.status}`);
    return response.json();
  }

  function buildCacheKey({ tableName, fallbackUrl, label }) {
    return `${CACHE_PREFIX}${tableName || fallbackUrl || label}`;
  }

  function readSessionCache(key) {
    try {
      const raw = windowObject.sessionStorage?.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function writeSessionCache(key, payload) {
    try {
      windowObject.sessionStorage?.setItem(key, JSON.stringify(payload));
    } catch (error) {
      console.warn("[ContentStore] 会话缓存写入失败。", error?.message || error);
    }
  }

  function getFreshCache(key) {
    const cached = memoryCache.get(key) || readSessionCache(key);
    if (!cached) return null;
    if (Date.now() - Number(cached.cachedAt || 0) > CACHE_TTL_MS) {
      memoryCache.delete(key);
      try {
        windowObject.sessionStorage?.removeItem(key);
      } catch {}
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
    writeSessionCache(key, payload);
    return payload;
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

  windowObject.ContentStore = {
    createSupabaseClient,
    fetchCollection,
  };
})(window);
