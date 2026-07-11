/* eslint-disable no-undef */

var chromeHandle;

function install() {}

async function startup({ resourceURI, rootURI }) {
  await Zotero.initializationPromise;
  rootURI ||= resourceURI.spec;

  const startupService = Components.classes[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Components.interfaces.amIAddonManagerStartup);

  chromeHandle = startupService.registerChrome(
    Services.io.newURI(rootURI + "manifest.json"),
    [["content", "__addonRef__", rootURI + "content/"]],
  );

  const context = { rootURI };
  context._globalThis = context;
  Services.scriptloader.loadSubScript(
    rootURI + "content/scripts/__addonRef__.js",
    context,
  );

  await Zotero.__addonInstance__.hooks.onStartup();
}

function onMainWindowLoad({ window }) {
  return Zotero.__addonInstance__?.hooks.onMainWindowLoad(window);
}

function onMainWindowUnload({ window }) {
  return Zotero.__addonInstance__?.hooks.onMainWindowUnload(window);
}

function shutdown({ rootURI }, reason) {
  if (reason === APP_SHUTDOWN) return;
  Zotero.__addonInstance__?.hooks.onShutdown();
  if (typeof Cu.unload === "function") {
    Cu.unload(rootURI + "content/scripts/__addonRef__.js");
  }
  chromeHandle?.destruct();
  chromeHandle = undefined;
}

function uninstall() {}
