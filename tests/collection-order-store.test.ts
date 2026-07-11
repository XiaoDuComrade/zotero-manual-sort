import { describe, expect, it, vi } from "vitest";
import { CollectionOrderStore } from "../src/zotero/collection-order-store";

describe("CollectionOrderStore", () => {
  it("loads IDs by Zotero's collection orderIndex", async () => {
    const queryAsync = vi.fn(async () => [{ itemID: 8 }, { itemID: 3 }]);
    const store = new CollectionOrderStore({
      queryAsync,
      executeTransaction: vi.fn(),
    } as any);

    await expect(store.load(12)).resolves.toEqual([8, 3]);
    expect(queryAsync).toHaveBeenCalledWith(
      "SELECT itemID FROM collectionItems WHERE collectionID=? ORDER BY orderIndex, itemID",
      [12],
    );
  });

  it("writes a dense order inside one transaction", async () => {
    const queryAsync = vi.fn(async () => undefined);
    const executeTransaction = vi.fn(async (callback) => callback());
    const store = new CollectionOrderStore({ queryAsync, executeTransaction });

    await store.save(12, [8, 3, 5]);

    expect(executeTransaction).toHaveBeenCalledTimes(1);
    expect(queryAsync.mock.calls).toEqual([
      ["UPDATE collectionItems SET orderIndex=? WHERE collectionID=? AND itemID=?", [0, 12, 8]],
      ["UPDATE collectionItems SET orderIndex=? WHERE collectionID=? AND itemID=?", [1, 12, 3]],
      ["UPDATE collectionItems SET orderIndex=? WHERE collectionID=? AND itemID=?", [2, 12, 5]],
    ]);
  });

  it("rejects duplicate IDs", async () => {
    const store = new CollectionOrderStore({
      queryAsync: vi.fn(),
      executeTransaction: vi.fn(),
    } as any);
    await expect(store.save(12, [8, 8])).rejects.toThrow("unique positive integers");
  });
});
