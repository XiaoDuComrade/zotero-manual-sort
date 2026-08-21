import { describe, expect, it } from "vitest";
import { orderTreeRowGroups, reorderByDrop, reorderValuesByDrop, topLevelItemIDs } from "../src/core/reorder";

describe("reorderByDrop", () => {
  it("moves one item before another", () => {
    expect(reorderByDrop([1, 2, 3, 4], [3], 2, "before")).toEqual([1, 3, 2, 4]);
  });

  it("moves a selected block after the target while preserving selected order", () => {
    expect(reorderByDrop([1, 2, 3, 4, 5], [2, 3], 4, "after")).toEqual([1, 4, 2, 3, 5]);
  });

  it("appends to the end", () => {
    expect(reorderByDrop([1, 2, 3], [1], null, "end")).toEqual([2, 3, 1]);
  });

  it("does nothing when dropping on a dragged item", () => {
    expect(reorderByDrop([1, 2, 3], [2], 2, "after")).toEqual([1, 2, 3]);
  });
});

describe("reorderValuesByDrop", () => {
  it("reorders collection keys", () => {
    expect(reorderValuesByDrop(["A", "B", "C"], ["A"], "C", "after")).toEqual([
      "B",
      "C",
      "A",
    ]);
  });
});

describe("tree row helpers", () => {
  const rows = [
    { level: 0, ref: { id: 1 }, name: "one" },
    { level: 1, ref: { id: 11 }, name: "one-child" },
    { level: 0, ref: { id: 2 }, name: "two" },
    { level: 0, ref: { id: 3 }, name: "three" },
    { level: 1, ref: { id: 31 }, name: "three-child" },
  ];

  it("returns only top-level item IDs", () => {
    expect(topLevelItemIDs(rows)).toEqual([1, 2, 3]);
  });

  it("moves parent rows together with their children", () => {
    expect(orderTreeRowGroups(rows, [3, 1, 2]).map((row) => row.name)).toEqual([
      "three",
      "three-child",
      "one",
      "one-child",
      "two",
    ]);
  });
});
