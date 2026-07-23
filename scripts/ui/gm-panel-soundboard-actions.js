import { delegateClick } from "../dom.js";
import { debug } from "../debug.js";

/**
 * Attach delegated click listeners for all soundboard action buttons.
 *
 * Extracted from SimoneGmPanelApp.#attachSoundboardActionListeners to reduce
 * app.js complexity. All state access flows through explicit callbacks —
 * no private fields are accessed directly.
 *
 * @param {HTMLElement} element - Persistent container element (GM Panel root)
 * @param {object} callbacks - Explicit callbacks for every action
 * @param {function(string): void} callbacks.toggleSoundboardSound
 * @param {function(string): void} callbacks.removeSoundboardSound
 * @param {function(): void} callbacks.cleanAllSoundboardSounds
 * @param {function(): void} callbacks.saveSoundboard
 * @param {function(): void} callbacks.newPlaylistFromSoundboard
 * @param {function(): void} callbacks.openLoadModal
 * @param {function(string): void} callbacks.openSoundSettings
 * @param {function(string): void} callbacks.toggleLoop
 * @param {function(string): Promise<void>} callbacks.quickLoadPlaylist
 * @param {function(string): void} callbacks.playGroup
 * @param {function(string): void} callbacks.stopGroup
 * @param {function(string): void} callbacks.deleteGroup
 * @param {function(string): void} callbacks.toggleGroupExpand
 * @param {function(string): void} callbacks.openGroupSettings
 * @param {function(string, string): void} callbacks.removeGroupMember
 * @param {function(number, string): Promise<void>} callbacks.togglePauseForInstance
 * @param {function(number): Promise<void>} callbacks.stopAmbientInstance
 * @param {function(number): Promise<void>} callbacks.stopInstance
 * @param {function(string): Promise<void>} callbacks.pauseAllForUuid
 * @param {function(string): Promise<void>} callbacks.resumeAllForUuid
 * @param {function(string): Promise<void>} callbacks.removeAllForUuid
 * @param {function(): Promise<void>} callbacks.render
 * @param {function(function(): void): void} addCleanup - Register a cleanup function
 */
