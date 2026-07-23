import { debug, error } from "../debug.js";

/**
 * Group CRUD operations extracted from GmPanelSoundboardStore.
 *
 * Each function receives a `deps` bag to avoid private-field coupling:
 * @typedef {object} GroupDeps
 * @property {function(): object} getState     — returns current soundboard state
 * @property {function(object): Promise<void>} setState — persists new state
 * @property {function(): void} scheduleAutosave
 * @property {function(): Promise<void>} render — calls app.render({force:true})
 */

/**
 * Create a group from selected item UUIDs.
 * @param {GroupDeps} deps
 * @param {string[]} itemIds
 * @param {{ name?: string }} [options]
 * @returns {Promise<string|null>} group id or null
 */
export async function createGroupFromSelection(deps, itemIds, options = {}) {
  if (!Array.isArray(itemIds) || !itemIds.length) {
    ui.notifications?.warn(game.i18n.localize("SIMONE_GM_PANEL.Soundboard.CreateGroupNoItems"));
    return null;
  }
  try {
    const state = deps.getState();
    const validIds = itemIds.filter((id) => state.items.some((item) => item.id === id));
    if (!validIds.length) return null;

    const group = _newGroup(validIds, options.name);
    const newState = {
      ...state,
      groups: [...state.groups, group],
      layout: [...state.layout, { type: "group", id: group.id }],
    };
    await deps.setState(newState);
    debug("Group created from selection", { groupId: group.id, itemCount: validIds.length });
    deps.scheduleAutosave();
    await deps.render();
    return group.id;
  } catch (err) {
    error("Failed to create group", { error: err });
    return null;
  }
}

/**
 * Create an empty group (no items).
 * @param {GroupDeps} deps
 * @param {string|null} [name]
 * @returns {Promise<string|null>}
 */
export async function createEmptyGroup(deps, name = null) {
  try {
    const state = deps.getState();
    const group = _newGroup([], name);
    const newState = {
      ...state,
      groups: [...state.groups, group],
      layout: [...state.layout, { type: "group", id: group.id }],
    };
    await deps.setState(newState);
    debug("Empty group created", { groupId: group.id });
    deps.scheduleAutosave();
    await deps.render();
    return group.id;
  } catch (err) {
    error("Failed to create empty group", { error: err });
    return null;
  }
}

/** @param {GroupDeps} deps */
export async function updateGroup(deps, groupId, patch) {
  if (typeof groupId !== "string" || !patch || typeof patch !== "object") return;
  try {
    const state = deps.getState();
    const idx = state.groups.findIndex((g) => g.id === groupId);
    if (idx === -1) return;
    const nextGroups = [...state.groups];
    nextGroups[idx] = { ...nextGroups[idx], ...patch };
    await deps.setState({ ...state, groups: nextGroups });
    debug("Group updated", { groupId, patch: Object.keys(patch) });
    deps.scheduleAutosave();
  } catch (err) {
    error("Failed to update group", { groupId, error: err });
  }
}

/** @param {GroupDeps} deps */
export async function deleteGroup(deps, groupId) {
  if (typeof groupId !== "string") return;
  try {
    const state = deps.getState();
    const idx = state.groups.findIndex((g) => g.id === groupId);
    if (idx === -1) return;
    const nextGroups = state.groups.filter((g) => g.id !== groupId);
    const nextLayout = state.layout.filter((r) => !(r.type === "group" && r.id === groupId));
    await deps.setState({ ...state, groups: nextGroups, layout: nextLayout });
    debug("Group deleted", { groupId });
    deps.scheduleAutosave();
    await deps.render();
  } catch (err) {
    error("Failed to delete group", { groupId, error: err });
  }
}

/** @param {GroupDeps} deps */
export async function addItemToGroup(deps, groupId, itemId) {
  if (typeof groupId !== "string" || typeof itemId !== "string") return;
  try {
    const state = deps.getState();
    const idx = state.groups.findIndex((g) => g.id === groupId);
    if (idx === -1) return;
    const group = state.groups[idx];
    if (group.itemIds.includes(itemId)) return;
    const nextGroups = [...state.groups];
    nextGroups[idx] = { ...group, itemIds: [...group.itemIds, itemId] };
    await deps.setState({ ...state, groups: nextGroups });
    debug("Item added to group", { groupId, itemId });
    deps.scheduleAutosave();
    await deps.render();
  } catch (err) {
    error("Failed to add item to group", { groupId, itemId, error: err });
  }
}

