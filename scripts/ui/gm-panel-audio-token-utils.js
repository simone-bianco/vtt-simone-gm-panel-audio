/**
 * Shared token geometry utilities extracted from GmPanelAudioController
 * and GmPanelGroupAudioController to eliminate duplication.
 *
 * Both controllers had identical #getTokenDocumentCenter implementations.
 * The update-center variant (used for token movement) is also included.
 */

/**
 * Compute the canvas center of a token from its document data
 * (x, y, width, height) without relying on the canvas placeable,
 * which may be null or stale inside document hooks.
 *
 * @param {foundry.documents.TokenDocument} tokenDoc
 * @returns {{ x: number, y: number }}
 */
export function getTokenDocumentCenter(tokenDoc) {
  const gridSize = canvas.scene?.grid?.size ?? canvas.grid?.size ?? 100;
  const width = Number(tokenDoc.width ?? 1) * gridSize;
  const height = Number(tokenDoc.height ?? 1) * gridSize;
  return {
    x: Number(tokenDoc.x ?? 0) + width / 2,
    y: Number(tokenDoc.y ?? 0) + height / 2,
  };
}

/**
 * Compute token center for movement updates, preferring the
 * `change` diff (new destination) over `tokenDoc.x/y` which may
 * still reflect the previous position during movement/continuation.
 *
 * @param {foundry.documents.TokenDocument} tokenDoc
 * @param {object} [change={}]
 * @returns {{ x: number, y: number, elevation: number }}
 */
export function getTokenUpdateCenter(tokenDoc, change = {}) {
  const gridSize = canvas.scene?.grid?.size ?? canvas.grid?.size ?? 100;
  const width = Number(tokenDoc.width ?? 1) * gridSize;
  const height = Number(tokenDoc.height ?? 1) * gridSize;
  const x = Number(change.x ?? tokenDoc.x ?? 0);
  const y = Number(change.y ?? tokenDoc.y ?? 0);
  const elevation = Number(change.elevation ?? tokenDoc.elevation ?? 0);
  return { x: x + width / 2, y: y + height / 2, elevation };
}
