import {
  directCollectionKeys,
  reorderDirectCollectionSubtrees,
} from "../core/collection-tree-order";
import { reorderValuesByDrop, type DropPlacement } from "../core/reorder";
import { CollectionTreeOrderStore } from "./collection-tree-order-store";

interface CollectionDragState {
  sourceID: number;
  sourceKey: string;
  sourceRowID: string;
  libraryID: number;
  parentID: number | null;
  parentKey: string | null;
  targetID?: number;
  placement?: Exclude<DropPlacement, "end">;
}

interface CollectionTreePatch {
  win: any;
  tree: any;
  drag?: CollectionDragState;
  original: {
    expandRow: (...args: any[]) => any;
    addSortedRow?: (...args: any[]) => any;
    onDragStart: (...args: any[]) => any;
    onDragOver: (...args: any[]) => any;
    onDrop: (...args: any[]) => any;
    onDragEnd: (...args: any[]) => any;
  };
}

export class CollectionTreeSorter {
  private started = false;
  private readonly patches = new Map<any, CollectionTreePatch>();
  private readonly pendingTimers = new Map<any, number>();
  private readonly store: CollectionTreeOrderStore;

  constructor(private readonly ports: any = {}) {
    this.store =
      ports.collectionTreeStore ?? new CollectionTreeOrderStore(this.zotero?.Prefs);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    for (const win of this.zotero?.getMainWindows?.() ?? []) this.registerWindow(win);
  }

  stop(): void {
    this.started = false;
    for (const win of [...this.patches.keys(), ...this.pendingTimers.keys()]) {
      this.unregisterWindow(win);
    }
  }

  registerWindow(win: any): void {
    if (!win?.document || this.patches.has(win) || this.pendingTimers.has(win)) return;
    if (this.tryInstall(win)) return;
    this.scheduleInstall(win, 0);
  }

  unregisterWindow(win: any): void {
    const timer = this.pendingTimers.get(win);
    if (timer !== undefined) {
      win?.clearTimeout?.(timer);
      this.pendingTimers.delete(win);
    }

    const patch = this.patches.get(win);
    if (!patch) return;
    patch.tree._expandRow = patch.original.expandRow;
    if (patch.original.addSortedRow) patch.tree._addSortedRow = patch.original.addSortedRow;
    patch.tree.onDragStart = patch.original.onDragStart;
    patch.tree.onDragOver = patch.original.onDragOver;
    patch.tree.onDrop = patch.original.onDrop;
    patch.tree.onDragEnd = patch.original.onDragEnd;
    this.removeDropMarkers(win.document);
    this.patches.delete(win);
  }

