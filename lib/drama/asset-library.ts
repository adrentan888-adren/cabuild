export const ASSET_LIBRARY_STORAGE_KEY = "drama-studio:asset-library-v1";
export const REUSABLE_ASSET_STORAGE_KEY = "drama-studio:reusable-asset-v1";
export const DELETED_ASSET_STORAGE_KEY = "drama-studio:deleted-assets-v1";

let activeOwnerScope = "unscoped";

export function configureDramaStorageOwner(ownerId: string) {
  activeOwnerScope = encodeURIComponent(ownerId || "unscoped");
}

export function dramaStorageKey(baseKey: string) {
  return `${baseKey}:${activeOwnerScope}`;
}

export type LibraryAsset = {
  id: string;
  sourceRecordId: string;
  sourceAssetId: string;
  name: string;
  type: "Character" | "Venue" | "Object";
  detail: string;
  visualPrompt?: string;
  resultUrl: string;
  project: string;
  crop: string;
  savedAt: string;
  usageCount?: number;
  lastUsedAt?: string;
};

export function createLibraryAssetId(
  recordId: string,
  assetId: string,
  resultUrl: string,
) {
  let hash = 2166136261;
  for (let index = 0; index < resultUrl.length; index += 1) {
    hash ^= resultUrl.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${recordId}:${assetId}:${(hash >>> 0).toString(36)}`;
}

export function readAssetLibrary(): LibraryAsset[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(dramaStorageKey(ASSET_LIBRARY_STORAGE_KEY)) ?? "[]",
    ) as LibraryAsset[];
    return Array.isArray(parsed) ? parsed.filter((asset) => asset.resultUrl) : [];
  } catch {
    return [];
  }
}

export function writeAssetLibrary(assets: LibraryAsset[]) {
  window.localStorage.setItem(dramaStorageKey(ASSET_LIBRARY_STORAGE_KEY), JSON.stringify(assets));
}

export function markLibraryAssetUsed(assetId: string) {
  const assets = readAssetLibrary();
  const usedAt = new Date().toISOString();
  const next = assets.map((asset) =>
    asset.id === assetId
      ? {
          ...asset,
          usageCount: (asset.usageCount ?? 0) + 1,
          lastUsedAt: usedAt,
        }
      : asset,
  );
  writeAssetLibrary(next);
  return next;
}

export function readDeletedAssetIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(dramaStorageKey(DELETED_ASSET_STORAGE_KEY)) ?? "[]",
    ) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
