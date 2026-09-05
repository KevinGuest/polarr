type StoredResponse = {
  key: string;
  body: string;
  contentType: string;
  status: number;
  savedAt: number;
};

export type QueuedMutation = {
  id: string;
  scope: string;
  serverUrl: string;
  url: string;
  method: string;
  body: string;
  contentType: string;
  createdAt: number;
  attempts: number;
};

const DB_NAME = "polarr-native-client";
const DB_VERSION = 1;
const RESPONSE_STORE = "responses";
const ARTWORK_STORE = "artwork";
const MUTATION_STORE = "mutations";

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RESPONSE_STORE)) {
        db.createObjectStore(RESPONSE_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(ARTWORK_STORE)) {
        db.createObjectStore(ARTWORK_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(MUTATION_STORE)) {
        const store = db.createObjectStore(MUTATION_STORE, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Offline database unavailable"));
  });
  return databasePromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Offline database request failed"));
  });
}

async function store(name: string, mode: IDBTransactionMode) {
  const db = await openDatabase();
  return db.transaction(name, mode).objectStore(name);
}

export async function putStoredResponse(entry: StoredResponse) {
  await requestResult((await store(RESPONSE_STORE, "readwrite")).put(entry));
}

export async function getStoredResponse(key: string): Promise<StoredResponse | null> {
  const entry = await requestResult(
    (await store(RESPONSE_STORE, "readonly")).get(key) as IDBRequest<StoredResponse | undefined>,
  );
  return entry || null;
}

export async function mutateStoredJson(
  keyPrefix: string,
  mutate: (key: string, value: Record<string, unknown>) => Record<string, unknown> | null,
) {
  const db = await openDatabase();
  const readTransaction = db.transaction(RESPONSE_STORE, "readonly");
  const entries = await requestResult(
    readTransaction.objectStore(RESPONSE_STORE).getAll() as IDBRequest<StoredResponse[]>,
  );
  const changed: StoredResponse[] = [];
  for (const entry of entries) {
    if (!entry.key.startsWith(keyPrefix) || !entry.contentType.includes("application/json")) continue;
    try {
      const value = JSON.parse(entry.body) as Record<string, unknown>;
      const next = mutate(entry.key, value);
      if (next) changed.push({ ...entry, body: JSON.stringify(next), savedAt: Date.now() });
    } catch {
      // Ignore malformed or schema-incompatible cached responses.
    }
  }
  if (changed.length === 0) return;
  const writeTransaction = db.transaction(RESPONSE_STORE, "readwrite");
  const responseStore = writeTransaction.objectStore(RESPONSE_STORE);
  await Promise.all(changed.map((entry) => requestResult(responseStore.put(entry))));
}

export async function putArtwork(key: string, blob: Blob) {
  await requestResult(
    (await store(ARTWORK_STORE, "readwrite")).put({ key, blob, savedAt: Date.now() }),
  );
}

export async function getArtwork(key: string): Promise<Blob | null> {
  const entry = await requestResult(
    (await store(ARTWORK_STORE, "readonly")).get(key) as IDBRequest<
      { key: string; blob: Blob; savedAt: number } | undefined
    >,
  );
  return entry?.blob || null;
}

export async function putMutation(entry: QueuedMutation) {
  await requestResult((await store(MUTATION_STORE, "readwrite")).put(entry));
}

export async function deleteMutation(id: string) {
  await requestResult((await store(MUTATION_STORE, "readwrite")).delete(id));
}

export async function listMutations(scope: string, serverUrl: string): Promise<QueuedMutation[]> {
  const entries = await requestResult(
    (await store(MUTATION_STORE, "readonly")).getAll() as IDBRequest<QueuedMutation[]>,
  );
  return entries
    .filter((entry) => entry.scope === scope && entry.serverUrl === serverUrl)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function updateMutationAttempts(entry: QueuedMutation) {
  await putMutation({ ...entry, attempts: entry.attempts + 1 });
}
