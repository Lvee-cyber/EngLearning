(function attachContentStore(windowObject) {
  const APP_CONFIG = windowObject.APP_CONFIG || {};
  const PAGE_SIZE = 1000;

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

  async function fetchCollection({ supabase, tableName, fallbackUrl, label }) {
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
        return {
          items: items.map((item) => item.payload).filter((item) => item && typeof item === "object"),
          source: "supabase",
        };
      }
      if (error) {
        console.warn(`[ContentStore] ${label} Supabase 读取失败，回退到 JSON。`, error.message || error);
      }
    }

    return {
      items: await fetchJson(fallbackUrl, label),
      source: "json",
    };
  }

  windowObject.ContentStore = {
    createSupabaseClient,
    fetchCollection,
  };
})(window);
