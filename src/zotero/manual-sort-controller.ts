import { reorderByDrop, orderTreeRowGroups, topLevelItemIDs, type DropPlacement } from "../core/reorder";
import { CollectionOrderStore } from "./collection-order-store";
import { CollectionTreeSorter } from "./collection-tree-sorter";

interface DragState {
  collectionID: number;
  draggedIDs: number[];
  placement: DropPlacement;
}

interface InstalledMenu {
  menu: Element;
  restore: HTMLElement;
  saveCurrent: HTMLElement;
  onPopupShowing: EventListener;
  onRestore: EventListener;
  onSaveCurrent: EventListener;
}

interface TreePatch {
  win: any;
  tree: any;
  manualActive: boolean;
  drag?: DragState;
  original: {
    sort: (...args: any[]) => any;
    changeCollectionTreeRow: (...args: any[]) => any;
    onDragStart: (...args: any[]) => any;
    onDragOver: (...args: any[]) => any;
    onDrop: (...args: any[]) => any;
    onDragEnd: (...args: any[]) => any;
  };
  onHeaderClick: EventListener;
  menu?: InstalledMenu;
}

export class ManualSortController {
  private started = false;
  private readonly patches = new Map<any, TreePatch>();
  private readonly pendingTimers = new Map<any, number>();
  private readonly store: CollectionOrderStore;
  private readonly collectionTreeSorter: CollectionTreeSorter;

  constructor(private readonly ports: any = {}) {
    const db = ports.db ?? this.zotero?.DB;
    this.store = ports.store ?? new CollectionOrderStore(db);
    this.collectionTreeSorter =
      ports.collectionTreeSorter ?? new CollectionTreeSorter(ports);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.collectionTreeSorter.start();
    for (const win of this.zotero?.getMainWindows?.() ?? []) {
      this.registerWindow(win);
    }
  }

  stop(): void {
    this.started = false;
    this.collectionTreeSorter.stop();
    for (const win of [...this.patches.keys(), ...this.pendingTimers.keys()]) {
      this.unregisterWindow(win);
    }
  }

  registerWindow(win: any): void {
    this.collectionTreeSorter.registerWindow(win);
    if (!win?.document || this.patches.has(win) || this.pendingTimers.has(win)) return;
    if (this.tryInstall(win)) return;
    this.scheduleInstall(win, 0);
  }

