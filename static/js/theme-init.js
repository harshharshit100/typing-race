// Runs before the stylesheet paints to avoid a flash of the wrong theme.
(function () {
  var theme = "dark";
  try {
    var raw =
      window.localStorage.getItem("typingrace.settings.v1") ||
      window.localStorage.getItem("typerush.settings.v1") ||
      "{}";
    var settings = JSON.parse(raw);
    if (settings && (settings.theme === "light" || settings.theme === "dark")) {
      theme = settings.theme;
    } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
      theme = "light";
    }
  } catch (error) {
    // Ignore malformed localStorage and fall back to the system preference.
    try {
      if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
        theme = "light";
      }
    } catch (ignored) {
      // Keep dark mode.
    }
  }

  document.documentElement.dataset.theme = theme;
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#f4f5fb" : "#070912");
})();
