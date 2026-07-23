import { debug, error } from "../debug.js";

/**
 * @class GmPanelTokenController
 *
 * Manages selected token tracking and token-related UI (pan, hooks).
 * The controller receives a reference to the parent SimoneGmPanelApp so it can
 * call {@link ApplicationV2#render}.
 */
export class GmPanelTokenController {
  /** @type {import("./gm-panel-app.js").SimoneGmPanelApp} */
  #app;

  /** @type {Array<{uuid: string, name: string, img: string}>} */
  #selectedTokens = [];

  #boundControlToken = (...args) => this.#onControlToken(...args);
  #debouncedRefreshTokens;

  /**
   * @param {import("./gm-panel-app.js").SimoneGmPanelApp} app
   */
  constructor(app) {
    this.#app = app;
    this.#debouncedRefreshTokens = foundry.utils.debounce(() => {
      void this.refresh();
    }, 100);
  }

  // ── Public getters ──────────────────────────────────────────────

  get selectedTokens() { return this.#selectedTokens; }

  // ── Lifecycle ──────────────────────────────────────────────────

  activate() {
    Hooks.on("controlToken", this.#boundControlToken);
    this.#selectedTokens = this.collect();
  }

  deactivate() {
    Hooks.off("controlToken", this.#boundControlToken);
  }

  // ── Public API ─────────────────────────────────────────────────

  /** Collect selected tokens from canvas. */
  collect() {
    try {
      const controlled = canvas?.tokens?.controlled;
      if (!Array.isArray(controlled)) return [];
      return controlled.map((token) => ({
        uuid: token.document?.uuid ?? "",
        name: token.actor?.name ?? token.document?.name ?? "",
        img: token.document?.texture?.src ?? "",
      }));
    } catch {
      return [];
    }
  }

  /** Re-collect selected tokens and re-render the panel. */
  async refresh() {
    this.#selectedTokens = this.collect();
    if (this.#app.rendered) await this.#app.render({ force: true });
  }

  /**
   * Pan canvas to a token by UUID.
   * @param {string} uuid
   */
  async panToToken(uuid) {
    const normalizedUuid = typeof uuid === "string" ? uuid.trim() : "";
    if (!normalizedUuid) return;
    try {
      const token = await foundry.utils.fromUuid(normalizedUuid);
      if (!token?.object) {
        ui.notifications?.warn(game.i18n.localize("SIMONE_GM_PANEL.Notifications.TokenNotFound"));
        return;
      }
      const center = token.object.center;
      await canvas.animatePan({ ...center, duration: 350 });
    } catch (err) {
      error("Failed to pan to token", { uuid, error: err });
    }
  }

  // ── Private: hook ──────────────────────────────────────────────

  #onControlToken() {
    this.#debouncedRefreshTokens();
  }
}
