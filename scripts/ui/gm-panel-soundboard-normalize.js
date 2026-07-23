/**
 * Pure normalization functions for soundboard items.
 * Extracted from GmPanelSoundboardStore to reduce cognitive load.
 */

/**
 * Normalize a single soundboard item with safe defaults.
 * Used during playlist load to ensure consistent shape regardless
 * of what was saved.
 *
 * @param {object} item - Raw soundboard item from settings/playlist
 * @returns {{ uuid: string, loop: boolean, offsetMin: number, offsetMax: number, positional: object|undefined }}
 */
export function normalizeSoundboardItem(item) {
  if (!item || typeof item !== "object") {
    return { uuid: "", loop: false, offsetMin: 0, offsetMax: 1000, positional: undefined };
  }
  return {
    uuid: item.uuid ?? "",
    loop: item.loop === true,
    offsetMin: typeof item.offsetMin === "number" ? item.offsetMin : 0,
    offsetMax: typeof item.offsetMax === "number" ? item.offsetMax : 1000,
    positional: item.positional && typeof item.positional === "object" ? item.positional : undefined,
  };
}

/**
 * Normalize an array of soundboard items.
 * @param {Array<object>} items
 * @returns {Array<{ uuid: string, loop: boolean, offsetMin: number, offsetMax: number, positional: object|undefined }>}
 */
export function normalizeSoundboardItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map((i) => normalizeSoundboardItem(i));
}
