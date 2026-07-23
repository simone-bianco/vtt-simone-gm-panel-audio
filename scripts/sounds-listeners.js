import { delegateClick, querySelectorSafe } from "./dom.js";

export function attachDropzoneListeners(element, { handleSoundboardDrop }, addCleanup) {
  const dropzone = querySelectorSafe(element, '[data-testid="sgmp-soundboard-dropzone"]');
  if (!(dropzone instanceof HTMLElement)) return;
  const onDragOver = (event) => { event.preventDefault(); dropzone.classList.add("is-dragover"); };
  const onDragLeave = (event) => {
    if (event.currentTarget !== dropzone) return;
    const related = event.relatedTarget;
    if (related instanceof Node && dropzone.contains(related)) return;
    dropzone.classList.remove("is-dragover");
  };
  const onDrop = (event) => {
    event.preventDefault();
    dropzone.classList.remove("is-dragover");
    void handleSoundboardDrop(event);
  };
  dropzone.addEventListener("dragover", onDragOver);
  dropzone.addEventListener("dragleave", onDragLeave);
  dropzone.addEventListener("drop", onDrop);
  addCleanup(() => dropzone.removeEventListener("dragover", onDragOver));
  addCleanup(() => dropzone.removeEventListener("dragleave", onDragLeave));
  addCleanup(() => dropzone.removeEventListener("drop", onDrop));
}

export function attachSearchListener(element, { setSearchQuery, render }, addCleanup) {
  const input = querySelectorSafe(element, '[data-testid="sgmp-soundboard-search"]');
  if (!(input instanceof HTMLInputElement)) return;
  let timer = null;
  const onInput = (event) => {
    const value = event.currentTarget instanceof HTMLInputElement ? event.currentTarget.value ?? "" : "";
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { setSearchQuery(value); void render(); }, 180);
  };
  const onKeyDown = (event) => { if (event.key === "Enter") event.preventDefault(); };
  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onKeyDown);
  addCleanup(() => {
    if (timer) clearTimeout(timer);
    input.removeEventListener("input", onInput);
    input.removeEventListener("keydown", onKeyDown);
  });
}

export function attachTokenPanListener(element, { panToToken }, addCleanup) {
  const cleanup = delegateClick(element, '[data-action="pan-to-token"]', (event, matched) => {
    event.preventDefault();
    void panToToken(matched.dataset.tokenUuid ?? "");
  });
  if (cleanup) addCleanup(cleanup);
}
