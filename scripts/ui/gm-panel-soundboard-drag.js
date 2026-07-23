/**
 * Soundboard drag-and-drop and row-expand listeners.
 * Unified DnD system using grip handles with clean branch logic.
 *
 * All state flows through explicit callbacks — no private fields accessed.
 */

import { MAP_DROP_MIME, buildSoundboardItemDragData } from "./gm-panel-map-drop.js";

/**
 * Attach row click listeners for expand/collapse toggle on item rows
 * AND group rows. Ignores clicks on buttons/links/actions.
 *
 * @param {HTMLElement} element - GM Panel root element
 * @param {{ toggleRowExpand: (uuid: string) => void, toggleGroupExpand: (groupId: string) => void }} callbacks
 * @param {(fn: () => void) => void} addCleanup
 */
export function attachRowExpandListeners(element, { toggleRowExpand, toggleGroupExpand }, addCleanup) {
  // Item rows
  const itemRows = element.querySelectorAll('[data-testid="sgmp-sound-row"][data-row-type="item"]');
  for (const row of itemRows) {
    if (!(row instanceof HTMLElement)) continue;
    const onRowClick = (event) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('button, a, [data-action]')) return;
      const uuid = row.dataset.soundUuid;
      if (uuid) toggleRowExpand(uuid);
    };
    row.addEventListener("click", onRowClick);
    addCleanup(() => row.removeEventListener("click", onRowClick));
  }

  // Group rows
  const groupRows = element.querySelectorAll('[data-row-type="group"]');
  for (const row of groupRows) {
    if (!(row instanceof HTMLElement)) continue;
    const onRowClick = (event) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('button, a, [data-action]')) return;
      const groupId = row.dataset.groupId;
      if (groupId) toggleGroupExpand(groupId);
    };
    row.addEventListener("click", onRowClick);
    addCleanup(() => row.removeEventListener("click", onRowClick));
  }
}

/**
 * Unified drag-and-drop listener for soundboard rows.
 *
 * DnD contract:
 * - Top-level rows (item, group): have data-layout-id, data-row-type
 * - Member rows: have data-row-type="member", data-item-id, data-group-id (NO data-layout-id)
 * - All rows: drag starts ONLY from grip handle with data-action="drag-sound"
 *
 * Branch logic (drop):
 * - member → member (same group): reorderGroupItems
 * - item/member → group row: addItemToGroup
 * - top-level → top-level: reorderLayout
 * - member → top-level: no-op
 *
 * @param {HTMLElement} element - GM Panel root element
 * @param {{ reorderLayout: (sourceId: string, targetId: string, after: boolean) => void, addItemToGroup: (groupId: string, itemId: string) => Promise<void>, reorderGroupItems: (groupId: string, sourceItemId: string, targetItemId: string, after: boolean) => void }} callbacks
 * @param {(fn: () => void) => void} addCleanup
 */
