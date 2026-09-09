/**
 * Local asset vault — IndexedDB persistence for background clips + music.
 *
 * Files picked in the browser normally vanish on reload. This stores the raw
 * Blobs on-device (IndexedDB), so backgrounds, the source video and the music
 * deck survive refreshes, tab restarts and offline use. Nothing is uploaded.
 */

const DB_NAME = "shortsfactory";
const DB_VERSION = 1;
const STORE = "assets";

export type AssetKind = "background" | "music" | "source";

export interface StoredAsset {
  id: string;
  kind: AssetKind;
  name: string;
  type: string;
  size: number;
  blob: Blob;
  /** cached probe metadata so we don't re-decode on every boot */
  meta?: {
    width?: number;
    height?: number;
    duration?: number;
    selected?: boolean;
  };
  createdAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable in this browser"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("kind", "kind", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open IndexedDB"));
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const store = transaction.objectStore(STORE);
        const request = run(store);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      })
  );
}

/** Persist one asset. Safe to call repeatedly — upserts by id. */
export async function putAsset(asset: StoredAsset): Promise<void> {
  try {
    await tx("readwrite", (s) => s.put(asset) as IDBRequest<IDBValidKey>);
  } catch (e) {
    console.warn("asset vault: put failed", e);
  }
}

export async function getAssetsByKind(kind: AssetKind): Promise<StoredAsset[]> {
  try {
    const all = await tx<StoredAsset[]>("readonly", (s) => s.getAll() as IDBRequest<StoredAsset[]>);
    return (all ?? [])
      .filter((a) => a.kind === kind && a.blob instanceof Blob)
      .sort((a, b) => a.createdAt - b.createdAt);
  } catch (e) {
    console.warn("asset vault: read failed", e);
    return [];
  }
}

export async function deleteAsset(id: string): Promise<void> {
  try {
    await tx("readwrite", (s) => s.delete(id) as unknown as IDBRequest<undefined>);
  } catch (e) {
    console.warn("asset vault: delete failed", e);
  }
}

export async function clearKind(kind: AssetKind): Promise<void> {
  const items = await getAssetsByKind(kind);
  await Promise.all(items.map((i) => deleteAsset(i.id)));
}

/** Patch just the cached metadata of an existing asset (e.g. music selection). */
export async function patchAssetMeta(
  id: string,
  meta: Partial<NonNullable<StoredAsset["meta"]>>
): Promise<void> {
  try {
    const existing = await tx<StoredAsset | undefined>(
      "readonly",
      (s) => s.get(id) as IDBRequest<StoredAsset | undefined>
    );
    if (!existing) return;
    await putAsset({ ...existing, meta: { ...existing.meta, ...meta } });
  } catch (e) {
    console.warn("asset vault: patch failed", e);
  }
}

/** Rebuild a File from a stored Blob so the existing pipeline works unchanged. */
export function assetToFile(asset: StoredAsset): File {
  return new File([asset.blob], asset.name, {
    type: asset.type || asset.blob.type || "application/octet-stream",
  });
}

/** Rough measure of how much the vault currently holds. */
export async function vaultUsage(): Promise<{ count: number; bytes: number }> {
  try {
    const all = await tx<StoredAsset[]>("readonly", (s) => s.getAll() as IDBRequest<StoredAsset[]>);
    const items = all ?? [];
    return {
      count: items.length,
      bytes: items.reduce((n, a) => n + (a.size || 0), 0),
    };
  } catch {
    return { count: 0, bytes: 0 };
  }
}
