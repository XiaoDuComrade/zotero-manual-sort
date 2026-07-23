import { describe, expect, it, vi } from "vitest";
import { CollectionTreeSorter } from "../src/zotero/collection-tree-sorter";

function makeFixture() {
  const domEl = document.createElement("div");
  document.body.appendChild(domEl);
  const library = {
    id: "L1",
    level: 0,
    isLibrary: () => true,
    isCollection: () => false,
    ref: { libraryID: 1 },
  };
  const makeCollection = (id: number, key: string) => ({
    id: `C${id}`,
    level: 1,
    editable: true,
    isLibrary: () => false,
    isCollection: () => true,
    ref: { id, key, libraryID: 1, parentID: null, parentKey: null },
  });
  const rows = [library, makeCollection(10, "A"), makeCollection(20, "B"), makeCollection(30, "C")];
  const original = {
    expandRow: vi.fn(async () => 0),
    onDragStart: vi.fn(() => undefined),
    onDragOver: vi.fn(() => "native-over"),
    onDrop: vi.fn(async () => "native-drop"),
    onDragEnd: vi.fn(() => undefined),
  };
  const tree = {
    domEl,
    _rows: rows,
    _rowMap: { L1: 0, C10: 1, C20: 2, C30: 3 },
    _expandRow: original.expandRow,
    onDragStart: original.onDragStart,
    onDragOver: original.onDragOver,
    onDrop: original.onDrop,
    onDragEnd: original.onDragEnd,
    _isFilterEmpty: () => true,
    getRow: (index: number) => tree._rows[index],
    _refreshRowMap: vi.fn(() => {
      tree._rowMap = Object.fromEntries(tree._rows.map((row: any, index: number) => [row.id, index]));
    }),
    tree: { invalidate: vi.fn() },
    selection: { select: vi.fn() },
    ensureRowIsVisible: vi.fn(),
  } as any;
  const win = { document, ZoteroPane: { collectionsView: tree }, setTimeout, clearTimeout, alert: vi.fn() };
  let order = ["B", "A", "C"];
  const store = {
    load: vi.fn((_libraryID: number, parentKey: string | null) => parentKey === null ? [...order] : []),
    save: vi.fn((_libraryID: number, _parentKey: string | null, next: string[]) => {
      order = [...next];
    }),
  };
  const zotero = {
    getMainWindows: () => [win],
    DragDrop: { currentDragSource: {}, currentOrientation: 0 },
    debug: vi.fn(),
  };
  const sorter = new CollectionTreeSorter({ zotero, collectionTreeStore: store });
  return { sorter, tree, original, store };
}

function dragEvent(element: Element, clientY: number) {
  return {
    currentTarget: element,
    clientY,
    dataTransfer: { dropEffect: "none" },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  } as any;
}

describe("CollectionTreeSorter", () => {
  it("restores and persists top-level collection order", async () => {
    const { sorter, tree, store } = makeFixture();
    sorter.start();
    expect(tree._rows.map((row: any) => row.ref.key).filter(Boolean)).toEqual(["B", "A", "C"]);

    const rowElement = document.createElement("div");
    rowElement.getBoundingClientRect = () => ({ top: 0, height: 30 } as DOMRect);
    document.body.appendChild(rowElement);
    const event = dragEvent(rowElement, 29);
    tree.onDragStart(event, 2);
    tree.onDragOver(event, 3);
    await tree.onDrop(event, 3);

    expect(store.save).toHaveBeenCalledWith(1, null, ["B", "C", "A"]);
    expect(tree._rows.map((row: any) => row.ref.key).filter(Boolean)).toEqual(["B", "C", "A"]);
    expect(event.preventDefault).toHaveBeenCalled();
    sorter.stop();
  });

  it("keeps center drops as Zotero's native reparent action", async () => {
    const { sorter, tree, original, store } = makeFixture();
    sorter.start();
    const rowElement = document.createElement("div");
    rowElement.getBoundingClientRect = () => ({ top: 0, height: 30 } as DOMRect);
    const event = dragEvent(rowElement, 15);

    tree.onDragStart(event, 2);
    expect(tree.onDragOver(event, 3)).toBe("native-over");
    await tree.onDrop(event, 3);

    expect(original.onDrop).toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
    sorter.stop();
  });
});
