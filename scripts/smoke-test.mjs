import assert from "node:assert/strict";
import { increment } from "firebase/firestore";
import { formatCurrencyTotals } from "../src/utils/formatters.js";
import {
  buildCustomerSummary,
  customerMatchesSearch,
  getOrderPurchases,
  getOrderSummary
} from "../src/utils/relationships.js";
import {
  buildPackageTaskPaymentPatch,
  buildPackageTaskPaymentCorrectionPatch,
  buildCustomerUpdatePatch,
  getCustomerEditableValues
} from "../src/services/firestoreWrite.js";
import { buildCustomerPaymentSummary, getPaymentFollowUps } from "../src/utils/payments.js";
import {
  buildReceiptDisplayModel,
  buildReceiptModel,
  buildReceiptText,
  getReceiptImageFileName,
  getReceiptExchangeRateKey,
  getReceiptExchangeSources,
  hasReceiptExchangeRates
} from "../src/utils/receipts.js";

const customer = {
  id: "cust-1",
  localId: "android-customer-1",
  name: "Amina Saleh",
  phone: "+218 91-555-0123",
  address: "Main Road"
};
const orders = [
  {
    id: "order-1",
    customerLocalId: "android-customer-1",
    reference: "BB-1001",
    openedOn: "2026-01-10"
  },
  {
    id: "order-2",
    customerId: "cust-1",
    reference: "BB-1002",
    openedOn: "2026-01-12",
    shipmentId: "shipment-1"
  }
];
const purchases = [
  {
    id: "purchase-1",
    orderId: "order-1",
    customerId: "cust-1",
    item: "Dress",
    quantity: 2,
    unitPrice: 50,
    currency: "LYD"
  },
  {
    id: "purchase-2",
    orderId: "order-1",
    customerId: "cust-1",
    item: "Bag",
    amount: 25,
    currency: "USD"
  },
  {
    id: "purchase-3",
    orderId: "order-2",
    customerId: "cust-1",
    item: "Scarf",
    amount: 10,
    currency: "CAD"
  }
];
const shipments = [
  {
    id: "shipment-1",
    orderIds: ["order-2"],
    trackingNumber: "TRACK-123",
    status: "Delivered"
  }
];
const packageTasks = [
  {
    id: "task-1",
    customerId: "cust-1",
    orderId: "order-1",
    orderReference: "BB-1001",
    deliveryPaymentLyd: 40,
    deliveryPaymentUpdatedAtLocal: "2026-01-13T10:00:00"
  }
];
const packageScanLogs = [
  {
    id: "scan-log-1",
    customerId: "cust-1",
    orderId: "order-1",
    packageTaskId: "task-1",
    deliveryPaymentUsd: 5,
    deliveryPaymentUpdatedAtLocal: "2026-01-13T10:05:00"
  }
];
const data = {
  customers: [customer],
  orders,
  purchases,
  requestedItems: [
    {
      id: "request-1",
      customerId: "cust-1",
      item: "Shoes",
      status: "Requested"
    }
  ],
  shipments,
  deliveries: [],
  packageTasks,
  packageScanLogs
};

const summary = buildCustomerSummary(customer, data);

assert.equal(customerMatchesSearch(summary, "+218 91 555 0123"), true);
assert.equal(customerMatchesSearch(summary, "5550"), true);
assert.equal(customerMatchesSearch(summary, "amina"), true);
assert.equal(summary.orders.length, 2);
assert.equal(summary.purchases.length, 3);
assert.equal(summary.pendingRequestedItems.length, 1);
const paymentSummary = buildCustomerPaymentSummary(summary, data.packageScanLogs);
assert.equal(paymentSummary.status, "partial");
assert.equal(formatCurrencyTotals(paymentSummary.paidTotals), "LYD 40.00 + USD 5.00");
assert.equal(
  formatCurrencyTotals(paymentSummary.remainingTotals),
  "LYD 60.00 + USD 20.00 + CAD 10.00"
);
assert.equal(getPaymentFollowUps([summary], data.packageScanLogs).length, 0);
assert.equal(paymentSummary.deliveredRemainingTotals.length, 0);
assert.equal(paymentSummary.hasDeliveredOutstandingBalance, false);
const handedOverPaymentSummary = buildCustomerSummary(customer, {
  ...data,
  packageTasks: [
    ...packageTasks,
    {
      id: "task-2",
      orderId: "order-2",
      status: "handedOver"
    }
  ]
});
const handedOverPaymentStatus = buildCustomerPaymentSummary(handedOverPaymentSummary, data.packageScanLogs);
assert.equal(formatCurrencyTotals(handedOverPaymentStatus.deliveredRemainingTotals), "CAD 10.00");
assert.equal(handedOverPaymentStatus.hasDeliveredOutstandingBalance, true);
assert.equal(getPaymentFollowUps([handedOverPaymentSummary], data.packageScanLogs).length, 1);