export function attachDragRowListeners(element, { reorderLayout, addItemToGroup, reorderGroupItems }, addCleanup) {
  let draggedRowType = null;
  let draggedLayoutId = null;
  let draggedItemId = null;
  let draggedGroupId = null;

  // Shared state for dragstart — grip finds the row
  const onDragStartFromGrip = (event) => {
    const handle = event.target?.closest?.('[data-action="drag-sound"]');
    if (!handle) { event.preventDefault(); return; }

    // Find the enclosing row by data-row-type (works for all row types)
    const row = handle.closest('[data-row-type]');
    if (!(row instanceof HTMLElement) || !event.dataTransfer) { event.preventDefault(); return; }

    const rowType = row.dataset.rowType?.trim();
    const layoutId = row.dataset.layoutId?.trim();
    const itemId = row.dataset.itemId?.trim();
    const uuid = row.dataset.soundUuid?.trim();
    const groupId = row.dataset.groupId?.trim();

    // Members don't have layoutId — that's intentional
    if (rowType !== "member" && !layoutId) { event.preventDefault(); return; }

    draggedRowType = rowType;
    draggedLayoutId = layoutId || null;
    draggedItemId = itemId;
    draggedGroupId = groupId;

    if (row.classList) row.classList.add("is-dragging");
    element.classList.add("sgmp-is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", JSON.stringify({ type: "SGMPSoundboardRow", layoutId, rowType }));

    // Map-drop payload: items and members both use dropType "item"
    if (itemId && uuid) {
      const mapPayload = JSON.stringify(buildSoundboardItemDragData({ id: itemId, uuid }));
      event.dataTransfer.setData(MAP_DROP_MIME, mapPayload);
    }

    // Group context for canvas drop (group rows → dropType "group", members → "item")
    if (groupId) {
      const mapPayload = JSON.stringify({
        type: "SGMPSoundboardMapDrop",
        dropType: rowType === "group" ? "group" : "item",
        groupId,
        itemId: itemId || undefined,
        uuid: uuid || undefined,
      });
      event.dataTransfer.setData(MAP_DROP_MIME, mapPayload);
    }
  };

  // ── Top-level rows (item + group) ──
  const topRows = element.querySelectorAll('[data-row-type="item"], [data-row-type="group"]');
  for (const row of topRows) {
    if (!(row instanceof HTMLElement)) continue;

    row.addEventListener("dragstart", onDragStartFromGrip);

    const onDragOver = (event) => {
      if (!draggedLayoutId) return;
      const targetId = row.dataset.layoutId?.trim();
      if (!targetId || targetId === draggedLayoutId) return;
      event.preventDefault();
      const rect = row.getBoundingClientRect();
      const placeAfter = event.clientY > rect.top + rect.height / 2;
      row.classList.toggle("is-drop-before", !placeAfter);
      row.classList.toggle("is-drop-after", placeAfter);
    };

    const onDragLeave = (event) => {
      if (event.currentTarget !== row) return;
      const relatedTarget = event.relatedTarget;
      if (relatedTarget instanceof Node && row.contains(relatedTarget)) return;
      row.classList.remove("is-drop-before", "is-drop-after");
    };

    const onDrop = (event) => {
      if (!draggedLayoutId && draggedRowType !== "member") return;
      const targetId = row.dataset.layoutId?.trim();
      const targetRowType = row.dataset.rowType?.trim() ?? "";
      const targetGroupId = row.dataset.groupId?.trim() ?? "";
      if (!targetId || targetId === draggedLayoutId) return;

      event.preventDefault();
      event.stopPropagation();

      const rect = row.getBoundingClientRect();
      const placeAfter = event.clientY > rect.top + rect.height / 2;
      row.classList.remove("is-drop-before", "is-drop-after");

      // Member → group row: add to group
      if (targetRowType === "group" && draggedRowType === "member" && targetGroupId && draggedItemId) {
        void addItemToGroup(targetGroupId, draggedItemId);
        return;
      }

      // Item → group row: add to group
      if (targetRowType === "group" && draggedRowType === "item" && targetGroupId && draggedItemId) {
        void addItemToGroup(targetGroupId, draggedItemId);
        return;
      }

      // Top-level → top-level: reorder layout
      if (draggedLayoutId && (draggedRowType === "item" || draggedRowType === "group")) {
        void reorderLayout(draggedLayoutId, targetId, placeAfter);
        return;
      }

      // Member → top-level: no-op
    };

    row.addEventListener("dragover", onDragOver);
    row.addEventListener("dragleave", onDragLeave);
    row.addEventListener("drop", onDrop);
    addCleanup(() => row.removeEventListener("dragstart", onDragStartFromGrip));
    addCleanup(() => row.removeEventListener("dragover", onDragOver));
    addCleanup(() => row.removeEventListener("dragleave", onDragLeave));
    addCleanup(() => row.removeEventListener("drop", onDrop));
  }

  // ── Member rows ──
  const memberRows = element.querySelectorAll('[data-row-type="member"]');
  for (const row of memberRows) {
    if (!(row instanceof HTMLElement)) continue;

    row.addEventListener("dragstart", onDragStartFromGrip);

    const onDragOverMember = (event) => {
      if (!draggedItemId || draggedRowType !== "member") return;
      const targetItemId = row.dataset.itemId?.trim();
      const targetGroupId = row.dataset.groupId?.trim();
      if (!targetItemId || !targetGroupId || targetItemId === draggedItemId) return;
      if (draggedGroupId !== targetGroupId) return;

      event.preventDefault();
      const rect = row.getBoundingClientRect();
      const placeAfter = event.clientY > rect.top + rect.height / 2;
      row.classList.toggle("is-drop-before", !placeAfter);
      row.classList.toggle("is-drop-after", placeAfter);
    };

    const onDragLeaveMember = (event) => {
      if (event.currentTarget !== row) return;
      const relatedTarget = event.relatedTarget;
      if (relatedTarget instanceof Node && row.contains(relatedTarget)) return;
      row.classList.remove("is-drop-before", "is-drop-after");
    };

    const onDropMember = (event) => {
      if (!draggedItemId || draggedRowType !== "member") return;
      const targetItemId = row.dataset.itemId?.trim();
      const targetGroupId = row.dataset.groupId?.trim();
      if (!targetItemId || !targetGroupId || targetItemId === draggedItemId) return;
      if (draggedGroupId !== targetGroupId) return;

      event.preventDefault();
      event.stopPropagation();

      const rect = row.getBoundingClientRect();
      const placeAfter = event.clientY > rect.top + rect.height / 2;
      row.classList.remove("is-drop-before", "is-drop-after");

      void reorderGroupItems(targetGroupId, draggedItemId, targetItemId, placeAfter);
    };

    row.addEventListener("dragover", onDragOverMember);
    row.addEventListener("dragleave", onDragLeaveMember);
    row.addEventListener("drop", onDropMember);
    addCleanup(() => row.removeEventListener("dragstart", onDragStartFromGrip));
    addCleanup(() => row.removeEventListener("dragover", onDragOverMember));
    addCleanup(() => row.removeEventListener("dragleave", onDragLeaveMember));
    addCleanup(() => row.removeEventListener("drop", onDropMember));
  }

  // ── Global dragend cleanup ──
  const onGlobalDragEnd = () => {
    draggedRowType = null;
    draggedLayoutId = null;
    draggedItemId = null;
    draggedGroupId = null;
    element.classList.remove("sgmp-is-dragging");
    const rows = element.querySelectorAll('[data-row-type]');
    for (const candidate of rows) {
      if (candidate instanceof HTMLElement) candidate.classList.remove("is-dragging", "is-drop-before", "is-drop-after");
    }
  };
  document.addEventListener("dragend", onGlobalDragEnd);
  addCleanup(() => document.removeEventListener("dragend", onGlobalDragEnd));
}
