(function attachProfilePicker(windowObject) {
  function normalizeOptions(values) {
    return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b),
    );
  }

  function create({ root, input, toggle, panel, onCommit }) {
    if (!root || !input || !toggle || !panel) return null;

    let options = [];
    let activeIndex = -1;

    function getVisibleOptions() {
      const query = String(input.value || "").trim().toLowerCase();
      if (!query) return options;
      return options
        .filter((value) => value.toLowerCase().includes(query))
        .sort((a, b) => {
          const aStarts = a.toLowerCase().startsWith(query);
          const bStarts = b.toLowerCase().startsWith(query);
          if (aStarts !== bStarts) return aStarts ? -1 : 1;
          return a.localeCompare(b);
        });
    }

    function render() {
      const visibleOptions = getVisibleOptions();
      const query = String(input.value || "").trim();
      const hasExactMatch = options.some((value) => value.toLowerCase() === query.toLowerCase());
      const rows = visibleOptions.map(
        (value, index) => `
          <button
            class="profile-picker-option${index === activeIndex ? " is-active" : ""}"
            type="button"
            role="option"
            aria-selected="${index === activeIndex ? "true" : "false"}"
            data-profile-value="${encodeURIComponent(value)}"
          >
            <span>${escapeHtml(value)}</span>
            <small>已有标识</small>
          </button>
        `,
      );

      if (query && !hasExactMatch) {
        rows.push(`
          <button class="profile-picker-option is-create" type="button" role="option" data-profile-value="${encodeURIComponent(query)}">
            <span>使用“${escapeHtml(query)}”</span>
            <small>新标识</small>
          </button>
        `);
      }

      if (!rows.length) {
        rows.push('<p class="profile-picker-empty">暂无已有标识，可直接输入新标识。</p>');
      }
      panel.innerHTML = rows.join("");
    }

    function escapeHtml(value) {
      return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }

    function isOpen() {
      return !panel.classList.contains("hidden");
    }

    function open() {
      activeIndex = -1;
      render();
      panel.classList.remove("hidden");
      root.classList.add("is-open");
      input.setAttribute("aria-expanded", "true");
      toggle.setAttribute("aria-expanded", "true");
    }

    function close() {
      panel.classList.add("hidden");
      root.classList.remove("is-open");
      input.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-expanded", "false");
      activeIndex = -1;
    }

    function commit(value) {
      const normalized = String(value || "").trim();
      input.value = normalized;
      close();
      if (normalized) options = normalizeOptions([...options, normalized]);
      render();
      onCommit?.(normalized);
    }

    function moveActive(direction) {
      const buttons = [...panel.querySelectorAll("[data-profile-value]")];
      if (!buttons.length) return;
      activeIndex = (activeIndex + direction + buttons.length) % buttons.length;
      buttons.forEach((button, index) => {
        const active = index === activeIndex;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-selected", String(active));
      });
      buttons[activeIndex].scrollIntoView({ block: "nearest" });
    }

    input.addEventListener("focus", open);
    input.addEventListener("click", open);
    input.addEventListener("input", () => {
      activeIndex = -1;
      if (!isOpen()) open();
      else render();
    });
    input.addEventListener("change", () => {
      if (!isOpen()) onCommit?.(String(input.value || "").trim());
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (!isOpen()) open();
        moveActive(event.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (event.key === "Enter" && isOpen()) {
        const active = panel.querySelectorAll("[data-profile-value]")[activeIndex];
        if (!active) return;
        event.preventDefault();
        commit(decodeURIComponent(active.dataset.profileValue || ""));
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    });
    toggle.addEventListener("click", () => {
      if (isOpen()) close();
      else {
        open();
        input.focus({ preventScroll: true });
      }
    });
    panel.addEventListener("mousedown", (event) => {
      const option = event.target.closest("[data-profile-value]");
      if (!option) return;
      event.preventDefault();
      commit(decodeURIComponent(option.dataset.profileValue || ""));
    });
    document.addEventListener("pointerdown", (event) => {
      if (!root.contains(event.target)) close();
    });

    render();
    return {
      setOptions(values) {
        options = normalizeOptions(values);
        render();
      },
      open,
      close,
    };
  }

  windowObject.ProfilePicker = { create };
})(window);
