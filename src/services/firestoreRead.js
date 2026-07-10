import { collection, onSnapshot } from "firebase/firestore";
import { ensureAuthorizedFirebaseUser, getFirestoreDb } from "../firebase.js";
import { uniqueIdentityValues } from "../utils/identity.js";

export const FIRESTORE_READ_COLLECTIONS = [
  "customers",
  "orders",
  "purchases",
  "requestedItems",
  "shipments",
  "deliveries",
  "packageTasks",
  "packageScanLogs"
];

const METADATA_SORT_FIELDS = [
  "updatedAt",
  "createdAt",
  "localId",
  "androidLocalId",
  "legacyId",
  "id"
];

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFirestoreTimestamp(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.toDate === "function" &&
    typeof value.seconds === "number"
  );
}

export function normalizeFirestoreValue(value) {
  if (isFirestoreTimestamp(value)) {
    return value.toDate().toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeFirestoreValue(item));
  }

  if (isPlainObject(value)) {
    return Object.entries(value).reduce((normalized, [key, nestedValue]) => {
      normalized[key] = normalizeFirestoreValue(nestedValue);
      return normalized;
    }, {});
  }

  return value;
}

export function normalizeFirestoreRecord(documentSnapshot) {
  const data = normalizeFirestoreValue(documentSnapshot.data() || {});

  return {
    ...data,
    documentId: documentSnapshot.id,
    id: data.id || documentSnapshot.id,
    firestoreId: data.firestoreId || documentSnapshot.id
  };
}

function getRecordSortValue(record = {}) {
  const value = METADATA_SORT_FIELDS.map((field) => record[field]).find(Boolean);

  return String(value || "");
}

function sortFreshestFirst(records = []) {
  return [...records].sort((leftRecord, rightRecord) =>
    getRecordSortValue(rightRecord).localeCompare(
      getRecordSortValue(leftRecord),
      undefined,
      { numeric: true }
    )
  );
}

function dedupeByIdentity(records = []) {
  const seen = new Set();
  const deduped = [];

  sortFreshestFirst(records).forEach((record) => {
    const keys = uniqueIdentityValues([
      record.id,
      record.firestoreId,
      record.localId,
      record.androidLocalId,
      record.remoteId,
      record.legacyId
    ]);
    const hasMatch = keys.some((key) => seen.has(key));

    if (hasMatch) {
      return;
    }

    keys.forEach((key) => seen.add(key));
    deduped.push(record);
  });

  return sortFreshestFirst(deduped);
}

export function subscribeToFirestoreCollection(collectionName, onData, onError) {
  let unsubscribe = () => {};
  let cancelled = false;

  ensureAuthorizedFirebaseUser()
    .then(() => {
      if (cancelled) {
        return;
      }

      unsubscribe = onSnapshot(
        collection(getFirestoreDb(), collectionName),
        (snapshot) => {
          const records = snapshot.docs
            .map((documentSnapshot) => normalizeFirestoreRecord(documentSnapshot))
            .filter((record) => record.isDeleted !== true);

          onData(dedupeByIdentity(records));
        },
        onError
      );
    })
    .catch(onError);

  return () => {
    cancelled = true;
    unsubscribe();
  };
}
