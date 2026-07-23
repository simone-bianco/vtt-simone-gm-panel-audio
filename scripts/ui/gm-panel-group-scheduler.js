import { computeDelay } from "./gm-panel-audio-persistence.js";

/**
 * Group playback scheduler helpers extracted from GmPanelGroupAudioController.
 *
 * - chooseNextGroupItem: selects next item based on sequential/random mode
 * - computeGroupDelay: thin wrapper around shared computeDelay with group defaults
 */

/**
 * Choose the next item from a group instance's resolved items.
 * Handles sequential and random modes, with optional avoidImmediateRepeat.
 *
 * @param {object} instance - Group instance object
 * @param {Array<{ uuid: string }>} instance.resolvedItems
 * @param {{ mode: string, avoidImmediateRepeat: boolean }} instance.group
 * @param {string|null} instance.lastItemId
 * @param {number} instance.currentIndex
 * @returns {{ uuid: string }|null} The chosen item, or null if no items
 */
export function chooseNextGroupItem(instance) {
  const items = instance.resolvedItems;
  if (!items.length) return null;

  if (instance.group.mode === "random") {
    let candidates = items;
    if (instance.group.avoidImmediateRepeat && instance.lastItemId && items.length > 1) {
      candidates = items.filter((ri) => ri.uuid !== instance.lastItemId);
      if (candidates.length === 0) candidates = items;
    }
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    instance.lastItemId = chosen.uuid;
    return chosen;
  }

  // Sequential mode
  const item = items[instance.currentIndex % items.length];
  instance.currentIndex = (instance.currentIndex + 1) % items.length;
  instance.lastItemId = item.uuid;
  return item;
}

/**
 * Compute delay for group scheduling (offsetMin default 100, offsetMax default 1000).
 * Delegates to the shared computeDelay from gm-panel-audio-persistence.js.
 *
 * @param {{ offsetMin?: number, offsetMax?: number }} config
 * @returns {number}
 */
export function computeGroupDelay(config) {
  return computeDelay(config.offsetMin ?? 100, config.offsetMax ?? 1000);
}