const mirroredPackageTaskSummary = buildCustomerSummary(customer, {
  ...data,
  packageTasks: [
    {
      ...packageTasks[0],
      id: "task-mirror-1",
      deliveryPaymentLyd: 100,
      deliveryPaymentUsd: 25,
      deliveryPaymentUpdatedAt: "2026-01-13T10:00:00.000Z"
    },
    {
      ...packageTasks[0],
      id: "task-mirror-2",
      deliveryPaymentLyd: 95,
      deliveryPaymentUsd: 25,
      deliveryPaymentUpdatedAt: "2026-01-13T10:15:00.000Z"
    }
  ],
  packageScanLogs: []
});
const mirroredPackageTaskPaymentSummary = buildCustomerPaymentSummary(mirroredPackageTaskSummary, []);
assert.equal(formatCurrencyTotals(mirroredPackageTaskPaymentSummary.paidTotals), "LYD 95.00 + USD 25.00");
assert.equal(mirroredPackageTaskPaymentSummary.packageTaskPaymentCount, 1);
const awaitingDeliverySummary = buildCustomerSummary(customer, {
  ...data,
  shipments: [],
  deliveries: [],
  packageTasks: [{ ...packageTasks[0], status: "ready" }]
});
const awaitingDeliveryPaymentSummary = buildCustomerPaymentSummary(awaitingDeliverySummary, []);
assert.equal(awaitingDeliveryPaymentSummary.hasOutstandingBalance, true);
assert.equal(awaitingDeliveryPaymentSummary.hasDeliveredOutstandingBalance, false);
assert.equal(getPaymentFollowUps([awaitingDeliverySummary], []).length, 0);
const paymentPatch = buildPackageTaskPaymentPatch(
  packageTasks[0],
  { currency: "LYD", amount: "15.25" },
  new Date("2026-01-14T12:00:00.000Z")
);
assert.equal(paymentPatch.deliveryPaymentLyd.isEqual(increment(15.25)), true);
assert.equal(paymentPatch.deliveryPaymentUpdatedAt, "2026-01-14T12:00:00.000Z");
assert.match(paymentPatch.deliveryPaymentUpdatedAtLocal, /^2026-01-14T/);
const correctionPatch = buildPackageTaskPaymentCorrectionPatch(
  packageTasks[0],
  { currency: "LYD", amount: "35.10" },
  new Date("2026-01-14T13:00:00.000Z")
);
assert.equal(correctionPatch.deliveryPaymentLyd, 35.1);
assert.equal(correctionPatch.deliveryPaymentUpdatedAt, "2026-01-14T13:00:00.000Z");
const zeroCorrectionPatch = buildPackageTaskPaymentCorrectionPatch(
  packageTasks[0],
  { currency: "USD", amount: "0" },
  new Date("2026-01-14T14:00:00.000Z")
);
assert.equal(zeroCorrectionPatch.deliveryPaymentUsd, 0);

const firstOrderPurchases = getOrderPurchases(orders[0], purchases);
assert.equal(firstOrderPurchases.length, 2);

const deliveredShipmentOnlySummary = getOrderSummary(
  orders[1],
  purchases,
  shipments,
  [],
  []
);
assert.equal(deliveredShipmentOnlySummary.status, "Shipped / in shipment");
const pendingPackageSummary = getOrderSummary(
  orders[0],
  purchases,
  [],
  [],
  [{ id: "task-pending", orderId: "order-1", status: "pending" }]
);
assert.equal(pendingPackageSummary.status, "Package pending");
const partialPackageSummary = getOrderSummary(
  orders[0],
  purchases,
  [],
  [],
  [{ id: "task-partial", orderId: "order-1", status: "partiallyPacked" }]
);
assert.equal(partialPackageSummary.status, "Partially packed");
const packedPackageSummary = getOrderSummary(
  orders[0],
  purchases,
  [{ id: "shipment-packed", orderIds: ["order-1"], status: "Delivered" }],
  [],
  [{ id: "task-packed", orderId: "order-1", status: "ready" }]
);
assert.equal(packedPackageSummary.status, "Packed");
const handedOverPackageSummary = getOrderSummary(
  orders[0],
  purchases,
  [],
  [],
  [{ id: "task-handed", orderId: "order-1", status: "handedOver" }]
);
assert.equal(handedOverPackageSummary.status, "Handed over / delivered to customer");
const legacyDeliveredPackageSummary = getOrderSummary(
  orders[0],
  purchases,
  [],
  [],
  [{ id: "task-legacy", orderId: "order-1", status: "completed" }]
);
assert.equal(legacyDeliveredPackageSummary.status, "Handed over / delivered to customer");
const mixedStartedPackageSummary = getOrderSummary(
  orders[0],
  purchases,
  [],
  [],
  [
    { id: "task-mixed-pending", orderId: "order-1", status: "pending" },
    { id: "task-mixed-packed", orderId: "order-1", status: "packed" }
  ]
);
assert.equal(mixedStartedPackageSummary.status, "Partially packed");
const allPackedOrHandedSummary = getOrderSummary(
  orders[0],
  purchases,
  [],
  [],
  [
    { id: "task-all-packed", orderId: "order-1", status: "packed" },
    { id: "task-all-handed", orderId: "order-1", status: "handedOver" }
  ]
);
assert.equal(allPackedOrHandedSummary.status, "Packed");
const orderIdsPackageSummary = getOrderSummary(
  orders[0],
  purchases,
  [],
  [],
  [{ id: "task-order-ids", orderIds: ["order-1"], status: "handedOver" }]
);
assert.equal(orderIdsPackageSummary.status, "Handed over / delivered to customer");
const linkedOrderIdsPackageSummary = getOrderSummary(
  orders[0],
  purchases,
  [],
  [],
  [{ id: "task-linked-order-ids", linkedOrderIds: ["order-1"], status: "handedOver" }]
);
assert.equal(linkedOrderIdsPackageSummary.status, "Handed over / delivered to customer");
const documentReferencePackageSummary = getOrderSummary(
  orders[0],
  purchases,
  [],
  [],
  [{ id: "task-document-reference", orderRef: { path: "orders/order-1" }, status: "handedOver" }]
);
assert.equal(documentReferencePackageSummary.status, "Handed over / delivered to customer");
const shippedOpenOrderSummary = getOrderSummary(
  { ...orders[0], status: "OPEN", shipmentId: "shipment-1", shippedAt: "2026-01-15T09:00:00.000Z" },
  purchases,
  [],
  [],
  []
);
assert.equal(shippedOpenOrderSummary.status, "Shipped / in shipment");
const orderReferencesPackageSummary = getOrderSummary(
  orders[0],
  purchases,
  [],
  [],
  [{ id: "task-order-references", orderReferences: ["BB-1001"], status: "packed" }]
);
assert.equal(orderReferencesPackageSummary.status, "Packed");

