declare const addon: import("./addon").Addon;

async function onStartup(): Promise<void> {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);
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