  private tryInstall(win: any): boolean {
    const tree = win?.ZoteroPane?.collectionsView;
    if (
      !tree ||
      !tree.domEl ||
      typeof tree._expandRow !== "function" ||
      typeof tree.onDragStart !== "function" ||
      typeof tree.onDragOver !== "function" ||
      typeof tree.onDrop !== "function"
    ) {
      return false;
    }

    const patch: CollectionTreePatch = {
      win,
      tree,
      original: {
        expandRow: tree._expandRow,
        addSortedRow: typeof tree._addSortedRow === "function" ? tree._addSortedRow : undefined,
        onDragStart: tree.onDragStart,
        onDragOver: tree.onDragOver,
        onDrop: tree.onDrop,
        onDragEnd: tree.onDragEnd,
      },
    };

    tree._expandRow = async (...args: any[]) => {
      const result = await patch.original.expandRow.apply(tree, args);
      const rows = args[0] ?? tree._rows;
      const parentIndex = Number.isInteger(args[1]) ? args[1] : -1;
      if (parentIndex >= 0) this.applyOrderToParent(rows, parentIndex);
      return result;
    };

    if (patch.original.addSortedRow) {
      tree._addSortedRow = async (...args: any[]) => {
        const result = await patch.original.addSortedRow!.apply(tree, args);
        if (args[0] === "collection") {
          const rowIndex = this.rowIndexByID(tree, `C${args[1]}`);
          const row = rowIndex >= 0 ? tree.getRow?.(rowIndex) : null;
          if (row?.isCollection?.()) {
            const parentID = integerOrNull(row.ref?.parentID);
            const parentIndex = this.rowIndexByID(
              tree,
              parentID === null ? `L${row.ref.libraryID}` : `C${parentID}`,
            );
            if (parentIndex >= 0) {
              if (this.applyOrderToParent(tree._rows, parentIndex)) {
                tree._refreshRowMap?.();
                tree.tree?.invalidate?.();
              }
            }
          }
        }
        return result;
      };
    }

    tree.onDragStart = (event: DragEvent, index: number) => {
      const result = patch.original.onDragStart.call(tree, event, index);
      patch.drag = undefined;
      const row = tree.getRow?.(index);
      if (!this.canDragCollection(tree, row)) return result;
      const ref = row.ref;
      patch.drag = {
        sourceID: ref.id,
        sourceKey: ref.key,
        sourceRowID: String(row.id ?? `C${ref.id}`),
        libraryID: ref.libraryID,
        parentID: integerOrNull(ref.parentID),
        parentKey: stringOrNull(ref.parentKey),
      };
      return result;
    };

    tree.onDragOver = (event: DragEvent, index: number) => {
      const target = this.manualDropTarget(patch, event, index);
      if (!target) {
        if (patch.drag) {
          patch.drag.targetID = undefined;
          patch.drag.placement = undefined;
        }
        this.removeDropMarkers(win.document);
        return patch.original.onDragOver.call(tree, event, index);
      }

      patch.drag!.targetID = target.row.ref.id;
      patch.drag!.placement = target.placement;
      this.consumeDragEvent(event);
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      this.showDropMarker(event, target.placement);
      return false;
    };

    tree.onDrop = async (event: DragEvent, index: number) => {
      const target = this.manualDropTarget(patch, event, index);
      if (
        !target ||
        patch.drag?.targetID !== target.row.ref.id ||
        patch.drag?.placement !== target.placement
      ) {
        return patch.original.onDrop.call(tree, event, index);
      }

      const drag = { ...patch.drag } as CollectionDragState;
      this.consumeDragEvent(event);
      this.removeDropMarkers(win.document);
      patch.drag = undefined;

      try {
        const parentIndex = this.parentRowIndex(tree, drag);
        if (parentIndex < 0) return false;
        const current = directCollectionKeys(tree._rows ?? [], parentIndex);
        const reordered = reorderValuesByDrop(
          current,
          [drag.sourceKey],
          target.row.ref.key,
          target.placement,
        );
        this.store.save(drag.libraryID, drag.parentKey, reordered);
        this.applyOrderToParent(tree._rows, parentIndex);
        tree._refreshRowMap?.();
        tree.tree?.invalidate?.();
        const selectedIndex = this.rowIndexByID(tree, drag.sourceRowID);
        if (selectedIndex >= 0) {
          tree.selection?.select?.(selectedIndex);
          tree.ensureRowIsVisible?.(selectedIndex);
        }
        this.clearZoteroDragState();
      } catch (error) {
        this.logError("Could not save collection order", error);
        win?.alert?.(`保存分类手动顺序失败：${errorMessage(error)}`);
      }
      return false;
    };

    tree.onDragEnd = (...args: any[]) => {
      patch.drag = undefined;
      this.removeDropMarkers(win.document);
      return patch.original.onDragEnd.apply(tree, args);
    };

    this.patches.set(win, patch);
    this.applyAllOrders(tree);
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

  private applyAllOrders(tree: any): void {
    const rows = tree._rows;
    if (!Array.isArray(rows)) return;
    let changed = false;
    for (let index = 0; index < rows.length; index++) {
      if (this.parentScope(rows[index]) && this.applyOrderToParent(rows, index)) {
        changed = true;
      }
    }
    if (changed) {
      tree._refreshRowMap?.();
      tree.tree?.invalidate?.();
    }
  }

  private applyOrderToParent(rows: any[], parentIndex: number): boolean {
    const scope = this.parentScope(rows[parentIndex]);
    if (!scope) return false;
    const stored = this.store.load(scope.libraryID, scope.parentKey);
    if (!stored.length) return false;
    const reordered = reorderDirectCollectionSubtrees(rows, parentIndex, stored);
    if (reordered.every((row, index) => row === rows[index])) return false;
    rows.splice(0, rows.length, ...reordered);
    return true;
  }

  private parentScope(row: any): { libraryID: number; parentKey: string | null } | null {
    if (row?.isCollection?.()) {
      return {
        libraryID: Number(row.ref?.libraryID),
        parentKey: stringOrNull(row.ref?.key),
      };
    }
    if (row?.isLibrary?.(true)) {
      return { libraryID: Number(row.ref?.libraryID), parentKey: null };
    }
    return null;
  }

  private canDragCollection(tree: any, row: any): boolean {
    return (
      !!row?.isCollection?.() &&
      row.editable !== false &&
      Number.isInteger(row.ref?.id) &&
      typeof row.ref?.key === "string" &&
      Number.isInteger(row.ref?.libraryID) &&
      (typeof tree._isFilterEmpty !== "function" || tree._isFilterEmpty())
    );
  }

  private manualDropTarget(
    patch: CollectionTreePatch,
    event: DragEvent,
    index: number,
  ): { row: any; placement: "before" | "after" } | null {
    const drag = patch.drag;
    const row = patch.tree.getRow?.(index);
    const placement = this.collectionDropPlacement(event);
    if (!drag || !placement || !this.canDragCollection(patch.tree, row)) return null;
    if (row.ref.id === drag.sourceID || row.ref.libraryID !== drag.libraryID) return null;
    if (integerOrNull(row.ref.parentID) !== drag.parentID) return null;
    if (stringOrNull(row.ref.parentKey) !== drag.parentKey) return null;
    return { row, placement };
  }

  private collectionDropPlacement(event: DragEvent): "before" | "after" | null {
    const target = event.currentTarget as Element | null;
    const rect = target?.getBoundingClientRect?.();
    if (!rect || !rect.height) return null;
    const offset = event.clientY - rect.top;
    if (offset < rect.height / 3) return "before";
    if (offset > (rect.height * 2) / 3) return "after";
    return null;
  }

  private parentRowIndex(tree: any, drag: CollectionDragState): number {
    const parentRowID = drag.parentID === null ? `L${drag.libraryID}` : `C${drag.parentID}`;
    return this.rowIndexByID(tree, parentRowID);
  }

  private rowIndexByID(tree: any, rowID: string): number {
    const mapped = tree._rowMap?.[rowID] ?? tree._rowMap?.get?.(rowID);
    if (Number.isInteger(mapped)) return mapped;
    return (tree._rows ?? []).findIndex((row: any) => String(row.id) === rowID);
  }

  private consumeDragEvent(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  private showDropMarker(event: DragEvent, placement: "before" | "after"): void {
    const target = event.currentTarget as Element | null;
    const doc = target?.ownerDocument;
    if (!doc || !target?.appendChild) return;
    this.removeDropMarkers(doc);
    const marker = doc.createElement("span");
    marker.className = `zms-collection-drop-marker drop-${placement}`;
    marker.setAttribute("aria-hidden", "true");
    marker.setAttribute(
      "style",
      `position:absolute;left:8px;right:4px;${placement === "before" ? "top" : "bottom"}:-1px;` +
        "height:2px;background:var(--accent-blue,#0060df);pointer-events:none;z-index:10;",
    );
    target.appendChild(marker);
  }

  private removeDropMarkers(doc: Document): void {
    doc.querySelectorAll?.(".zms-collection-drop-marker").forEach((node) => node.remove());
  }

  private clearZoteroDragState(): void {
    if (!this.zotero?.DragDrop) return;
    this.zotero.DragDrop.currentDragSource = null;
    this.zotero.DragDrop.currentOrientation = 0;
  }

  private logError(message: string, error: unknown): void {
    this.zotero?.debug?.(`[Manual Sort] ${message}: ${errorMessage(error)}`);
  }

  private get zotero(): any {
    return this.ports.zotero ?? (globalThis as any).Zotero;
  }
}

function integerOrNull(value: unknown): number | null {
  return Number.isInteger(value) ? (value as number) : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
