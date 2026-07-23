/**
 * Dialog/prompt helpers for the GM Panel — extracted from gm-panel-app.js
 * to keep the main class focused on UI orchestration.
 */

/**
 * Open a simple text input dialog and return the entered value (or null if cancelled).
 */
export async function promptTextInput({ title, defaultValue = "", placeholder = "", okLabel }) {
  const { DialogV2 } = foundry.applications.api;
  const escapedDefault = defaultValue.replace(/"/g, "&quot;");
  return new Promise((resolve) => {
    let resolved = false;
    const dialog = new DialogV2({
      title,
      content: `<input type="text" value="${escapedDefault}" placeholder="${placeholder.replace(/"/g, "&quot;")}" autofocus>`,
      buttons: [
        {
          action: "ok",
          label: okLabel ?? game.i18n.localize("OK"),
          default: true,
          callback: () => {
            if (resolved) return;
            resolved = true;
            const input = dialog.element?.querySelector("input");
            const val = (input instanceof HTMLInputElement ? input.value : "")?.trim();
            resolve(val || null);
          },
        },
        { action: "cancel", label: game.i18n.localize("Cancel") },
      ],
      close: () => {
        if (!resolved) { resolved = true; resolve(null); }
      },
      modal: true,
      rejectClose: false,
    });
    dialog.render({ force: true });
  });
}
