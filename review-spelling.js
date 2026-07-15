(function attachReviewSpelling(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ReviewSpelling = api;
})(typeof globalThis !== "undefined" ? globalThis : window, () => {
  function isEditableChar(char) {
    return /^[A-Za-z]$/.test(String(char || ""));
  }

  function assembleTail(term, inputValues) {
    const chars = [...String(term || "")].slice(1);
    let inputIndex = 0;
    return chars
      .map((char) => {
        if (!isEditableChar(char)) return char;
        const value = String(inputValues[inputIndex] || "").trim();
        inputIndex += 1;
        return value;
      })
      .join("");
  }

  return { isEditableChar, assembleTail };
});
