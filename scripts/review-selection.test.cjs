const test = require("node:test");
const assert = require("node:assert/strict");
const { STRATEGIES, selectReviewItems } = require("../review-selection.js");

function seededRandom(seed = 7) {
  let value = seed;
  return () => {
    value = (value * 48271) % 2147483647;
    return value / 2147483647;
  };
}

function buildItems(count = 60) {
  return Array.from({ length: count }, (_, index) => ({
    term: `word-${index}`,
    added_at: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    correct_count: index,
    incorrect_count: index,
  }));
}

test("newest strategy draws at least 80 percent from the newest 3x core pool", () => {
  const items = buildItems();
  const selected = selectReviewItems(items, 10, STRATEGIES.NEWEST, { random: seededRandom() });
  const newestPool = new Set(items.slice(-24).map((item) => item.term));
  assert.equal(selected.length, 10);
  assert.equal(new Set(selected.map((item) => item.term)).size, 10);
  assert.ok(selected.filter((item) => newestPool.has(item.term)).length >= 8);
});

test("incorrect strategy prioritizes the highest incorrect counts", () => {
  const items = buildItems();
  const selected = selectReviewItems(items, 10, STRATEGIES.INCORRECT, { random: seededRandom(11) });
  const incorrectPool = new Set(items.slice(-24).map((item) => item.term));
  assert.ok(selected.filter((item) => incorrectPool.has(item.term)).length >= 8);
});

test("consolidate strategy prioritizes the highest correct counts from a 2x core pool", () => {
  const items = buildItems();
  const selected = selectReviewItems(items, 10, STRATEGIES.CONSOLIDATE, { random: seededRandom(13) });
  const consolidatePool = new Set(items.slice(-16).map((item) => item.term));
  assert.ok(selected.filter((item) => consolidatePool.has(item.term)).length >= 8);
});

test("priority strategies fill from all reviewable words when history pool is small", () => {
  const items = buildItems(12).map((item, index) => ({
    ...item,
    correct_count: index < 2 ? index + 1 : 0,
    incorrect_count: index < 2 ? index + 1 : 0,
  }));
  const selected = selectReviewItems(items, 10, STRATEGIES.INCORRECT, { random: seededRandom(17) });
  assert.equal(selected.length, 10);
  assert.equal(new Set(selected.map((item) => item.term)).size, 10);
  assert.ok(selected.some((item) => item.incorrect_count === 0));
});

test("random strategy returns a unique sample without applying a ranking", () => {
  const items = buildItems();
  const selected = selectReviewItems(items, 10, STRATEGIES.RANDOM, { random: seededRandom(19) });
  assert.equal(selected.length, 10);
  assert.equal(new Set(selected.map((item) => item.term)).size, 10);
  assert.ok(selected.some((item) => item.term === "word-0" || Number(item.term.split("-")[1]) < 36));
});
