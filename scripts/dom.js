export function querySelectorSafe(root, selector) {
  if (!(root instanceof Element) || typeof selector !== "string") return null;
  try { return root.querySelector(selector); } catch { return null; }
}

export function delegateClick(root, selector, callback) {
  if (!(root instanceof HTMLElement) || typeof selector !== "string" || typeof callback !== "function") return null;
  const handler = (event) => {
    const origin = event.target;
    const matched = origin instanceof Element ? origin.closest(selector) : null;
    if (!(matched instanceof HTMLElement) || !root.contains(matched)) return;
    callback(event, matched);
  };
  root.addEventListener("click", handler);
  return () => root.removeEventListener("click", handler);
}
