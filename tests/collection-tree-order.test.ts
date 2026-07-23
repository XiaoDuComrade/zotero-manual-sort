import { describe, expect, it } from "vitest";
import {
  directCollectionKeys,
  reorderDirectCollectionSubtrees,
} from "../src/core/collection-tree-order";

function collection(id: string, level: number) {
  return {
    id: `C${id}`,
    level,
    isCollection: () => true,
    ref: { key: id },
  };
}

describe("collection tree ordering", () => {
  it("moves each collection together with its expanded descendants", () => {
    const rows = [
      { id: "L1", level: 0 },
      collection("A", 1),
      collection("A1", 2),
      collection("B", 1),
      collection("C", 1),
      collection("C1", 2),
    ];

    expect(directCollectionKeys(rows, 0)).toEqual(["A", "B", "C"]);
    expect(reorderDirectCollectionSubtrees(rows, 0, ["C", "A", "B"]).map((row) => row.id)).toEqual([
      "L1",
      "CC",
      "CC1",
      "CA",
      "CA1",
      "CB",
    ]);
  });

  it("only reorders direct children of the requested parent", () => {
    const rows = [
      { id: "L1", level: 0 },
      collection("A", 1),
      collection("A1", 2),
      collection("A2", 2),
      collection("B", 1),
    ];

    expect(reorderDirectCollectionSubtrees(rows, 1, ["A2", "A1"]).map((row) => row.id)).toEqual([
      "L1",
      "CA",
      "CA2",
      "CA1",
      "CB",
    ]);
  });
});
