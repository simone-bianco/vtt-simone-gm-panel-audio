import { MODULE_ID } from "../constants.js";
import { debug, warn } from "../debug.js";
import { getSoundboardState } from "../settings.js";

/**
 * Map-drop handlers extracted from SimoneGmPanelApp to keep the shell
 * under the 500-line threshold. Each handler receives the app instance
 * so it can call public methods — no private-field coupling.
 */

/**
 * Handle an item map drop: create an AmbientSound anchor at the drop point.
 *
 * @param {import("./gm-panel-app.js").SimoneGmPanelApp} app
 * @param {{ itemId: string, uuid: string, point: { x: number, y: number } }} data
 */
export async function handleItemMapDrop(app, { itemId, uuid, point }) {
  if (!canvas?.ready || !canvas.scene) {
    warn("Item map drop: canvas not ready");
    return;
  }

  const sound = await app.resolvePlaylistSoundByUuid(uuid);
  if (!sound?.path) {
    warn("Item map drop: sound not found", { uuid });
    return;
  }

  const state = getSoundboardState();
  const item = state.items.find((i) => i?.id === itemId);
  const itemPos = item?.positional && typeof item.positional === "object" ? item.positional : {};
  const defaults = app.getPositionalDefaults();

  const radius = typeof itemPos.radius === "number" ? itemPos.radius : defaults.radius;
  const volume = typeof itemPos.volume === "number" ? itemPos.volume : defaults.volume;
  const walls = typeof itemPos.walls === "boolean" ? itemPos.walls : defaults.walls;
  const easing = typeof itemPos.easing === "boolean" ? itemPos.easing : defaults.easing;
  const elevation = typeof itemPos.elevation === "number" ? itemPos.elevation : defaults.elevation;
  const loop = item?.loop === true;

  try {
    const ambientDoc = await canvas.scene.createEmbeddedDocuments("AmbientSound", [{
      x: point.x,
      y: point.y,
      elevation,
      radius,
      volume,
      walls,
      easing,
      path: sound.path,
      repeat: loop,
      flags: {
        [MODULE_ID]: {
          instanceType: "soundboard-map-drop",
          dropType: "item",
          itemId,
          soundUuid: uuid,
          createdBy: game.user.id,
        },
      },
    }]);

    debug("Item map drop: AmbientSound created", {
      itemId, uuid, ambientId: ambientDoc?.[0]?.id, point,
    });
  } catch (e) {
    warn("Item map drop: failed to create AmbientSound", {
      itemId, uuid, error: e?.message ?? e,
    });
  }
}

/**
 * Handle a group map drop: create a silent marker and start group playback.
 *
 * @param {import("./gm-panel-app.js").SimoneGmPanelApp} app
 * @param {import("./gm-panel-group-audio-controller.js").GmPanelGroupAudioController} groupController
 * @param {{ groupId: string, point: { x: number, y: number } }} data
 */
export async function handleGroupMapDrop(app, groupController, { groupId, point }) {
  if (!canvas?.ready || !canvas.scene) {
    warn("Group map drop: canvas not ready");
    return;
  }

  const state = getSoundboardState();
  const group = state.groups.find((g) => g?.id === groupId);
  if (!group) {
    warn("Group map drop: group not found", { groupId });
    return;
  }

  try {
    const firstItemId = group.itemIds?.[0];
    const firstItem = firstItemId ? state.items.find((i) => i?.id === firstItemId) : null;
    const firstSound = firstItem?.uuid
      ? await app.resolvePlaylistSoundByUuid(firstItem.uuid)
      : null;
    const markerPath = firstSound?.path || null;

    if (markerPath) {
      await canvas.scene.createEmbeddedDocuments("AmbientSound", [{
        x: point.x,
        y: point.y,
        elevation: 0,
        radius: 30,
        volume: 0,
        easing: false,
        walls: false,
        path: markerPath,
        repeat: false,
        flags: {
          [MODULE_ID]: {
            instanceType: "soundboard-map-drop",
            dropType: "group",
            groupId,
            createdBy: game.user.id,
          },
        },
      }]);
      debug("Group map drop: marker created", { groupId, point, markerPath });
    } else {
      debug("Group map drop: no valid path for marker, skipping", { groupId });
    }
  } catch (e) {
    warn("Group map drop: failed to create marker", {
      groupId, error: e?.message ?? e,
    });
  }

  // Start group playback at the map position
  await groupController.playGroupAtPosition(groupId, point);
}
