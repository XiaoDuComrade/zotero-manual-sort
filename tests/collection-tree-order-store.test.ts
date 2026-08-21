import { describe, expect, it, vi } from "vitest";
import { CollectionTreeOrderStore } from "../src/zotero/collection-tree-order-store";

describe("CollectionTreeOrderStore", () => {
  it("stores top-level and nested collection orders independently", () => {
    let raw = "";
    const prefs = {
      get: vi.fn(() => raw),
      set: vi.fn((_key: string, value: string) => {
        raw = value;
      }),
    };
    const store = new CollectionTreeOrderStore(prefs);

    store.save(1, null, ["TOP-B", "TOP-A"]);
    store.save(1, "TOP-A", ["CHILD-2", "CHILD-1"]);

    expect(store.load(1, null)).toEqual(["TOP-B", "TOP-A"]);
    expect(store.load(1, "TOP-A")).toEqual(["CHILD-2", "CHILD-1"]);
    expect(prefs.get).toHaveBeenCalledTimes(1);
    expect(prefs.set).toHaveBeenCalledWith(
      "extensions.zotero.manualsort.collectionOrders",
      expect.any(String),
      true,
    );
  });

  it("treats invalid preference JSON as an empty order", () => {
    const store = new CollectionTreeOrderStore({ get: () => "not-json", set: vi.fn() });
    expect(store.load(1, null)).toEqual([]);
  });
});