  unregisterWindow(win: any): void {
    this.collectionTreeSorter.unregisterWindow(win);
    const timer = this.pendingTimers.get(win);
    if (timer !== undefined) {
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

  async restoreManualOrder(win: any): Promise<void> {
    const patch = this.patches.get(win);
    if (!patch || !this.canShowManualOrder(patch)) return;
    patch.manualActive = true;
    await this.applyManualOrder(patch);
  }

  async saveCurrentOrder(win: any): Promise<void> {
    const patch = this.patches.get(win);
    if (!patch || !this.canReorder(patch)) return;
    const collectionID = this.collectionID(patch.tree);
    const ids = topLevelItemIDs(patch.tree._rows ?? []);
    await this.store.save(collectionID, ids);
    patch.manualActive = true;
    await this.applyManualOrder(patch);
    this.showProgress(win, "已保存当前显示顺序");
  }

  private tryInstall(win: any): boolean {
    const tree = win?.ZoteroPane?.itemsView;
    if (!tree || typeof tree.sort !== "function" || !tree.domEl) return false;

    const patch: TreePatch = {
      win,
      tree,
      manualActive: this.isCollectionView(tree),
      original: {
        sort: tree.sort,
        changeCollectionTreeRow: tree.changeCollectionTreeRow,
        onDragStart: tree.onDragStart,
        onDragOver: tree.onDragOver,
        onDrop: tree.onDrop,
        onDragEnd: tree.onDragEnd,
      },
      onHeaderClick: () => undefined,
    };

    tree.sort = async (...args: any[]) => {
      if (patch.manualActive && this.canShowManualOrder(patch)) {
        await this.applyManualOrder(patch);
        return;
      }
      return patch.original.sort.apply(tree, args);
    };

    tree.changeCollectionTreeRow = async (...args: any[]) => {
      patch.manualActive = false;
      patch.drag = undefined;
      const result = await patch.original.changeCollectionTreeRow.apply(tree, args);
      patch.manualActive = this.isCollectionView(tree);
      if (patch.manualActive) await this.applyManualOrder(patch);
      return result;
    };

    tree.onDragStart = (event: DragEvent, index: number) => {
      const result = patch.original.onDragStart.call(tree, event, index);
      patch.drag = undefined;
      if (!this.canReorder(patch) || tree.getLevel?.(index) !== 0) return result;
      const draggedIDs = this.selectedTopLevelIDs(tree);
      if (!draggedIDs.length) return result;
      patch.drag = {
        collectionID: this.collectionID(tree),
        draggedIDs,
        placement: "after",
      };
      return result;
    };

    tree.onDragOver = (event: DragEvent, row: number) => {
      if (!this.isManualDrag(patch, row)) {
        return patch.original.onDragOver.call(tree, event, row);
      }
      patch.drag!.placement = row < 0 ? "end" : this.dropPlacement(event);
      this.consumeDragEvent(event);
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      this.showDropMarker(event, patch.drag!.placement);
      return false;
    };

    tree.onDrop = async (event: DragEvent, row: number) => {
      if (!this.isManualDrag(patch, row)) {
        return patch.original.onDrop.call(tree, event, row);
      }

      const drag = { ...patch.drag!, draggedIDs: [...patch.drag!.draggedIDs] };
      this.consumeDragEvent(event);
      this.removeDropMarkers(win.document);
      patch.drag = undefined;
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
        win?.alert?.(`保存手动顺序失败：${errorMessage(error)}`);
      }
      return false;
    };

    tree.onDragEnd = (...args: any[]) => {
      patch.drag = undefined;
      this.removeDropMarkers(win.document);
      return patch.original.onDragEnd.apply(tree, args);
    };

    patch.onHeaderClick = (event: Event) => {
      const target = event.target as Element | null;
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

  private scheduleInstall(win: any, attempt: number): void {
    if (!this.started || attempt >= 40 || typeof win?.setTimeout !== "function") return;
    const timer = win.setTimeout(() => {
      this.pendingTimers.delete(win);
      if (!this.tryInstall(win)) this.scheduleInstall(win, attempt + 1);
    }, 100);
    this.pendingTimers.set(win, timer);
  }

  private async applyManualOrder(patch: TreePatch): Promise<void> {
    if (!this.canShowManualOrder(patch)) return;
    const collectionID = this.collectionID(patch.tree);
    const orderedIDs = await this.store.load(collectionID);
    if (!patch.manualActive || collectionID !== this.collectionID(patch.tree)) return;
    patch.tree._rows = orderTreeRowGroups(patch.tree._rows ?? [], orderedIDs);
    patch.tree._refreshRowMap?.();
    patch.tree._rowCache = {};
    patch.tree.tree?.invalidate?.();
  }

  private selectedTopLevelIDs(tree: any): number[] {
    return (tree._rows ?? [])
      .map((row: any, index: number) => ({ row, index }))
      .filter(({ row, index }: any) => row.level === 0 && tree.selection?.isSelected?.(index))
      .map(({ row }: any) => row.ref?.id)
      .filter((id: unknown): id is number => Number.isInteger(id));
  }

  private isManualDrag(patch: TreePatch, row: number): boolean {
    if (!patch.drag || !this.canReorder(patch)) return false;
    if (patch.drag.collectionID !== this.collectionID(patch.tree)) return false;
    return row < 0 || patch.tree.getLevel?.(row) === 0;
  }

  private isCollectionView(tree: any): boolean {
    return !!tree?.collectionTreeRow?.isCollection?.();
  }

  private canShowManualOrder(patch: TreePatch): boolean {
    if (!this.isCollectionView(patch.tree)) return false;
    return !this.zotero?.Prefs?.get?.("recursiveCollections");
  }

  private canReorder(patch: TreePatch): boolean {
    if (!this.canShowManualOrder(patch)) return false;
    if (patch.tree.collectionTreeRow?.editable === false) return false;
    return !this.quickSearchValue(patch.win);
  }

  private collectionID(tree: any): number {
    return Number(tree?.collectionTreeRow?.ref?.id ?? 0);
  }

  private quickSearchValue(win: any): string {
    const search = win?.document?.getElementById?.("zotero-tb-search") as any;
    return String(search?.value ?? search?.searchTextbox?.value ?? "").trim();
  }

  private rowItemID(tree: any, row: number): number | null {
    const value = tree.getRow?.(row)?.ref?.id;
    return Number.isInteger(value) ? value : null;
  }

  private dropPlacement(event: DragEvent): DropPlacement {
    const target = event.currentTarget as Element | null;
    const rect = target?.getBoundingClientRect?.();
    if (!rect || !rect.height) return "after";
    return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  }

  private consumeDragEvent(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  private showDropMarker(event: DragEvent, placement: DropPlacement): void {
    const doc = (event.currentTarget as Element | null)?.ownerDocument;
    if (!doc) return;
    this.removeDropMarkers(doc);
    if (placement === "end") return;
    const target = event.currentTarget as Element | null;
    if (!target?.appendChild) return;
    const marker = doc.createElement("span");
    marker.className = `zms-drop-marker ${placement === "before" ? "drop-before" : "drop-after"}`;
    marker.setAttribute("aria-hidden", "true");
    target.appendChild(marker);
  }

  private removeDropMarkers(doc: Document): void {
    doc.querySelectorAll?.(".zms-drop-marker").forEach((node) => node.remove());
  }

  private clearZoteroDragState(): void {
    if (!this.zotero?.DragDrop) return;
    this.zotero.DragDrop.currentDragSource = null;
    this.zotero.DragDrop.currentOrientation = 0;
  }

  private installCollectionMenu(win: any): InstalledMenu | undefined {
    const doc = win.document as Document;
    const menu = doc.getElementById?.("zotero-collectionmenu");
    if (!menu) return undefined;
    doc.querySelectorAll("#zms-restore-manual-order,#zms-save-current-order").forEach((node) => node.remove());

    const restore = this.createMenuItem(doc, "zms-restore-manual-order", "按手动顺序显示");
    const saveCurrent = this.createMenuItem(doc, "zms-save-current-order", "将当前显示顺序保存为手动顺序");
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

  private removeMenu(menu?: InstalledMenu): void {
    if (!menu) return;
    menu.menu.removeEventListener("popupshowing", menu.onPopupShowing);
    menu.restore.removeEventListener("command", menu.onRestore);
    menu.saveCurrent.removeEventListener("command", menu.onSaveCurrent);
    menu.restore.remove();
    menu.saveCurrent.remove();
  }

  private createMenuItem(doc: Document, id: string, label: string): HTMLElement {
    const createXul = (doc as any).createXULElement;
    const item = (createXul ? createXul.call(doc, "menuitem") : doc.createElement("menuitem")) as HTMLElement;
    item.id = id;
    item.textContent = label;
    item.setAttribute("label", label);
    return item;
  }

  private showProgress(win: any, message: string): void {
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

  private async runMenuAction(win: any, action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.logError("Collection menu command failed", error);
      win?.alert?.(`手动排序操作失败：${errorMessage(error)}`);
    }
  }

  private logError(message: string, error: unknown): void {
    this.zotero?.debug?.(`[Manual Sort] ${message}: ${errorMessage(error)}`);
  }

  private get zotero(): any {
    return this.ports.zotero ?? (globalThis as any).Zotero;
  }
}

function setHidden(item: HTMLElement, hidden: boolean): void {
  item.hidden = hidden;
  item.toggleAttribute("hidden", hidden);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
