/**
 * Soundboard map-drop helpers.
 *
 * Handles drag payload construction and canvas-level drop detection
 * for dragging soundboard items/groups onto the scene canvas.
 *
 * Key design constraints:
 * - Does NOT read selected tokens.
 * - Does NOT read token under drop point.
 * - Uses only canvas coordinates (scene x/y).
 * - Reorder inside the panel is handled separately by gm-panel-soundboard-drag.js.
 */

import { MODULE_ID } from "../constants.js";
import { debug, warn } from "../debug.js";

/** Custom MIME type for map-drop payloads (separate from reorder). */
export const MAP_DROP_MIME = "application/x-sgmp-mapdrop";

// ── Payload builders ────────────────────────────────────────────────────────

/**
 * Build a map-drop drag payload for a single soundboard item.
 *
 * @param {object} item  Soundboard item (from state V2)
 * @param {string} item.id
 * @param {string} item.uuid  PlaylistSound UUID
 * @returns {object}
 */
export function buildSoundboardItemDragData(item) {
  return {
    type: "SGMPSoundboardMapDrop",
    dropType: "item",
    itemId: item.id,
    uuid: item.uuid,
  };
}

/**
 * Build a map-drop drag payload for a soundboard group.
 *
 * @param {object} group  Soundboard group (from state V2)
 * @param {string} group.id
 * @returns {object}
 */
export function buildSoundboardGroupDragData(group) {
  return {
    type: "SGMPSoundboardMapDrop",
    dropType: "group",
    groupId: group.id,
  };
}

// ── Coordinate helpers ──────────────────────────────────────────────────────

/**
 * Resolve canvas scene coordinates from a native DragEvent.
 * Returns null if canvas is not ready.
 *
 * Uses getBoundingClientRect + stage worldTransform (public API).
 * Verified approach used across Foundry v13 modules.
 *
 * ⚠ QA: test with zoom in/out, canvas panned, drop at edges.
 *
 * @param {DragEvent} event
 * @returns {{ x: number, y: number }|null}
 */
export function resolveCanvasDropPoint(event) {
  if (!canvas?.ready || !canvas.scene) return null;
  if (typeof event.clientX !== "number" || typeof event.clientY !== "number") return null;

  try {
    // Convert screen pixels to local canvas coordinates
    const rect = canvas.app.view.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;

    // Apply inverse stage transform (handles zoom, pan, rotation)
    const t = canvas.stage.worldTransform;
    const inv = t.applyInverse({ x: localX, y: localY });

    return { x: inv.x, y: inv.y };
  } catch (_) {
    return null;
  }
}

/**
 * Parse a map-drop payload from the DragEvent's dataTransfer.
 * Returns null if the event doesn't contain a valid map-drop payload.
 *
 * @param {DragEvent} event
 * @returns {object|null}
 */
export function parseMapDropPayload(event) {
  if (!event.dataTransfer) return null;
  try {
    const raw = event.dataTransfer.getData(MAP_DROP_MIME);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (payload?.type !== "SGMPSoundboardMapDrop") return null;
    if (payload.dropType !== "item" && payload.dropType !== "group") return null;
    return payload;
  } catch (_) {
    return null;
  }
}

// ── Drop handler ────────────────────────────────────────────────────────────

/**
 * Handle a canvas-level soundboard drop event.
 * Dispatches to the appropriate handler based on dropType.
 *
 * Does NOT read selected tokens, does NOT read token under drop point.
 *
 * @param {DragEvent} event
 * @param {{ onItemMapDrop?: (data: { itemId: string, uuid: string, point: { x: number, y: number } }) => Promise<void>, onGroupMapDrop?: (data: { groupId: string, point: { x: number, y: number } }) => Promise<void> }} handlers
 */
export async function handleCanvasSoundboardDrop(event, { onItemMapDrop, onGroupMapDrop } = {}) {
  const payload = parseMapDropPayload(event);
  if (!payload) return;

  const point = resolveCanvasDropPoint(event);
  if (!point) {
    warn("Map drop: could not resolve canvas coordinates", { payload });
    return;
  }

  if (payload.dropType === "item" && typeof onItemMapDrop === "function") {
    debug("Map drop: item", { itemId: payload.itemId, uuid: payload.uuid, point });
    await onItemMapDrop({ itemId: payload.itemId, uuid: payload.uuid, point });
  } else if (payload.dropType === "group" && typeof onGroupMapDrop === "function") {
    debug("Map drop: group", { groupId: payload.groupId, point });
    await onGroupMapDrop({ groupId: payload.groupId, point });
  }
}

// ── Canvas listener lifecycle ───────────────────────────────────────────────

/**
 * Attach a document-level dragover+drop listener for canvas drops.
 *
 * The listener fires only when the drag payload contains a map-drop MIME type
 * AND the drop target is outside the GM Panel.
 *
 * @param {HTMLElement} panelElement — GM Panel root element (to exclude internal drops)
 * @param {{ onItemMapDrop?: (data: { itemId: string, uuid: string, point: { x: number, y: number } }) => Promise<void>, onGroupMapDrop?: (data: { groupId: string, point: { x: number, y: number } }) => Promise<void> }} handlers
 * @returns {{ destroy: () => void }} cleanup handle
 */
export function attachCanvasDropListener(panelElement, handlers = {}) {
  const onDragOver = (event) => {
    // Only intercept if this is a map-drop payload
    const payload = parseMapDropPayload(event);
    if (!payload) return;

    // Don't interfere with panel-internal drops
    if (panelElement.contains(event.target)) return;

    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  };

  const onDrop = (event) => {
    const payload = parseMapDropPayload(event);
    if (!payload) return;

    // Don't double-handle panel-internal drops
    if (panelElement.contains(event.target)) return;

    event.preventDefault();
    event.stopPropagation();
    void handleCanvasSoundboardDrop(event, handlers).catch((cause) => {
      warn("Map drop handler failed", { error: cause?.message ?? cause });
    });
  };

  document.addEventListener("dragover", onDragOver);
  document.addEventListener("drop", onDrop);

  return {
    destroy: () => {
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
    },
  };
}
