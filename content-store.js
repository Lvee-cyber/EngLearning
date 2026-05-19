(function attachContentStore(windowObject) {
  const APP_CONFIG = windowObject.APP_CONFIG || {};
  const PAGE_SIZE = 1000;
  const CACHE_PREFIX = "englearning.content.";
  const TERM_CACHE_PREFIX = "englearning.term.";
  const CACHE_TTL_MS = Number(APP_CONFIG.contentCacheTtlMs || 3 * 60 * 1000);
  const LOCAL_CACHE_TTL_MS = Number(APP_CONFIG.localContentCacheTtlMs || 24 * 60 * 60 * 1000);
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

    const collectionCache = peekCollectionCache({ supabase, tableName, fallbackUrl, label });
    if (collectionCache?.items) {
      const item = collectionCache.items.find((entry) => String(entry?.term || entry?.word || entry?.headword || "").trim().toLowerCase() === normalizedTerm.toLowerCase());
      if (item) return { item, source: collectionCache.source, cached: true };
    }

    const termCacheKey = buildTermCacheKey({ tableName, term: normalizedTerm });
    const cachedTerm = getFreshCache(termCacheKey, LOCAL_CACHE_TTL_MS);
    if (cachedTerm) {
      return {
        item: cachedTerm.item || null,
        source: cachedTerm.source,
        cached: true,
      };
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

    const { items, source } = await fetchCollection({ supabase: null, tableName: "", fallbackUrl, label });
    const item = items.find((entry) => String(entry?.term || entry?.word || entry?.headword || "").trim().toLowerCase() === normalizedTerm.toLowerCase()) || null;
    return saveCache(termCacheKey, { item, source });
  }

  async function fetchPrefix({ supabase, tableName, fallbackUrl, label, query, limit = 8 }) {
    const normalizedQuery = String(query || "").trim();
    if (!normalizedQuery) return { items: [], source: "empty", cached: false };

    const collectionCache = peekCollectionCache({ supabase, tableName, fallbackUrl, label });
    if (collectionCache?.items) {
      const lower = normalizedQuery.toLowerCase();
      return {
        items: collectionCache.items
          .filter((entry) => String(entry?.term || entry?.word || entry?.headword || "").trim().toLowerCase().startsWith(lower))
          .slice(0, limit),
        source: collectionCache.source,
        cached: true,
      };
    }

    if (supabase && tableName) {
      const response = await supabase
        .from(tableName)
        .select("term, payload")
        .ilike("term", `${normalizedQuery.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`)
        .order("term")
        .limit(limit);
      if (!response.error) {
        return {
          items: (response.data || []).map((item) => item.payload).filter((item) => item && typeof item === "object"),
          source: "supabase",
          cached: false,
        };
      }
      console.warn(`[ContentStore] ${label} 前缀查询失败。`, response.error.message || response.error);
    }

    return { items: [], source: "empty", cached: false };
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

  windowObject.ContentStore = {
    createSupabaseClient,
    fetchCollection,
    fetchTerm,
    fetchPrefix,
    peekCollectionCache,
  };
})(window);
