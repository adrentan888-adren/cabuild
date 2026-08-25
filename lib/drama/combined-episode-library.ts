"use client";

let databaseName = "drama-studio-media:unscoped";

export function configureCombinedEpisodeOwner(ownerId: string) {
  databaseName = `drama-studio-media:${encodeURIComponent(ownerId || "unscoped")}`;
}
const STORE_NAME = "combined-episodes";
const DATABASE_VERSION = 1;

export type CombinedEpisodeEntry = {
  id: string;
  recordId: string;
  project: string;
  episode: number;
  episodeTitle: string;
  createdAt: string;
  blob: Blob;
  scenes: Array<{
    id: string;
    title: string;
    prompt: string;
    duration: number;
    provider: string;
    resultUrl?: string;
  }>;
  assets: Array<{
    name: string;
    type: "Character" | "Venue" | "Object";
    prompt: string;
    resultUrl: string;
  }>;
};

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(databaseName, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveCombinedEpisode(entry: CombinedEpisodeEntry) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(entry);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function readCombinedEpisodes() {
  const database = await openDatabase();
  const entries = await new Promise<CombinedEpisodeEntry[]>((resolve, reject) => {
    const request = database
      .transaction(STORE_NAME, "readonly")
      .objectStore(STORE_NAME)
      .getAll();
    request.onsuccess = () => resolve(request.result as CombinedEpisodeEntry[]);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return entries.sort(
    (first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt),
  );
}
