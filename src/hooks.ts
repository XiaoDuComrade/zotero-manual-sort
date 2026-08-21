declare const addon: import("./addon").Addon;

async function onStartup(): Promise<void> {
  // bootstrap.js has already awaited initializationPromise. Do not wait for
  // uiReadyPromise here: with many installed plugins it can resolve long after
  // the main window and item tree are usable. registerWindow() already retries
  // briefly when the tree has not mounted yet, and onMainWindowLoad covers
  // windows created after startup.
  addon.controller.start();
}

async function onMainWindowLoad(win: Window): Promise<void> {
  addon.controller.registerWindow(win);
}

async function onMainWindowUnload(win: Window): Promise<void> {
  addon.controller.unregisterWindow(win);
}

async function onShutdown(): Promise<void> {
  addon.controller.stop();
  addon.alive = false;
  delete (Zotero as any).ManualSort;
}

export default { onStartup, onMainWindowLoad, onMainWindowUnload, onShutdown };