const totalsText = formatCurrencyTotals(summary.currencyTotals);
assert.equal(totalsText, "LYD 100.00 + USD 25.00 + CAD 10.00");

const receiptModel = buildReceiptModel({
  customer,
  orders,
  purchases,
  shipments,
  deliveries: [],
  packageTasks,
  packageScanLogs,
  scopeLabel: "Smoke test"
});
const receiptText = buildReceiptText(receiptModel);

assert.match(receiptText, /Bella Boutique receipt/);
assert.match(receiptText, /BB-1001/);
assert.match(receiptText, /LYD 100.00 \+ USD 25.00 \+ CAD 10.00/);
assert.match(
  getReceiptImageFileName(receiptModel),
  /^bella-receipt-amina-saleh-\d{4}-\d{2}-\d{2}\.jpg$/
);

const usdExchangeRates = {
  [getReceiptExchangeRateKey("LYD", "USD")]: "0.2",
  [getReceiptExchangeRateKey("CAD", "USD")]: "0.75"
};

assert.deepEqual(getReceiptExchangeSources(receiptModel.purchases, "USD"), [
  "LYD",
  "CAD"
]);
assert.equal(hasReceiptExchangeRates(receiptModel.purchases, "USD", {}), false);
assert.equal(
  hasReceiptExchangeRates(receiptModel.purchases, "USD", usdExchangeRates),
  true
);

const usdReceiptModel = buildReceiptDisplayModel(receiptModel, {
  targetCurrency: "USD",
  exchangeRates: usdExchangeRates
});
const usdReceiptText = buildReceiptText(usdReceiptModel);

assert.equal(formatCurrencyTotals(usdReceiptModel.currencyTotals), "USD 52.50");
assert.match(usdReceiptText, /Receipt currency: USD/);
assert.match(usdReceiptText, /Exchange rates: 1 LYD = 0.2 USD \| 1 CAD = 0.75 USD/);

const missingFieldSummary = buildCustomerSummary(
  { id: "missing" },
  {
    customers: [],
    orders: [],
    purchases: [],
    requestedItems: [],
    shipments: [],
    deliveries: [],
    packageTasks: [],
    packageScanLogs: []
  }
);

assert.equal(missingFieldSummary.name, "Unknown customer");
assert.equal(missingFieldSummary.orderCount, 0);

assert.deepEqual(
  getCustomerEditableValues({
    customerName: "Legacy name",
    customerPhone: "091",
    customerAddress: "Old road",
    customerEmail: "old@example.com",
    note: "Legacy note"
  }),
  {
    name: "Legacy name",
    phone: "091",
    address: "Old road",
    email: "old@example.com",
    notes: "Legacy note"
  }
);
assert.deepEqual(
  buildCustomerUpdatePatch(
    {
      customerName: "Legacy name",
      customerPhone: "091",
      customerAddress: "Old road",
      customerEmail: "old@example.com",
      note: "Legacy note"
    },
    {
      name: "New name",
      phone: "092",
      address: "New road",
      email: "new@example.com",
      notes: "New note"
    }
  ),
  {
    customerName: "New name",
    customerPhone: "092",
    customerAddress: "New road",
    customerEmail: "new@example.com",
    note: "New note"
  }
);
assert.deepEqual(
  buildCustomerUpdatePatch(
    { id: "sparse-customer", name: "Old name" },
    {
      name: "New name",
      phone: "",
      address: "",
      email: "",
      notes: ""
    }
  ),
  {
    name: "New name"
  }
);

console.log("Smoke checks passed.");

