// SPDX-License-Identifier: GPL-3.0-or-later
// Wait for custom-element registration AND X_ITE's own initialization barrier.
// getBrowser() before that barrier was the v1 cold-load failure.
export async function withTimeout(promise, ms, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function connectRenderer({
  canvas,
  runtime = window.X3D,
  registry = customElements,
  timeoutMs = 20000,
}) {
  if (!runtime || typeof runtime.getBrowser !== "function") {
    throw new Error(
      "The local X_ITE runtime did not load. Serve the repository docs folder over HTTP.",
    );
  }
  return withTimeout(
    (async () => {
      await registry.whenDefined("x3d-canvas");
      if (typeof runtime === "function") await runtime();
      const browser = runtime.getBrowser(canvas);
      if (!browser || typeof browser.loadURL !== "function") {
        throw new Error(
          "X_ITE could not create a WebGL browser. Analytical instruments remain available.",
        );
      }
      return browser;
    })(),
    timeoutMs,
    "The local X3D renderer did not initialize within the time limit.",
  );
}
