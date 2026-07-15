const test = require("node:test");
const assert = require("node:assert/strict");
const { assembleTail, isEditableChar } = require("../review-spelling.js");

test("letters are editable while punctuation stays fixed", () => {
  assert.equal(isEditableChar("a"), true);
  assert.equal(isEditableChar("-"), false);
  assert.equal(isEditableChar("."), false);
});

test("assembles a phrase with spaces and final punctuation", () => {
  const term = "Neutral to slightly positive.";
  const letters = [...term].slice(1).filter(isEditableChar);
  assert.equal(`N${assembleTail(term, letters)}`, term);
});

test("assembles apostrophes and hyphens without editable punctuation slots", () => {
  const term = "well-known's";
  const letters = [...term].slice(1).filter(isEditableChar);
  assert.equal(`w${assembleTail(term, letters)}`, term);
});
