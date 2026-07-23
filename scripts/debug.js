let hostLogger = null;

export function configureLogger(logger) {
  hostLogger = logger && typeof logger === "object" ? logger : null;
}

export function isDebugEnabled() {
  return hostLogger?.isDebugEnabled?.() === true;
}

export function debug(message, payload) {
  hostLogger?.debug?.(message, payload);
}

export function warn(message, payload) {
  if (hostLogger?.warn) return hostLogger.warn(message, payload);
  if (payload === undefined) console.warn(`simone-gm-panel-sounds | ${message}`);
  else console.warn(`simone-gm-panel-sounds | ${message}`, payload);
}

export function error(message, payload) {
  if (hostLogger?.error) return hostLogger.error(message, payload);
  if (payload === undefined) console.error(`simone-gm-panel-sounds | ${message}`);
  else console.error(`simone-gm-panel-sounds | ${message}`, payload);
}
