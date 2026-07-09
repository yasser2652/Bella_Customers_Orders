import { doc, increment, updateDoc } from "firebase/firestore";
import { ensureAnonymousFirebaseUser, getFirestoreDb } from "../firebase.js";
import { firstText, roundCurrencyAmount } from "../utils/relationships.js";

const CUSTOMER_FIELD_ALIASES = {
  name: ["name", "customerName"],
  phone: ["phone", "customerPhone"],
  address: ["address", "customerAddress"],
  email: ["email", "customerEmail"],
  notes: ["notes", "note"]
};

function hasOwnField(record, field) {
  return Object.prototype.hasOwnProperty.call(record || {}, field);
}

function getWritableCustomerField(customer, fieldName) {
  const aliases = CUSTOMER_FIELD_ALIASES[fieldName] || [fieldName];

  return aliases.find((alias) => hasOwnField(customer, alias)) || aliases[0];
}

function customerHasEditableField(customer, fieldName) {
  const aliases = CUSTOMER_FIELD_ALIASES[fieldName] || [fieldName];

  return aliases.some((alias) => hasOwnField(customer, alias));
}

export function getCustomerEditableValues(customer = {}) {
  return {
    name: firstText(customer.name, customer.customerName),
    phone: firstText(customer.phone, customer.customerPhone),
    address: firstText(customer.address, customer.customerAddress),
    email: firstText(customer.email, customer.customerEmail),
    notes: firstText(customer.notes, customer.note)
  };
}

export function buildCustomerUpdatePatch(customer = {}, values = {}) {
  return Object.entries(CUSTOMER_FIELD_ALIASES).reduce(
    (patch, [fieldName]) => {
      const field = getWritableCustomerField(customer, fieldName);
      const value = String(values[fieldName] ?? "").trim();

      if (customerHasEditableField(customer, fieldName) || value) {
        patch[field] = value;
      }

      return patch;
    },
    {}
  );
}

export function getCustomerDocumentId(customer = {}) {
  return firstText(customer.documentId, customer.firestoreId, customer.id);
}

export async function updateCustomerInfo(customer = {}, values = {}) {
  const documentId = getCustomerDocumentId(customer);

  if (!documentId) {
    throw new Error("Cannot update this customer because the Firestore document id is missing.");
  }

  await ensureAnonymousFirebaseUser();
  await updateDoc(
    doc(getFirestoreDb(), "customers", documentId),
    buildCustomerUpdatePatch(customer, values)
  );
}

const PAYMENT_FIELD_BY_CURRENCY = {
  LYD: "deliveryPaymentLyd",
  USD: "deliveryPaymentUsd"
};

function normalizePaymentCurrency(currency) {
  const cleanCurrency = String(currency || "").trim().toUpperCase();

  if (!PAYMENT_FIELD_BY_CURRENCY[cleanCurrency]) {
    throw new Error("Payment currency must be LYD or USD.");
  }

  return cleanCurrency;
}

function normalizePositivePaymentAmount(amount) {
  const numericAmount = Number(amount);

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error("Payment amount must be greater than 0.");
  }

  return roundCurrencyAmount(numericAmount);
}

function toLocalDateTimeValue(date = new Date()) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);

  return localDate.toISOString().slice(0, 19);
}

export function getPackageTaskDocumentId(packageTask = {}) {
  return firstText(packageTask.documentId, packageTask.firestoreId, packageTask.id);
}

export function buildPackageTaskPaymentPatch(packageTask = {}, values = {}, now = new Date()) {
  const currency = normalizePaymentCurrency(values.currency);
  const amountToAdd = normalizePositivePaymentAmount(values.amount);
  const field = PAYMENT_FIELD_BY_CURRENCY[currency];
  return {
    [field]: increment(amountToAdd),
    deliveryPaymentUpdatedAt: now.toISOString(),
    deliveryPaymentUpdatedAtLocal: toLocalDateTimeValue(now)
  };
}

export async function addPackageTaskPayment(packageTask = {}, values = {}) {
  const documentId = getPackageTaskDocumentId(packageTask);

  if (!documentId) {
    throw new Error("Cannot update this package task because the Firestore document id is missing.");
  }

  await ensureAnonymousFirebaseUser();
  await updateDoc(
    doc(getFirestoreDb(), "packageTasks", documentId),
    buildPackageTaskPaymentPatch(packageTask, values)
  );
}