export function attachSoundboardActionListeners(element, callbacks, addCleanup) {
  if (!(element instanceof HTMLElement)) return;

  const actions = [
    { action: "play-sound", callback: (uuid) => void callbacks.toggleSoundboardSound(uuid) },
    { action: "remove-sound", callback: (uuid) => void callbacks.removeSoundboardSound(uuid) },
    { action: "clean-all-sounds", callback: () => void callbacks.cleanAllSoundboardSounds(), hasUuid: false },
    { action: "delete-current-playlist", callback: () => void callbacks.deleteCurrentPlaylist(), hasUuid: false },
    { action: "save-soundboard", callback: () => void callbacks.saveSoundboard(), hasUuid: false },
    { action: "new-soundboard", callback: () => void callbacks.newPlaylistFromSoundboard(), hasUuid: false },
    { action: "load-soundboard", callback: () => void callbacks.openLoadModal(), hasUuid: false },
    { action: "sound-settings", callback: (uuid) => void callbacks.openSoundSettings(uuid) },
    { action: "toggle-loop", callback: (uuid) => void callbacks.toggleLoop(uuid) },
    // Inline instance actions (within expanded rows)
    { action: "pause-instance", callback: async (uuid, el) => {
      if (el instanceof HTMLElement) {
        const iid = Number(el.dataset.instanceId);
        const row = el.closest("[data-instance-type]");
        const instanceType = row instanceof HTMLElement ? row.dataset.instanceType : "sound";
        await callbacks.togglePauseForInstance(iid, instanceType);
        await callbacks.render();
      }
    }, hasUuid: false },
    { action: "remove-instance", callback: async (uuid, el) => {
      if (el instanceof HTMLElement) {
        const iid = Number(el.dataset.instanceId);
        const row = el.closest("[data-instance-type]");
        const instanceType = row instanceof HTMLElement ? row.dataset.instanceType : "";
        debug("remove-instance action", { iid, isNaN: Number.isNaN(iid), raw: el.dataset.instanceId, instanceType, tagName: el.tagName });
        if (instanceType === "ambient") {
          await callbacks.stopAmbientInstance(iid);
        } else {
          await callbacks.stopInstance(iid);
        }
        await callbacks.render();
      }
    }, hasUuid: false },
    { action: "expand-pause-all", callback: async (uuid) => { await callbacks.pauseAllForUuid(uuid); await callbacks.render(); } },
    { action: "expand-resume-all", callback: async (uuid) => { await callbacks.resumeAllForUuid(uuid); await callbacks.render(); } },
    { action: "expand-remove-all", callback: async (uuid) => { await callbacks.removeAllForUuid(uuid); await callbacks.render(); } },
    // NOTE: pan-to-token is handled separately by attachTokenPanListener to avoid
    // listener duplication. It reads data-token-uuid (not data-sound-uuid) so it
    // does not fit the hasUuid pattern.
  ];

  // NOTE: quick-load-playlist uses data-playlist-key (not data-sound-uuid).
  // Handled separately from the hasUuid loop.
  if (callbacks.quickLoadPlaylist) {
    const quickLoad = delegateClick(element, '[data-action="quick-load-playlist"]', (event, matchedElement) => {
      event.preventDefault();
      const key = matchedElement instanceof HTMLElement ? matchedElement.dataset.playlistKey : "";
      if (key) void callbacks.quickLoadPlaylist(key);
    });
    if (quickLoad) addCleanup(quickLoad);
  }

  // Group actions use data-group-id
  const groupActions = [
    { action: "play-group", handler: (id) => callbacks.playGroup?.(id) },
    { action: "stop-group", handler: (id) => callbacks.stopGroup?.(id) },
    { action: "remove-group", handler: (id) => callbacks.deleteGroup?.(id) },
    { action: "toggle-group-expanded", handler: (id) => callbacks.toggleGroupExpand?.(id) },
    { action: "group-settings", handler: (id) => callbacks.openGroupSettings?.(id) },
  ];
  for (const { action, handler } of groupActions) {
    const delegated = delegateClick(element, `[data-action="${action}"]`, (event, matchedElement) => {
      event.preventDefault();
      const groupId = matchedElement instanceof HTMLElement ? matchedElement.dataset.groupId : "";
      if (groupId) void handler(groupId);
    });
    if (delegated) addCleanup(delegated);
  }

  // remove-group-member uses data-group-id + data-item-id
  if (callbacks.removeGroupMember) {
    const rmMember = delegateClick(element, '[data-action="remove-group-member"]', (event, matchedElement) => {
      event.preventDefault();
      const el = matchedElement instanceof HTMLElement ? matchedElement : null;
      const groupId = el?.dataset.groupId ?? "";
      const itemId = el?.dataset.itemId ?? "";
      if (groupId && itemId) void callbacks.removeGroupMember(groupId, itemId);
    });
    if (rmMember) addCleanup(rmMember);
  }

  // Group session chip actions
  // toggle-group-session uses data-session-id
  if (callbacks.toggleGroupSession) {
    const toggleSession = delegateClick(element, '[data-action="toggle-group-session"]', (event, matchedElement) => {
      event.preventDefault();
      const sessionId = matchedElement instanceof HTMLElement ? Number(matchedElement.dataset.sessionId) : NaN;
      if (!Number.isNaN(sessionId)) void callbacks.toggleGroupSession(sessionId);
    });
    if (toggleSession) addCleanup(toggleSession);
  }

  // remove-group-session uses data-session-id
  if (callbacks.removeGroupSession) {
    const rmSession = delegateClick(element, '[data-action="remove-group-session"]', (event, matchedElement) => {
      event.preventDefault();
      const sessionId = matchedElement instanceof HTMLElement ? Number(matchedElement.dataset.sessionId) : NaN;
      if (!Number.isNaN(sessionId)) void callbacks.removeGroupSession(sessionId);
    });
    if (rmSession) addCleanup(rmSession);
  }

  // pan-group-session uses data-token-uuid (click on chip body)
  if (callbacks.panGroupSession) {
    const panSession = delegateClick(element, '[data-action="pan-group-session"]', (event, matchedElement) => {
      // Ignore clicks on child buttons (handled by their own delegates)
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('button')) return;
      event.preventDefault();
      const el = matchedElement instanceof HTMLElement ? matchedElement : null;
      const tokenUuid = el?.dataset.tokenUuid ?? "";
      if (tokenUuid) void callbacks.panGroupSession(tokenUuid);
    });
    if (panSession) addCleanup(panSession);
  }

  // pause-group-all uses data-group-id
  if (callbacks.pauseGroupAll) {
    const pauseAll = delegateClick(element, '[data-action="pause-group-all"]', (event, matchedElement) => {
      event.preventDefault();
      const groupId = matchedElement instanceof HTMLElement ? matchedElement.dataset.groupId : "";
      if (groupId) void callbacks.pauseGroupAll(groupId);
    });
    if (pauseAll) addCleanup(pauseAll);
  }

  // remove-group-sessions uses data-group-id
  if (callbacks.removeGroupSessions) {
    const rmAll = delegateClick(element, '[data-action="remove-group-sessions"]', (event, matchedElement) => {
      event.preventDefault();
      const groupId = matchedElement instanceof HTMLElement ? matchedElement.dataset.groupId : "";
      if (groupId) void callbacks.removeGroupSessions(groupId);
    });
    if (rmAll) addCleanup(rmAll);
  }

  // toggle-item-selection uses data-item-id
  if (callbacks.toggleItemSelection) {
    const toggleSel = delegateClick(element, '[data-action="toggle-item-selection"]', (event, matchedElement) => {
      event.preventDefault();
      const itemId = matchedElement instanceof HTMLElement ? matchedElement.dataset.itemId : "";
      if (itemId) callbacks.toggleItemSelection(itemId);
    });
    if (toggleSel) addCleanup(toggleSel);
  }

  // create-group-from-selection (toolbar button, no data attr needed)
  if (callbacks.createGroupFromSelection) {
    const createGrp = delegateClick(element, '[data-action="create-group-from-selection"]', (event) => {
      event.preventDefault();
      void callbacks.createGroupFromSelection();
    });
    if (createGrp) addCleanup(createGrp);
  }

  for (const { action, callback, hasUuid = true } of actions) {
    const delegated = delegateClick(element, `[data-action="${action}"]`, (event, matchedElement) => {
      event.preventDefault();
      if (hasUuid) {
        const uuid = matchedElement instanceof HTMLElement ? matchedElement.dataset.soundUuid : "";
        callback(uuid, matchedElement);
      } else {
        callback("", matchedElement);
      }
    });
    if (delegated) addCleanup(delegated);
  }
}
