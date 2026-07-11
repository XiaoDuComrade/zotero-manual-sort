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
    [["content", "manualsort", rootURI + "content/"]],
  );

  const context = { rootURI };
  context._globalThis = context;
  Services.scriptloader.loadSubScript(
    rootURI + "content/scripts/manualsort.js",
    context,
  );

  await Zotero.ManualSort.hooks.onStartup();
}

function onMainWindowLoad({ window }) {
  return Zotero.ManualSort?.hooks.onMainWindowLoad(window);
}

function onMainWindowUnload({ window }) {
  return Zotero.ManualSort?.hooks.onMainWindowUnload(window);
}

function shutdown({ rootURI }, reason) {
  if (reason === APP_SHUTDOWN) return;
  Zotero.ManualSort?.hooks.onShutdown();
  if (typeof Cu.unload === "function") {
    Cu.unload(rootURI + "content/scripts/manualsort.js");
  }
  chromeHandle?.destruct();
  chromeHandle = undefined;
}

function uninstall() {}
