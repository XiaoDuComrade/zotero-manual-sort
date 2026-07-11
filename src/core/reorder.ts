export type DropPlacement = "before" | "after" | "end";

export interface TreeRowLike {
  level: number;
  ref?: { id?: number };
}

export function reorderByDrop(
  currentOrder: readonly number[],
  draggedIDs: readonly number[],
  targetID: number | null,
  placement: DropPlacement,
): number[] {
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
    ...remaining.slice(insertionIndex),
  ];
}

export function topLevelItemIDs(rows: readonly TreeRowLike[]): number[] {
  return rows
    .filter((row) => row.level === 0 && Number.isInteger(row.ref?.id))
    .map((row) => row.ref!.id!);
}

export function orderTreeRowGroups<T extends TreeRowLike>(
  rows: readonly T[],
  orderedItemIDs: readonly number[],
): T[] {
  if (!rows.length) return [];

  const groups: T[][] = [];
  for (const row of rows) {
    if (row.level === 0 || !groups.length) {
      groups.push([row]);
    } else {
      groups[groups.length - 1].push(row);
    }
  }

  const rank = new Map(uniqueIntegers(orderedItemIDs).map((id, index) => [id, index]));
  return groups
    .map((group, originalIndex) => ({
      group,
      originalIndex,
      rank: rank.get(group[0].ref?.id ?? -1) ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => a.rank - b.rank || a.originalIndex - b.originalIndex)
    .flatMap(({ group }) => group);
}

function uniqueIntegers(values: readonly number[]): number[] {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value > 0))];
}
