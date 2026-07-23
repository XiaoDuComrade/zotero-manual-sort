const PREF_KEY = "extensions.zotero.manualsort.collectionOrders";

export class CollectionTreeOrderStore {
  private cache?: Record<string, string[]>;

  constructor(private readonly prefs: any) {}

  load(libraryID: number, parentKey: string | null): string[] {
    const value = this.readAll()[scopeKey(libraryID, parentKey)];
    return Array.isArray(value) ? uniqueKeys(value) : [];
  }

  save(libraryID: number, parentKey: string | null, keys: readonly string[]): void {
    const all = this.readAll();
    all[scopeKey(libraryID, parentKey)] = uniqueKeys(keys);
    this.writeAll(all);
  }

  clear(libraryID: number, parentKey: string | null): void {
    const all = this.readAll();
    delete all[scopeKey(libraryID, parentKey)];
    this.writeAll(all);
  }

  private readAll(): Record<string, string[]> {
    if (this.cache) return this.cache;
    const raw = this.prefs?.get?.(PREF_KEY, true);
    if (!raw || typeof raw !== "string") return (this.cache = {});
    try {
      const parsed = JSON.parse(raw);
      return (this.cache =
        parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {});
    } catch {
      return (this.cache = {});
    }
  }

  private writeAll(value: Record<string, string[]>): void {
    this.cache = value;
    this.prefs?.set?.(PREF_KEY, JSON.stringify(value), true);
  }
}

export function scopeKey(libraryID: number, parentKey: string | null): string {
  return `${libraryID}:${parentKey || "ROOT"}`;
}

function uniqueKeys(values: readonly unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && !!value))];
}
