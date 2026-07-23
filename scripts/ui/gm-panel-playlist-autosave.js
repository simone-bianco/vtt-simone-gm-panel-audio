/**
 * Autosave helper for the soundboard playlist.
 *
 * Policy:
 * - If currentPlaylistKey is valid → update that playlist in-place.
 * - If missing → create an autosave daily entry and set it as current.
 * - Autosave is silent (no notification).
 * - Debounced — multiple rapid mutations coalesce into one save.
 *
 * All dependencies injected via callbacks — no private field access.
 */

import { debug, warn, error } from "../debug.js";

const AUTOSAVE_DEBOUNCE_MS = 600;

/**
 * Factory: create an autosave scheduler.
 *
 * @param {object} deps
 * @param {() => { items: Array, groups: Array, layout: Array }} deps.getState
 * @param {() => string|null} deps.getCurrentPlaylistKey
 * @param {() => Record<string, object>} deps.getSavedPlaylists
 * @param {(playlists: Record<string, object>) => Promise<void>} deps.setSavedPlaylists
 * @param {(key: string, name: string) => void} deps.setCurrentPlaylistKey
 * @returns {{ scheduleAutosave: () => void, flushAutosave: () => Promise<void> }}
 */
export function createAutosaveScheduler({
  getState,
  getCurrentPlaylistKey,
  getSavedPlaylists,
  setSavedPlaylists,
  setCurrentPlaylistKey,
}) {
  let timer = null;
  let pending = false;

  const performSave = async () => {
    pending = false;
    try {
      const state = getState();
      const currentKey = getCurrentPlaylistKey();

      // Autosave empty state only if a current playlist exists (preserve intentional clear)
      if (!state.items?.length && !currentKey) {
        debug("Autosave: skipping, no items and no current playlist");
        return;
      }

      const playlists = getSavedPlaylists();
      const now = Date.now();

      let key;
      let name;

      if (currentKey && playlists[currentKey]) {
        // Update existing current playlist in-place
        key = currentKey;
        name = playlists[currentKey].name ?? "?";
      } else {
        // Create daily autosave
        const today = new Date().toISOString().slice(0, 10);
        const existingKey = Object.keys(playlists).find((k) => k.endsWith(`_${today}`));
        key = existingKey ?? `${foundry.utils.randomID()}_${today}`;
        name = existingKey ? playlists[existingKey].name ?? today : today;
      }

      const existingMeta = playlists[key] ?? {};
      playlists[key] = {
        name,
        items: state.items,
        groups: state.groups,
        layout: state.layout,
        savedAt: now,
        usageCount: existingMeta.usageCount ?? 0,
        lastUsedAt: existingMeta.lastUsedAt ?? null,
      };
      await setSavedPlaylists(playlists);

      setCurrentPlaylistKey(key, name);
      debug("Autosave: saved", { key, name, count: state.items.length });
    } catch (err) {
      error("Autosave: failed", { error: err });
    }
  };

  return {
    /** Schedule a debounced autosave. Safe to call repeatedly. */
    scheduleAutosave() {
      if (timer) clearTimeout(timer);
      pending = true;
      timer = setTimeout(() => {
        timer = null;
        void performSave();
      }, AUTOSAVE_DEBOUNCE_MS);
    },

    /** Immediately flush any pending autosave. Returns a promise that resolves after save completes. */
    async flushAutosave() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (pending) {
        await performSave();
      }
    },
  };
}
