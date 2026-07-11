export interface ZoteroDatabaseLike {
  queryAsync(sql: string, params?: unknown): Promise<unknown>;
  executeTransaction<T>(callback: () => Promise<T>): Promise<T>;
}

export class CollectionOrderStore {
  constructor(private readonly db: ZoteroDatabaseLike) {}

  async load(collectionID: number): Promise<number[]> {
    requirePositiveInteger(collectionID, "collectionID");
    const result = await this.db.queryAsync(
      "SELECT itemID FROM collectionItems WHERE collectionID=? ORDER BY orderIndex, itemID",
      [collectionID],
    );
    if (!Array.isArray(result)) return [];
    return result
      .map((row) => itemIDFromRow(row))
      .filter(
        (id): id is number =>
          typeof id === "number" && Number.isInteger(id) && id > 0,
      );
  }

  async save(collectionID: number, orderedItemIDs: readonly number[]): Promise<void> {
    requirePositiveInteger(collectionID, "collectionID");
    const unique = [...new Set(orderedItemIDs)];
    if (
      unique.length !== orderedItemIDs.length ||
      unique.some((itemID) => !Number.isInteger(itemID) || itemID <= 0)
    ) {
      throw new Error("orderedItemIDs must contain unique positive integers");
    }

    await this.db.executeTransaction(async () => {
      for (let orderIndex = 0; orderIndex < unique.length; orderIndex += 1) {
        await this.db.queryAsync(
          "UPDATE collectionItems SET orderIndex=? WHERE collectionID=? AND itemID=?",
          [orderIndex, collectionID, unique[orderIndex]],
        );
      }
    });
  }
}

function itemIDFromRow(row: unknown): number | undefined {
  if (typeof row === "number") return row;
  if (!row || typeof row !== "object") return undefined;
  const value = (row as { itemID?: unknown }).itemID;
  return typeof value === "number" ? value : Number(value);
}

function requirePositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}
