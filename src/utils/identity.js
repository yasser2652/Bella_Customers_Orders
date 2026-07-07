export const IDENTITY_FIELDS = [
  "id",
  "localId",
  "androidLocalId",
  "firestoreId",
  "legacyId",
  "remoteId"
];

export const CUSTOMER_RELATION_FIELDS = [
  "customerId",
  "customerLocalId",
  "androidCustomerId",
  "androidCustomerLocalId",
  "customerFirestoreId",
  "remoteCustomerId",
  "legacyCustomerId"
];

export const ORDER_RELATION_FIELDS = [
  "orderId",
  "orderLocalId",
  "androidOrderId",
  "androidOrderLocalId",
  "orderFirestoreId",
  "remoteOrderId",
  "legacyOrderId"
];

export const SHIPMENT_RELATION_FIELDS = [
  "shipmentId",
  "shipmentLocalId",
  "androidShipmentId",
  "androidShipmentLocalId",
  "shipmentFirestoreId",
  "remoteShipmentId",
  "legacyShipmentId"
];

export const PURCHASE_RELATION_FIELDS = [
  "purchaseId",
  "purchaseLocalId",
  "androidPurchaseId",
  "androidPurchaseLocalId",
  "purchaseFirestoreId",
  "remotePurchaseId",
  "legacyPurchaseId"
];

export function normalizeIdentityValue(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

export function uniqueIdentityValues(values = []) {
  const seenValues = new Set();

  return values
    .map((value) => normalizeIdentityValue(value))
    .filter((value) => {
      if (!value || seenValues.has(value)) {
        return false;
      }

      seenValues.add(value);
      return true;
    });
}

export function identityValues(record = {}) {
  if (!record || typeof record !== "object") {
    return uniqueIdentityValues([record]);
  }

  return uniqueIdentityValues(IDENTITY_FIELDS.map((field) => record[field]));
}

export function identityValuesFromFields(record = {}, fields = []) {
  if (!record || typeof record !== "object") {
    return [];
  }

  return uniqueIdentityValues(fields.map((field) => record[field]));
}

export function valuesOverlap(leftValues = [], rightValues = []) {
  const rightSet = new Set(uniqueIdentityValues(rightValues));

  return uniqueIdentityValues(leftValues).some((value) => rightSet.has(value));
}

export function recordMatchesIdentity(record, identityOrRecord) {
  const targetValues =
    identityOrRecord &&
    typeof identityOrRecord === "object" &&
    !Array.isArray(identityOrRecord)
      ? identityValues(identityOrRecord)
      : uniqueIdentityValues(
          Array.isArray(identityOrRecord) ? identityOrRecord : [identityOrRecord]
        );

  return valuesOverlap(identityValues(record), targetValues);
}

export function getRecordKey(record = {}, fallback = "") {
  return (
    identityValues(record)[0] ||
    normalizeIdentityValue(record.key) ||
    normalizeIdentityValue(fallback)
  );
}

