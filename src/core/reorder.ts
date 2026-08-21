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
  return reorderValuesByDrop(current, uniqueIntegers(draggedIDs), targetID, placement);
}

export function reorderValuesByDrop<T extends string | number>(
  currentOrder: readonly T[],
  draggedValues: readonly T[],
  targetValue: T | null,
  placement: DropPlacement,
): T[] {
  const current = [...new Set(currentOrder)];
  const currentSet = new Set(current);
  const dragged = [...new Set(draggedValues)].filter((value) => currentSet.has(value));
  if (!dragged.length) return current;

  const draggedSet = new Set(dragged);
  if (targetValue !== null && draggedSet.has(targetValue)) return current;

  const remaining = current.filter((value) => !draggedSet.has(value));
  let insertionIndex = remaining.length;
  if (targetValue !== null && placement !== "end") {
    const targetIndex = remaining.indexOf(targetValue);
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
