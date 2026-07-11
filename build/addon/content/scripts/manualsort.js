"use strict";
(() => {
  // package.json
  var config = {
    addonName: "Manual Sort for Zotero",
    addonID: "manual-sort@local.zotero",
    addonRef: "manualsort",
    addonInstance: "ManualSort"
  };

  // src/hooks.ts
  async function onStartup() {
    await Promise.all([
      Zotero.initializationPromise,
      Zotero.unlockPromise,
      Zotero.uiReadyPromise
    ]);
    addon.controller.start();
  }
  async function onMainWindowLoad(win) {
    addon.controller.registerWindow(win);
  }
  async function onMainWindowUnload(win) {
    addon.controller.unregisterWindow(win);
  }
  async function onShutdown() {
    addon.controller.stop();
    addon.alive = false;
    delete Zotero.ManualSort;
  }
  var hooks_default = { onStartup, onMainWindowLoad, onMainWindowUnload, onShutdown };

  // src/core/reorder.ts
  function reorderByDrop(currentOrder, draggedIDs, targetID, placement) {
    const current = uniqueIntegers(currentOrder);
    const currentSet = new Set(current);
    const dragged = uniqueIntegers(draggedIDs).filter((id) => currentSet.has(id));
    if (!dragged.length) return current;
    const draggedSet = new Set(dragged);
    if (targetID !== null && draggedSet.has(targetID)) return current;
    const remaining = current.filter((id) => !draggedSet.has(id));
    let insertionIndex = remaining.length;
    if (targetID !== null && placement !== "end") {
      const targetIndex = remaining.indexOf(targetID);
      if (targetIndex >= 0) {
        insertionIndex = targetIndex + (placement === "after" ? 1 : 0);
      }
    }
    return [
      ...remaining.slice(0, insertionIndex),
      ...dragged,
      ...remaining.slice(insertionIndex)
    ];
  }
  function topLevelItemIDs(rows) {
    return rows.filter((row) => row.level === 0 && Number.isInteger(row.ref?.id)).map((row) => row.ref.id);
  }
  function orderTreeRowGroups(rows, orderedItemIDs) {
    if (!rows.length) return [];
    const groups = [];
    for (const row of rows) {
      if (row.level === 0 || !groups.length) {
        groups.push([row]);
      } else {
        groups[groups.length - 1].push(row);
      }
    }
    const rank = new Map(uniqueIntegers(orderedItemIDs).map((id, index) => [id, index]));
    return groups.map((group, originalIndex) => ({
      group,
      originalIndex,
      rank: rank.get(group[0].ref?.id ?? -1) ?? Number.MAX_SAFE_INTEGER
    })).sort((a, b) => a.rank - b.rank || a.originalIndex - b.originalIndex).flatMap(({ group }) => group);
  }
  function uniqueIntegers(values) {
    return [...new Set(values.filter((value) => Number.isInteger(value) && value > 0))];
  }

  // src/zotero/collection-order-store.ts
  var CollectionOrderStore = class {
    constructor(db) {
      this.db = db;
    }
    async load(collectionID) {
      requirePositiveInteger(collectionID, "collectionID");
      const result = await this.db.queryAsync(
        "SELECT itemID FROM collectionItems WHERE collectionID=? ORDER BY orderIndex, itemID",
        [collectionID]
      );
      if (!Array.isArray(result)) return [];
      return result.map((row) => itemIDFromRow(row)).filter(
        (id) => typeof id === "number" && Number.isInteger(id) && id > 0
      );
    }
    async save(collectionID, orderedItemIDs) {
      requirePositiveInteger(collectionID, "collectionID");
      const unique = [...new Set(orderedItemIDs)];
      if (unique.length !== orderedItemIDs.length || unique.some((itemID) => !Number.isInteger(itemID) || itemID <= 0)) {
        throw new Error("orderedItemIDs must contain unique positive integers");
      }
      await this.db.executeTransaction(async () => {
        for (let orderIndex = 0; orderIndex < unique.length; orderIndex += 1) {
          await this.db.queryAsync(
            "UPDATE collectionItems SET orderIndex=? WHERE collectionID=? AND itemID=?",
            [orderIndex, collectionID, unique[orderIndex]]
          );
        }
      });
    }
  };
  function itemIDFromRow(row) {
    if (typeof row === "number") return row;
    if (!row || typeof row !== "object") return void 0;
    const value = row.itemID;
    return typeof value === "number" ? value : Number(value);
  }
  function requirePositiveInteger(value, name) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive integer`);
    }
  }

  // src/zotero/manual-sort-controller.ts
  var ManualSortController = class {
    constructor(ports = {}) {
      this.ports = ports;
      const db = ports.db ?? this.zotero?.DB;
      this.store = ports.store ?? new CollectionOrderStore(db);
    }
    started = false;
    patches = /* @__PURE__ */ new Map();
    pendingTimers = /* @__PURE__ */ new Map();
    store;
    start() {
      if (this.started) return;
      this.started = true;
      for (const win of this.zotero?.getMainWindows?.() ?? []) {
        this.registerWindow(win);
      }
    }
    stop() {
      this.started = false;
      for (const win of [...this.patches.keys(), ...this.pendingTimers.keys()]) {
        this.unregisterWindow(win);
      }
    }
    registerWindow(win) {
      if (!win?.document || this.patches.has(win) || this.pendingTimers.has(win)) return;
      if (this.tryInstall(win)) return;
      this.scheduleInstall(win, 0);
    }
    unregisterWindow(win) {
      const timer = this.pendingTimers.get(win);
      if (timer !== void 0) {
        win?.clearTimeout?.(timer);
        this.pendingTimers.delete(win);
      }
      const patch = this.patches.get(win);
      if (!patch) return;
      const { tree, original } = patch;
      tree.sort = original.sort;
      tree.changeCollectionTreeRow = original.changeCollectionTreeRow;
      tree.onDragStart = original.onDragStart;
      tree.onDragOver = original.onDragOver;
      tree.onDrop = original.onDrop;
      tree.onDragEnd = original.onDragEnd;
      tree.domEl?.removeEventListener?.("click", patch.onHeaderClick, true);
      this.removeDropMarkers(win.document);
      this.removeMenu(patch.menu);
      this.patches.delete(win);
    }
    async restoreManualOrder(win) {
      const patch = this.patches.get(win);
      if (!patch || !this.canShowManualOrder(patch)) return;
      patch.manualActive = true;
      await this.applyManualOrder(patch);
    }
    async saveCurrentOrder(win) {
      const patch = this.patches.get(win);
      if (!patch || !this.canReorder(patch)) return;
      const collectionID = this.collectionID(patch.tree);
      const ids = topLevelItemIDs(patch.tree._rows ?? []);
      await this.store.save(collectionID, ids);
      patch.manualActive = true;
      await this.applyManualOrder(patch);
      this.showProgress(win, "\u5DF2\u4FDD\u5B58\u5F53\u524D\u663E\u793A\u987A\u5E8F");
    }
    tryInstall(win) {
      const tree = win?.ZoteroPane?.itemsView;
      if (!tree || typeof tree.sort !== "function" || !tree.domEl) return false;
      const patch = {
        win,
        tree,
        manualActive: this.isCollectionView(tree),
        original: {
          sort: tree.sort,
          changeCollectionTreeRow: tree.changeCollectionTreeRow,
          onDragStart: tree.onDragStart,
          onDragOver: tree.onDragOver,
          onDrop: tree.onDrop,
          onDragEnd: tree.onDragEnd
        },
        onHeaderClick: () => void 0
      };
      tree.sort = async (...args) => {
        if (patch.manualActive && this.canShowManualOrder(patch)) {
          await this.applyManualOrder(patch);
          return;
        }
        return patch.original.sort.apply(tree, args);
      };
      tree.changeCollectionTreeRow = async (...args) => {
        patch.manualActive = false;
        patch.drag = void 0;
        const result = await patch.original.changeCollectionTreeRow.apply(tree, args);
        patch.manualActive = this.isCollectionView(tree);
        if (patch.manualActive) await this.applyManualOrder(patch);
        return result;
      };
      tree.onDragStart = (event, index) => {
        const result = patch.original.onDragStart.call(tree, event, index);
        patch.drag = void 0;
        if (!this.canReorder(patch) || tree.getLevel?.(index) !== 0) return result;
        const draggedIDs = this.selectedTopLevelIDs(tree);
        if (!draggedIDs.length) return result;
        patch.drag = {
          collectionID: this.collectionID(tree),
          draggedIDs,
          placement: "after"
        };
        return result;
      };
      tree.onDragOver = (event, row) => {
        if (!this.isManualDrag(patch, row)) {
          return patch.original.onDragOver.call(tree, event, row);
        }
        patch.drag.placement = row < 0 ? "end" : this.dropPlacement(event);
        this.consumeDragEvent(event);
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        this.showDropMarker(event, patch.drag.placement);
        return false;
      };
      tree.onDrop = async (event, row) => {
        if (!this.isManualDrag(patch, row)) {
          return patch.original.onDrop.call(tree, event, row);
        }
        const drag = { ...patch.drag, draggedIDs: [...patch.drag.draggedIDs] };
        this.consumeDragEvent(event);
        this.removeDropMarkers(win.document);
        patch.drag = void 0;
        patch.manualActive = true;
        try {
          const current = topLevelItemIDs(tree._rows ?? []);
          const targetID = row < 0 ? null : this.rowItemID(tree, row);
          const reordered = reorderByDrop(current, drag.draggedIDs, targetID, drag.placement);
          await this.store.save(drag.collectionID, reordered);
          await this.applyManualOrder(patch);
          await tree.selectItems?.(drag.draggedIDs, false, true);
          this.clearZoteroDragState();
        } catch (error) {
          this.logError("Could not save manual order", error);
          win?.alert?.(`\u4FDD\u5B58\u624B\u52A8\u987A\u5E8F\u5931\u8D25\uFF1A${errorMessage(error)}`);
        }
        return false;
      };
      tree.onDragEnd = (...args) => {
        patch.drag = void 0;
        this.removeDropMarkers(win.document);
        return patch.original.onDragEnd.apply(tree, args);
      };
      patch.onHeaderClick = (event) => {
        const target = event.target;
        if (target?.closest?.(".virtualized-table-header")) {
          patch.manualActive = false;
        }
      };
      tree.domEl.addEventListener("click", patch.onHeaderClick, true);
      patch.menu = this.installCollectionMenu(win);
      this.patches.set(win, patch);
      if (patch.manualActive) void this.applyManualOrder(patch);
      return true;
    }
    scheduleInstall(win, attempt) {
      if (!this.started || attempt >= 40 || typeof win?.setTimeout !== "function") return;
      const timer = win.setTimeout(() => {
        this.pendingTimers.delete(win);
        if (!this.tryInstall(win)) this.scheduleInstall(win, attempt + 1);
      }, 100);
      this.pendingTimers.set(win, timer);
    }
    async applyManualOrder(patch) {
      if (!this.canShowManualOrder(patch)) return;
      const collectionID = this.collectionID(patch.tree);
      const orderedIDs = await this.store.load(collectionID);
      if (!patch.manualActive || collectionID !== this.collectionID(patch.tree)) return;
      patch.tree._rows = orderTreeRowGroups(patch.tree._rows ?? [], orderedIDs);
      patch.tree._refreshRowMap?.();
      patch.tree._rowCache = {};
      patch.tree.tree?.invalidate?.();
    }
    selectedTopLevelIDs(tree) {
      return (tree._rows ?? []).map((row, index) => ({ row, index })).filter(({ row, index }) => row.level === 0 && tree.selection?.isSelected?.(index)).map(({ row }) => row.ref?.id).filter((id) => Number.isInteger(id));
    }
    isManualDrag(patch, row) {
      if (!patch.drag || !this.canReorder(patch)) return false;
      if (patch.drag.collectionID !== this.collectionID(patch.tree)) return false;
      return row < 0 || patch.tree.getLevel?.(row) === 0;
    }
    isCollectionView(tree) {
      return !!tree?.collectionTreeRow?.isCollection?.();
    }
    canShowManualOrder(patch) {
      if (!this.isCollectionView(patch.tree)) return false;
      return !this.zotero?.Prefs?.get?.("recursiveCollections");
    }
    canReorder(patch) {
      if (!this.canShowManualOrder(patch)) return false;
      if (patch.tree.collectionTreeRow?.editable === false) return false;
      return !this.quickSearchValue(patch.win);
    }
    collectionID(tree) {
      return Number(tree?.collectionTreeRow?.ref?.id ?? 0);
    }
    quickSearchValue(win) {
      const search = win?.document?.getElementById?.("zotero-tb-search");
      return String(search?.value ?? search?.searchTextbox?.value ?? "").trim();
    }
    rowItemID(tree, row) {
      const value = tree.getRow?.(row)?.ref?.id;
      return Number.isInteger(value) ? value : null;
    }
    dropPlacement(event) {
      const target = event.currentTarget;
      const rect = target?.getBoundingClientRect?.();
      if (!rect || !rect.height) return "after";
      return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    }
    consumeDragEvent(event) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    }
    showDropMarker(event, placement) {
      const doc = event.currentTarget?.ownerDocument;
      if (!doc) return;
      this.removeDropMarkers(doc);
      if (placement === "end") return;
      const target = event.currentTarget;
      if (!target?.appendChild) return;
      const marker = doc.createElement("span");
      marker.className = `zms-drop-marker ${placement === "before" ? "drop-before" : "drop-after"}`;
      marker.setAttribute("aria-hidden", "true");
      target.appendChild(marker);
    }
    removeDropMarkers(doc) {
      doc.querySelectorAll?.(".zms-drop-marker").forEach((node) => node.remove());
    }
    clearZoteroDragState() {
      if (!this.zotero?.DragDrop) return;
      this.zotero.DragDrop.currentDragSource = null;
      this.zotero.DragDrop.currentOrientation = 0;
    }
    installCollectionMenu(win) {
      const doc = win.document;
      const menu = doc.getElementById?.("zotero-collectionmenu");
      if (!menu) return void 0;
      doc.querySelectorAll("#zms-restore-manual-order,#zms-save-current-order").forEach((node) => node.remove());
      const restore = this.createMenuItem(doc, "zms-restore-manual-order", "\u6309\u624B\u52A8\u987A\u5E8F\u663E\u793A");
      const saveCurrent = this.createMenuItem(doc, "zms-save-current-order", "\u5C06\u5F53\u524D\u663E\u793A\u987A\u5E8F\u4FDD\u5B58\u4E3A\u624B\u52A8\u987A\u5E8F");
      const onPopupShowing = () => {
        const patch = this.patches.get(win);
        const visible = !!patch && this.canShowManualOrder(patch);
        setHidden(restore, !visible);
        setHidden(saveCurrent, !visible);
        saveCurrent.toggleAttribute("disabled", !patch || !this.canReorder(patch));
      };
      const onRestore = () => void this.runMenuAction(win, () => this.restoreManualOrder(win));
      const onSaveCurrent = () => void this.runMenuAction(win, () => this.saveCurrentOrder(win));
      restore.addEventListener("command", onRestore);
      saveCurrent.addEventListener("command", onSaveCurrent);
      menu.addEventListener("popupshowing", onPopupShowing);
      menu.appendChild(restore);
      menu.appendChild(saveCurrent);
      return { menu, restore, saveCurrent, onPopupShowing, onRestore, onSaveCurrent };
    }
    removeMenu(menu) {
      if (!menu) return;
      menu.menu.removeEventListener("popupshowing", menu.onPopupShowing);
      menu.restore.removeEventListener("command", menu.onRestore);
      menu.saveCurrent.removeEventListener("command", menu.onSaveCurrent);
      menu.restore.remove();
      menu.saveCurrent.remove();
    }
    createMenuItem(doc, id, label) {
      const createXul = doc.createXULElement;
      const item = createXul ? createXul.call(doc, "menuitem") : doc.createElement("menuitem");
      item.id = id;
      item.textContent = label;
      item.setAttribute("label", label);
      return item;
    }
    showProgress(win, message) {
      const ProgressWindow = this.zotero?.ProgressWindow;
      if (typeof ProgressWindow !== "function") return;
      try {
        const progress = new ProgressWindow({ window: win });
        progress.changeHeadline("Manual Sort for Zotero");
        progress.addDescription(message);
        progress.show();
        progress.startCloseTimer(1800);
      } catch (error) {
        this.logError("Could not show progress window", error);
      }
    }
    async runMenuAction(win, action) {
      try {
        await action();
      } catch (error) {
        this.logError("Collection menu command failed", error);
        win?.alert?.(`\u624B\u52A8\u6392\u5E8F\u64CD\u4F5C\u5931\u8D25\uFF1A${errorMessage(error)}`);
      }
    }
    logError(message, error) {
      this.zotero?.debug?.(`[Manual Sort] ${message}: ${errorMessage(error)}`);
    }
    get zotero() {
      return this.ports.zotero ?? globalThis.Zotero;
    }
  };
  function setHidden(item, hidden) {
    item.hidden = hidden;
    item.toggleAttribute("hidden", hidden);
  }
  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }

  // src/addon.ts
  var Addon = class {
    controller;
    hooks = hooks_default;
    alive = true;
    constructor() {
      this.controller = new ManualSortController();
    }
  };

  // src/index.ts
  var instance = new Addon();
  _globalThis.addon = instance;
  Zotero[config.addonInstance] = instance;
})();