/** @param {GroupDeps} deps */
export async function removeItemFromGroup(deps, groupId, itemId) {
  if (typeof groupId !== "string" || typeof itemId !== "string") return;
  try {
    const state = deps.getState();
    const idx = state.groups.findIndex((g) => g.id === groupId);
    if (idx === -1) return;
    const group = state.groups[idx];
    const nextGroups = [...state.groups];
    nextGroups[idx] = { ...group, itemIds: group.itemIds.filter((id) => id !== itemId) };
    await deps.setState({ ...state, groups: nextGroups });
    debug("Item removed from group", { groupId, itemId });
    deps.scheduleAutosave();
    await deps.render();
  } catch (err) {
    error("Failed to remove item from group", { groupId, itemId, error: err });
  }
}

/** @param {GroupDeps} deps */
export async function reorderGroupItems(deps, groupId, sourceItemId, targetItemId, placeAfter) {
  if (typeof groupId !== "string" || typeof sourceItemId !== "string" || typeof targetItemId !== "string") return;
  if (sourceItemId === targetItemId) return;
  try {
    const state = deps.getState();
    const idx = state.groups.findIndex((g) => g.id === groupId);
    if (idx === -1) return;
    const group = state.groups[idx];
    const itemIds = [...group.itemIds];
    const srcIdx = itemIds.indexOf(sourceItemId);
    const tgtIdx = itemIds.indexOf(targetItemId);
    if (srcIdx === -1 || tgtIdx === -1) return;
    const [moved] = itemIds.splice(srcIdx, 1);
    const nextTgtIdx = itemIds.indexOf(targetItemId);
    itemIds.splice(placeAfter ? nextTgtIdx + 1 : nextTgtIdx, 0, moved);
    const nextGroups = [...state.groups];
    nextGroups[idx] = { ...group, itemIds };
    await deps.setState({ ...state, groups: nextGroups });
    debug("Group items reordered", { groupId, sourceItemId, targetItemId, placeAfter });
    deps.scheduleAutosave();
    await deps.render();
  } catch (err) {
    error("Failed to reorder group items", { groupId, error: err });
  }
}

/** @param {GroupDeps} deps */
export async function reorderLayout(deps, sourceId, targetId, placeAfter) {
  if (typeof sourceId !== "string" || typeof targetId !== "string") return;
  if (sourceId === targetId) return;
  try {
    const state = deps.getState();
    const layout = [...state.layout];
    const srcIdx = layout.findIndex((r) => r.id === sourceId);
    const tgtIdx = layout.findIndex((r) => r.id === targetId);
    if (srcIdx === -1 || tgtIdx === -1) return;
    const [moved] = layout.splice(srcIdx, 1);
    const nextTgtIdx = layout.findIndex((r) => r.id === targetId);
    layout.splice(placeAfter ? nextTgtIdx + 1 : nextTgtIdx, 0, moved);
    await deps.setState({ ...state, layout });
    debug("Layout reordered", { sourceId, targetId, placeAfter });
    deps.scheduleAutosave();
    await deps.render();
  } catch (err) {
    error("Failed to reorder layout", { sourceId, error: err });
  }
}

/**
 * @param {object} state  soundboard state
 * @param {string} groupId
 * @returns {object|null}
 */
export function getGroupById(state, groupId) {
  return state.groups.find((g) => g.id === groupId) ?? null;
}

/**
 * @param {object} state  soundboard state
 * @param {string} groupId
 * @returns {object[]}
 */
export function getItemsForGroup(state, groupId) {
  const group = state.groups.find((g) => g.id === groupId);
  if (!group) return [];
  return group.itemIds.map((id) => state.items.find((item) => item.id === id)).filter(Boolean);
}

// ── private ──

function _newGroup(itemIds, nameOverride) {
  return {
    id: `group_${foundry.utils.randomID()}`,
    name: nameOverride ?? game.i18n.localize("SIMONE_GM_PANEL.Soundboard.NewGroup"),
    itemIds,
    mode: "sequential",
    avoidImmediateRepeat: true,
    repeat: true,
    offsetMin: 1000,
    offsetMax: 4000,
    perTokenDesync: false,
    volumeMode: "item",
    positional: {},
    expanded: true,
  };
}
