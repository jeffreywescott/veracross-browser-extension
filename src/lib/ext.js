// Chrome and Safari both expose the WebExtension API; Safari prefers `browser`.
export const ext = globalThis.browser ?? globalThis.chrome ?? null;
export const inExtension = !!(ext && ext.runtime && ext.runtime.id);
