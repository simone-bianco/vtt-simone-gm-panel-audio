import { error } from "../debug.js";
import { openGroupSettings } from "./gm-panel-group-settings.js";

/**
 * Callback factory extracted from SimoneGmPanelApp#attachSoundboardActionListeners
 * to keep the shell under 500 lines.
 *
 * All state flows through explicit parameters — no private-field coupling.
 *
 * @param {object} deps
 * @param {import("./gm-panel-app.js").SimoneGmPanelApp} deps.app
 * @param {import("./gm-panel-soundboard-store.js").GmPanelSoundboardStore} deps.store
 * @param {import("./gm-panel-audio-controller.js").GmPanelAudioController} deps.audioController
 * @param {import("./gm-panel-group-audio-controller.js").GmPanelGroupAudioController} deps.groupController
 * @param {function(string): void} deps.toggleGroupExpand
 * @param {function(string): void} deps.toggleItemSelection
 * @param {function(): Promise<void>} deps.createGroupFromSelection
 * @param {function(): import("./gm-panel-app.js").SimoneGmPanelApp.getPositionalDefaults} deps.getPositionalDefaults
 * @returns {object} callbacks object for attachSoundboardActionListeners
 */
export function buildSoundboardCallbacks(deps) {
  const { app, store, audioController, groupController,
    toggleGroupExpand, toggleItemSelection, createGroupFromSelection,
    getPositionalDefaults } = deps;

  const render = () => app.render({ force: true });
  const runGroupAction = async (action, operation) => {
    try {
      await operation();
      return true;
    } catch (cause) {
      error(`Group action failed: ${action}`, cause);
      return false;
    }
  };

  return {
    toggleSoundboardSound: (uuid) => void app.toggleSoundboardSound(uuid),
    removeSoundboardSound: (uuid) => void app.removeSoundboardSound(uuid),
    cleanAllSoundboardSounds: () => void app.cleanAllSoundboardSounds(),
    deleteCurrentPlaylist: () => void store.deleteCurrentPlaylist(),
    newPlaylistFromSoundboard: () => void store.newPlaylistFromSoundboard(),
    openLoadModal: () => void store.openLoadModal(),
    openSoundSettings: (uuid) => void store.openSoundSettings(uuid),
    toggleLoop: (uuid) => void store.toggleLoop(uuid),
    togglePauseForInstance: (iid, it) => audioController.togglePauseForInstance(iid, it),
    stopAmbientInstance: (iid) => audioController.stopAmbientInstance(iid),
    stopInstance: (iid) => audioController.stopInstance(iid),
    pauseAllForUuid: (uuid) => audioController.pauseAllForUuid(uuid),
    resumeAllForUuid: (uuid) => audioController.resumeAllForUuid(uuid),
    removeAllForUuid: (uuid) => audioController.removeAllForUuid(uuid),
    quickLoadPlaylist: (key) => store.quickLoadPlaylist(key),
    saveSoundboard: () => void store.saveSoundboard(),

    playGroup: async (groupId) => {
      if (await runGroupAction("play", () => groupController.playGroup(groupId))) await render();
    },
    stopGroup: async (groupId) => {
      if (await runGroupAction("stop", () => groupController.stopGroup(groupId))) await render();
    },
    deleteGroup: async (groupId) => {
      if (!await runGroupAction("delete", () => groupController.stopGroup(groupId))) return;
      await store.deleteGroup(groupId);
    },
    toggleGroupExpand: (groupId) => {
      toggleGroupExpand(groupId);
      void render();
    },
    openGroupSettings: (groupId) => void openGroupSettings(groupId, {
      getGroupById: (id) => store.getGroupById(id),
      updateGroup: (id, patch) => store.updateGroup(id, patch),
      getPositionalDefaults,
      render,
    }),
    removeGroupMember: (groupId, itemId) => store.removeItemFromGroup(groupId, itemId),

    toggleGroupSession: async (sessionId) => {
      if (await runGroupAction("toggle-session", () => groupController.toggleGroupSessionPause(sessionId))) {
        await render();
      }
    },
    removeGroupSession: async (sessionId) => {
      if (await runGroupAction("remove-session", () => groupController.removeGroupSession(sessionId))) {
        await render();
      }
    },
    panGroupSession: async (tokenUuid) => {
      await app.panToToken(tokenUuid);
    },
    pauseGroupAll: async (groupId) => {
      if (await runGroupAction("pause-all", () => groupController.pauseAllGroupSessions(groupId))) {
        await render();
      }
    },
    removeGroupSessions: async (groupId) => {
      if (await runGroupAction("remove-all", () => groupController.removeAllGroupSessions(groupId))) {
        await render();
      }
    },

    toggleItemSelection,
    createGroupFromSelection,
    render,
  };
}
