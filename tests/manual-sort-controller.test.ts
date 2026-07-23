import { afterEach, describe, expect, it, vi } from "vitest";
import { ManualSortController } from "../src/zotero/manual-sort-controller";

afterEach(() => {
  document.body.innerHTML = "";
});

function makeFixture() {
  document.body.innerHTML = [
    '<menupopup id="zotero-collectionmenu"></menupopup>',
    '<input id="zotero-tb-search" value="">',
  ].join("");
  const domEl = document.createElement("div");
  const header = document.createElement("div");
  header.className = "virtualized-table-header";
  const headerCell = document.createElement("span");
  headerCell.className = "cell title";
  header.appendChild(headerCell);
  domEl.appendChild(header);
  document.body.appendChild(domEl);

  const rows = [1, 2, 3].map((id) => ({ level: 0, ref: { id } }));
  const original = {
    sort: vi.fn(async () => undefined),
    changeCollectionTreeRow: vi.fn(async () => undefined),
    onDragStart: vi.fn(() => undefined),
    onDragOver: vi.fn(() => "native-drag-over"),
    onDrop: vi.fn(async () => "native-drop"),
    onDragEnd: vi.fn(() => undefined),
  };
  const tree = {
    ...original,
    domEl,
    _rows: rows,
    _rowCache: { stale: true },
    _refreshRowMap: vi.fn(),
    tree: { invalidate: vi.fn() },
    selection: { isSelected: (index: number) => index === 2 },
    collectionTreeRow: {
      editable: true,
      isCollection: () => true,
      ref: { id: 9 },
    },
    getLevel: (index: number) => rows[index]?.level,
    getRow: (index: number) => tree._rows[index],
    selectItems: vi.fn(async () => undefined),
  } as any;
  const win = {
    document,
    ZoteroPane: { itemsView: tree },
    setTimeout,
    clearTimeout,
    alert: vi.fn(),
  } as any;
  let order = [1, 2, 3];
  const store = {
    load: vi.fn(async () => [...order]),
    save: vi.fn(async (_collectionID: number, next: number[]) => {
      order = [...next];
    }),
  };
  const zotero = {
    getMainWindows: () => [win],
    Prefs: { get: vi.fn(() => false) },
    DragDrop: { currentDragSource: {}, currentOrientation: 0 },
    debug: vi.fn(),
  };
  const collectionTreeSorter = {
    start: vi.fn(),
    stop: vi.fn(),
    registerWindow: vi.fn(),
    unregisterWindow: vi.fn(),
  };
  const controller = new ManualSortController({ zotero, store, collectionTreeSorter });
  return { controller, tree, win, store, original, headerCell, search: document.querySelector("input")! };
}

function dragEvent(currentTarget: Element) {
  return {
    currentTarget,
    clientY: 1,
    dataTransfer: { dropEffect: "none" },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  } as any;
}

describe("ManualSortController", () => {
  it("restores orderIndex order when installed in a collection view", async () => {
    const { controller, tree, store } = makeFixture();
    tree._rows = [tree._rows[2], tree._rows[0], tree._rows[1]];

    controller.start();
    await Promise.resolve();

    expect(store.load).toHaveBeenCalledWith(9);
    expect(tree._rows.map((row: any) => row.ref.id)).toEqual([1, 2, 3]);
    expect(tree._refreshRowMap).toHaveBeenCalled();
  });

  it("persists a same-collection drag and keeps Zotero's selected item", async () => {
    const { controller, tree, store } = makeFixture();
    controller.start();
    await Promise.resolve();
    const rowElement = document.createElement("div");
    rowElement.getBoundingClientRect = () => ({ top: 0, height: 20 } as DOMRect);
    document.body.appendChild(rowElement);
    const event = dragEvent(rowElement);

    tree.onDragStart(event, 2);
    tree.onDragOver(event, 0);
    await tree.onDrop(event, 0);

    expect(store.save).toHaveBeenCalledWith(9, [3, 1, 2]);
    expect(tree._rows.map((row: any) => row.ref.id)).toEqual([3, 1, 2]);
    expect(tree.selectItems).toHaveBeenCalledWith([3], false, true);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("allows a column-header click to switch temporarily to native field sorting", async () => {
    const { controller, tree, original, headerCell } = makeFixture();
    controller.start();
    await Promise.resolve();

    headerCell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tree.sort();

    expect(original.sort).toHaveBeenCalledTimes(1);
  });

  it("delegates drag handling to Zotero while quick search is active", async () => {
    const { controller, tree, original, search } = makeFixture();
    controller.start();
    await Promise.resolve();
    search.value = "filtered";
    const event = dragEvent(document.createElement("div"));

    tree.onDragStart(event, 2);
    const result = tree.onDragOver(event, 0);

    expect(result).toBe("native-drag-over");
    expect(original.onDragOver).toHaveBeenCalled();
  });
});
