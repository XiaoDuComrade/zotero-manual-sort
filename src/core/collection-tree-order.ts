export interface CollectionTreeRowLike {
  level: number;
  isCollection?: () => boolean;
  ref?: { key?: string };
}

interface CollectionSubtree<T> {
  start: number;
  end: number;
  key: string;
  rows: T[];
  originalIndex: number;
}

export function directCollectionKeys<T extends CollectionTreeRowLike>(
  rows: readonly T[],
  parentIndex: number,
): string[] {
  return directCollectionSubtrees(rows, parentIndex).map((group) => group.key);
}

export function reorderDirectCollectionSubtrees<T extends CollectionTreeRowLike>(
  rows: readonly T[],
  parentIndex: number,
  orderedKeys: readonly string[],
): T[] {
  const groups = directCollectionSubtrees(rows, parentIndex);
  if (groups.length < 2) return [...rows];

  const rank = new Map(
    [...new Set(orderedKeys.filter(Boolean))].map((key, index) => [key, index]),
  );
  const sorted = [...groups].sort(
    (a, b) =>
      (rank.get(a.key) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(b.key) ?? Number.MAX_SAFE_INTEGER) ||
      a.originalIndex - b.originalIndex,
  );
  const byStart = new Map(groups.map((group) => [group.start, group]));
  const result: T[] = [];
  let sortedIndex = 0;

  for (let index = 0; index < rows.length; ) {
    const group = byStart.get(index);
    if (!group) {
      result.push(rows[index]);
      index++;
      continue;
    }
    result.push(...sorted[sortedIndex++].rows);
    index = group.end;
  }
  return result;
}

function directCollectionSubtrees<T extends CollectionTreeRowLike>(
  rows: readonly T[],
  parentIndex: number,
): CollectionSubtree<T>[] {
  const parent = rows[parentIndex];
  if (!parent || !Number.isInteger(parent.level)) return [];
  const childLevel = parent.level + 1;
  const groups: CollectionSubtree<T>[] = [];

  for (let index = parentIndex + 1; index < rows.length; ) {
    const row = rows[index];
    if (row.level <= parent.level) break;
    if (row.level !== childLevel || !row.isCollection?.() || !row.ref?.key) {
      index++;
      continue;
    }

    let end = index + 1;
    while (end < rows.length && rows[end].level > childLevel) end++;
    groups.push({
      start: index,
      end,
      key: row.ref.key,
      rows: rows.slice(index, end),
      originalIndex: groups.length,
    });
    index = end;
  }
  return groups;
}
