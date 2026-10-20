(() => {
  const errorText = (reason) => {
    try { return String(reason?.stack || reason || "Unknown error"); }
    catch { return "Unknown error"; }
  };
  const report = (reason) => {
    const root = document.getElementById("root");
    if (!root) return;
    const message = errorText(reason);
    if (root.hasChildNodes()) {
      // React owns the mounted tree. A failed background task must not erase it.
      window.dispatchEvent(new CustomEvent("lyrical-runtime-error", { detail: message }));
      return;
    }
    const panel = document.createElement("section");
    panel.style.cssText = "padding:24px;font-family:system-ui,sans-serif;background:#1c1c1e;color:#ffb4b4;min-height:100vh;box-sizing:border-box";
    const title = document.createElement("h2");
    title.textContent = "Unable to start Lyrical Sync";
    const details = document.createElement("pre");
    details.style.cssText = "white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px";
    details.textContent = message;
    const retry = document.createElement("button");
    retry.textContent = "Reload";
    retry.addEventListener("click", () => window.location.reload());
    panel.append(title, details, retry);
    root.append(panel);
  };
  window.addEventListener("error", (event) => {
    if (event.error || event.message) report(event.error || event.message);
  });
  window.addEventListener("unhandledrejection", (event) => report(event.reason));
})();
