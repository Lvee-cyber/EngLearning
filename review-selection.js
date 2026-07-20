(function attachReviewSelection(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ReviewSelection = api;
})(typeof globalThis !== "undefined" ? globalThis : window, () => {
  const STRATEGIES = Object.freeze({
    RANDOM: "random",
    NEWEST: "newest",
    INCORRECT: "incorrect",
    CONSOLIDATE: "consolidate",
  });

  function normalizeCount(value, maximum) {
    const count = Math.max(0, Math.floor(Number(value) || 0));
    return Math.min(count, maximum);
  }

  function timestamp(value) {
    const parsed = Date.parse(String(value || ""));
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
  }

  function sample(items, count, random) {
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled.slice(0, count);
  }

  function selectReviewItems(items, requestedCount, strategy = STRATEGIES.RANDOM, options = {}) {
    const getKey = options.getKey || ((item) => String(item?.term || "").trim().toLowerCase());
    const getAddedAt = options.getAddedAt || ((item) => item?.added_at);
    const getCorrectCount = options.getCorrectCount || ((item) => Number(item?.correct_count || 0));
    const getIncorrectCount = options.getIncorrectCount || ((item) => Number(item?.incorrect_count || 0));
    const random = typeof options.random === "function" ? options.random : Math.random;

    const uniqueItems = [];
    const knownKeys = new Set();
    (Array.isArray(items) ? items : []).forEach((item, index) => {
      const key = getKey(item) || `__item_${index}`;
      if (knownKeys.has(key)) return;
      knownKeys.add(key);
      uniqueItems.push(item);
    });

    const total = normalizeCount(requestedCount, uniqueItems.length);
    if (!total) return [];
    if (strategy === STRATEGIES.RANDOM) return sample(uniqueItems, total, random);

    const coreCount = Math.min(total, Math.round(total * 0.8));
    let ranked = [];
    let poolMultiplier = 3;

    if (strategy === STRATEGIES.NEWEST) {
      ranked = [...uniqueItems].sort((left, right) => timestamp(getAddedAt(right)) - timestamp(getAddedAt(left)));
    } else if (strategy === STRATEGIES.INCORRECT) {
      ranked = uniqueItems
        .filter((item) => getIncorrectCount(item) > 0)
        .sort(
          (left, right) =>
            getIncorrectCount(right) - getIncorrectCount(left) ||
            getCorrectCount(left) - getCorrectCount(right) ||
            timestamp(getAddedAt(right)) - timestamp(getAddedAt(left)),
        );
    } else if (strategy === STRATEGIES.CONSOLIDATE) {
      poolMultiplier = 2;
      ranked = uniqueItems
        .filter((item) => getCorrectCount(item) > 0)
        .sort(
          (left, right) =>
            getCorrectCount(right) - getCorrectCount(left) ||
            getIncorrectCount(left) - getIncorrectCount(right) ||
            timestamp(getAddedAt(right)) - timestamp(getAddedAt(left)),
        );
    } else {
      return sample(uniqueItems, total, random);
    }

    const corePool = ranked.slice(0, Math.min(ranked.length, coreCount * poolMultiplier));
    const selectedCore = sample(corePool, Math.min(coreCount, corePool.length), random);
    const selectedKeys = new Set(selectedCore.map(getKey));
    const remainingPool = uniqueItems.filter((item) => !selectedKeys.has(getKey(item)));
    const selectedRemainder = sample(remainingPool, total - selectedCore.length, random);
    return sample([...selectedCore, ...selectedRemainder], total, random);
  }

  return { STRATEGIES, selectReviewItems };
});
