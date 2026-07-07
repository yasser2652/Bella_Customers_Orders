import assert from "node:assert/strict";
import { formatCurrencyTotals } from "../src/utils/formatters.js";
import {
  buildCustomerSummary,
  customerMatchesSearch,
  getOrderPurchases,
  getOrderSummary
} from "../src/utils/relationships.js";
import {
  buildCustomerUpdatePatch,
  getCustomerEditableValues
} from "../src/services/firestoreWrite.js";
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
  packageTasks: []
};

const summary = buildCustomerSummary(customer, data);

assert.equal(customerMatchesSearch(summary, "+218 91 555 0123"), true);
assert.equal(customerMatchesSearch(summary, "5550"), true);
assert.equal(customerMatchesSearch(summary, "amina"), true);
assert.equal(summary.orders.length, 2);
assert.equal(summary.purchases.length, 3);
assert.equal(summary.pendingRequestedItems.length, 1);

const firstOrderPurchases = getOrderPurchases(orders[0], purchases);
assert.equal(firstOrderPurchases.length, 2);

const deliveredSummary = getOrderSummary(
  orders[1],
  purchases,
  shipments,
  [],
  []
);
assert.equal(deliveredSummary.status, "Delivered");

const totalsText = formatCurrencyTotals(summary.currencyTotals);
assert.equal(totalsText, "LYD 100.00 + USD 25.00 + CAD 10.00");

const receiptModel = buildReceiptModel({
  customer,
  orders,
  purchases,
  shipments,
  deliveries: [],
  packageTasks: [],
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
    packageTasks: []
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
