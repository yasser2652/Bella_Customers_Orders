import {
  CUSTOMER_RELATION_FIELDS,
  ORDER_RELATION_FIELDS,
  PURCHASE_RELATION_FIELDS,
  SHIPMENT_RELATION_FIELDS,
  identityValues,
  identityValuesFromFields,
  uniqueIdentityValues,
  valuesOverlap
} from "./identity.js";
import { normalizeCurrencyCode, formatDateInputValue } from "./formatters.js";

export function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

export function normalizeSearchText(value) {
  return String(value || "").trim().toLowerCase();
}

export function firstText(...values) {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function phoneTokens(value) {
  const digits = normalizePhone(value);
  const tokens = new Set();

  if (!digits) {
    return [];
  }

  const variants = [
    digits,
    digits.replace(/^00/, ""),
    digits.replace(/^1/, ""),
    digits.replace(/^218/, ""),
    digits.replace(/^0+/, "")
  ];

  variants.forEach((variant) => {
    const cleanVariant = String(variant || "");

    if (cleanVariant) {
      tokens.add(cleanVariant);
      tokens.add(cleanVariant.replace(/^0+/, ""));
      if (cleanVariant.length > 7) {
        tokens.add(cleanVariant.slice(-10));
        tokens.add(cleanVariant.slice(-9));
        tokens.add(cleanVariant.slice(-7));
      }
    }
  });

  return [...tokens].filter(Boolean);
}

export function phoneMatches(sourcePhone, queryPhone, { partial = true } = {}) {
  const sourceTokens = phoneTokens(sourcePhone);
  const queryTokens = phoneTokens(queryPhone);

  if (sourceTokens.length === 0 || queryTokens.length === 0) {
    return false;
  }

  return sourceTokens.some((sourceToken) =>
    queryTokens.some((queryToken) => {
      if (sourceToken === queryToken) {
        return true;
      }

      if (partial && queryToken.length >= 2) {
        return sourceToken.includes(queryToken);
      }

      if (!partial && queryToken.length >= 7) {
        return (
          sourceToken.endsWith(queryToken) || queryToken.endsWith(sourceToken)
        );
      }

      return false;
    })
  );
}

function phonesEquivalent(leftPhone, rightPhone) {
  return phoneMatches(leftPhone, rightPhone, { partial: false });
}

function namesEquivalent(leftName, rightName) {
  const cleanLeftName = normalizeSearchText(leftName);
  const cleanRightName = normalizeSearchText(rightName);

  return Boolean(cleanLeftName && cleanRightName && cleanLeftName === cleanRightName);
}

function addressesEquivalent(leftAddress, rightAddress) {
  const cleanLeftAddress = normalizeSearchText(leftAddress);
  const cleanRightAddress = normalizeSearchText(rightAddress);

  return Boolean(
    cleanLeftAddress &&
      cleanRightAddress &&
      cleanLeftAddress === cleanRightAddress
  );
}

export function getCustomerName(customer = {}) {
  return firstText(customer.name, customer.customerName, "Unknown customer");
}

export function getCustomerPhone(customer = {}) {
  return firstText(customer.phone, customer.customerPhone);
}

export function getCustomerAddress(customer = {}) {
  return firstText(customer.address, customer.customerAddress);
}

export function getCustomerEmail(customer = {}) {
  return firstText(customer.email, customer.customerEmail);
}

export function getOrderReference(order = {}) {
  const storedReference = firstText(
    order.reference,
    order.orderReference,
    order.orderNumber,
    order.number
  );

  if (storedReference) {
    return storedReference;
  }

  return `ORD-${String(order.id || order.firestoreId || "").slice(-6) || "000000"}`;
}

export function getOrderDate(order = {}) {
  return firstText(
    order.openedOn,
    order.orderDate,
    order.date,
    order.purchaseDate,
    order.createdAt,
    order.updatedAt
  );
}

export function sortOrdersNewestFirst(orders = []) {
  return [...orders].sort((leftOrder, rightOrder) => {
    const leftValue = firstText(
      leftOrder.closedAt,
      getOrderDate(leftOrder),
      leftOrder.updatedAt,
      leftOrder.createdAt,
      leftOrder.id
    );
    const rightValue = firstText(
      rightOrder.closedAt,
      getOrderDate(rightOrder),
      rightOrder.updatedAt,
      rightOrder.createdAt,
      rightOrder.id
    );

    return rightValue.localeCompare(leftValue, undefined, { numeric: true });
  });
}

export function getPurchaseItemName(purchase = {}) {
  return firstText(
    purchase.item,
    purchase.productName,
    purchase.name,
    purchase.title,
    "Item"
  );
}

export function getPurchaseQuantity(purchase = {}) {
  const quantity = Number(purchase.quantity);

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return 1;
  }

  return quantity;
}

export function getPurchaseUnitPrice(purchase = {}) {
  const quantity = getPurchaseQuantity(purchase);
  const explicitUnitPrice = Number(purchase.unitPrice);

  if (Number.isFinite(explicitUnitPrice) && explicitUnitPrice >= 0) {
    return explicitUnitPrice;
  }

  const amount = Number(purchase.amount);

  if (Number.isFinite(amount)) {
    return quantity > 0 ? amount / quantity : amount;
  }

  return 0;
}

export function roundCurrencyAmount(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.round((numericValue + Number.EPSILON) * 100) / 100;
}

export function getPurchaseLineTotal(purchase = {}) {
  const explicitUnitPrice = Number(purchase.unitPrice);

  if (Number.isFinite(explicitUnitPrice) && explicitUnitPrice >= 0) {
    return roundCurrencyAmount(getPurchaseQuantity(purchase) * explicitUnitPrice);
  }

  const amount = Number(purchase.amount);

  if (Number.isFinite(amount)) {
    return roundCurrencyAmount(amount);
  }

  return roundCurrencyAmount(getPurchaseQuantity(purchase) * getPurchaseUnitPrice(purchase));
}

export function getPurchaseCurrency(purchase = {}) {
  return normalizeCurrencyCode(purchase.currency);
}

export function getPurchaseCurrencyTotals(purchases = []) {
  const totalsByCurrency = new Map();

  (Array.isArray(purchases) ? purchases : []).forEach((purchase) => {
    const currency = getPurchaseCurrency(purchase);
    const currentTotal = totalsByCurrency.get(currency) || 0;

    totalsByCurrency.set(currency, currentTotal + getPurchaseLineTotal(purchase));
  });

  return ["", "LYD", "USD", "CAD"]
    .filter((currency) => totalsByCurrency.has(currency))
    .map((currency) => ({
      currency,
      amount: roundCurrencyAmount(totalsByCurrency.get(currency))
    }));
}

export function combineCurrencyTotals(currencyTotalsList = []) {
  const totalsByCurrency = new Map();

  currencyTotalsList.forEach((currencyTotals) => {
    (Array.isArray(currencyTotals) ? currencyTotals : []).forEach((total) => {
      const currency = normalizeCurrencyCode(total?.currency);
      const currentTotal = totalsByCurrency.get(currency) || 0;

      totalsByCurrency.set(currency, currentTotal + (Number(total?.amount) || 0));
    });
  });

  return ["", "LYD", "USD", "CAD"]
    .filter((currency) => totalsByCurrency.has(currency))
    .map((currency) => ({
      currency,
      amount: roundCurrencyAmount(totalsByCurrency.get(currency))
    }));
}

export function customerMatchesOrder(customer = {}, order = {}) {
  const customerAliases = identityValues(customer);
  const orderCustomerAliases = identityValuesFromFields(
    order,
    CUSTOMER_RELATION_FIELDS
  );

  if (valuesOverlap(customerAliases, orderCustomerAliases)) {
    return true;
  }

  if (phonesEquivalent(getCustomerPhone(customer), firstText(order.customerPhone, order.phone))) {
    return true;
  }

  if (
    namesEquivalent(getCustomerName(customer), order.customerName) &&
    addressesEquivalent(getCustomerAddress(customer), order.customerAddress)
  ) {
    return true;
  }

  return false;
}

export function customerMatchesPurchase(customer = {}, purchase = {}) {
  const customerAliases = identityValues(customer);
  const purchaseCustomerAliases = identityValuesFromFields(
    purchase,
    CUSTOMER_RELATION_FIELDS
  );

  if (valuesOverlap(customerAliases, purchaseCustomerAliases)) {
    return true;
  }

  if (
    phonesEquivalent(
      getCustomerPhone(customer),
      firstText(purchase.customerPhone, purchase.phone)
    )
  ) {
    return true;
  }

  if (
    namesEquivalent(getCustomerName(customer), purchase.customerName) &&
    addressesEquivalent(getCustomerAddress(customer), purchase.customerAddress)
  ) {
    return true;
  }

  return false;
}

export function orderMatchesPurchase(order = {}, purchase = {}) {
  const orderAliases = identityValues(order);
  const purchaseOrderAliases = identityValuesFromFields(
    purchase,
    ORDER_RELATION_FIELDS
  );

  if (valuesOverlap(orderAliases, purchaseOrderAliases)) {
    return true;
  }

  const purchaseReference = firstText(
    purchase.orderReference,
    purchase.orderNumber,
    purchase.reference
  );

  if (
    purchaseReference &&
    normalizeSearchText(purchaseReference) === normalizeSearchText(getOrderReference(order))
  ) {
    return true;
  }

  return false;
}

export function requestedItemMatchesCustomer(requestedItem = {}, customer = {}) {
  return valuesOverlap(
    identityValuesFromFields(requestedItem, CUSTOMER_RELATION_FIELDS),
    identityValues(customer)
  );
}

export function requestedItemMatchesOrder(requestedItem = {}, order = {}) {
  return valuesOverlap(
    identityValuesFromFields(requestedItem, ORDER_RELATION_FIELDS),
    identityValues(order)
  );
}

export function requestedItemMatchesPurchase(requestedItem = {}, purchase = {}) {
  return valuesOverlap(
    identityValuesFromFields(requestedItem, PURCHASE_RELATION_FIELDS),
    identityValues(purchase)
  );
}

export function getCustomerOrders(customer, orders = []) {
  return sortOrdersNewestFirst(
    (Array.isArray(orders) ? orders : []).filter((order) =>
      customerMatchesOrder(customer, order)
    )
  );
}

export function getCustomerPurchases(customer, purchases = []) {
  return (Array.isArray(purchases) ? purchases : [])
    .filter((purchase) => customerMatchesPurchase(customer, purchase))
    .sort((leftPurchase, rightPurchase) => {
      const leftDate = firstText(leftPurchase.purchaseDate, leftPurchase.createdAt);
      const rightDate = firstText(rightPurchase.purchaseDate, rightPurchase.createdAt);

      if (leftDate !== rightDate) {
        return leftDate.localeCompare(rightDate);
      }

      return String(
        leftPurchase.localId ||
          leftPurchase.androidLocalId ||
          leftPurchase.legacyId ||
          leftPurchase.id ||
          ""
      ).localeCompare(
        String(
          rightPurchase.localId ||
            rightPurchase.androidLocalId ||
            rightPurchase.legacyId ||
            rightPurchase.id ||
            ""
        ),
        undefined,
        { numeric: true }
      );
    });
}

export function getOrderPurchases(order, purchases = []) {
  return (Array.isArray(purchases) ? purchases : [])
    .filter((purchase) => orderMatchesPurchase(order, purchase))
    .sort((leftPurchase, rightPurchase) => {
      const leftDate = firstText(leftPurchase.purchaseDate, leftPurchase.createdAt);
      const rightDate = firstText(rightPurchase.purchaseDate, rightPurchase.createdAt);

      if (leftDate !== rightDate) {
        return leftDate.localeCompare(rightDate);
      }

      return String(leftPurchase.id || "").localeCompare(
        String(rightPurchase.id || ""),
        undefined,
        { numeric: true }
      );
    });
}

function getShipmentOrderIds(shipment = {}) {
  const rawIds = Array.isArray(shipment.orderIds)
    ? shipment.orderIds
    : shipment.orderId !== undefined && shipment.orderId !== null
      ? [shipment.orderId]
      : [];

  return uniqueIdentityValues(rawIds);
}

export function getOrderShipment(order, shipments = []) {
  const orderShipmentValues = identityValuesFromFields(
    order,
    SHIPMENT_RELATION_FIELDS
  );
  const orderValues = identityValues(order);

  if (orderShipmentValues.length > 0) {
    const linkedShipment =
      (Array.isArray(shipments) ? shipments : []).find((shipment) =>
        valuesOverlap(identityValues(shipment), orderShipmentValues)
      ) || null;

    if (linkedShipment) {
      return linkedShipment;
    }
  }

  return (
    (Array.isArray(shipments) ? shipments : []).find((shipment) =>
      valuesOverlap(getShipmentOrderIds(shipment), orderValues)
    ) || null
  );
}

function deliveryMatchesOrder(delivery = {}, order = {}, shipment = null) {
  const orderValues = identityValues(order);

  if (valuesOverlap(identityValuesFromFields(delivery, ORDER_RELATION_FIELDS), orderValues)) {
    return true;
  }

  const deliveryOrderIds = Array.isArray(delivery.orderIds)
    ? delivery.orderIds
    : delivery.orderId !== undefined && delivery.orderId !== null
      ? [delivery.orderId]
      : [];

  if (valuesOverlap(deliveryOrderIds, orderValues)) {
    return true;
  }

  if (
    shipment &&
    firstText(delivery.trackingNumber) &&
    normalizeSearchText(delivery.trackingNumber) ===
      normalizeSearchText(firstText(shipment.trackingNumber, shipment.tracking))
  ) {
    return true;
  }

  return false;
}

export function getOrderDelivery(order, deliveries = [], shipments = []) {
  const shipment = getOrderShipment(order, shipments);

  return (
    (Array.isArray(deliveries) ? deliveries : []).find((delivery) =>
      deliveryMatchesOrder(delivery, order, shipment)
    ) || null
  );
}

export function getCustomerDeliveries(customer, deliveries = [], orders = [], shipments = []) {
  const orderValues = orders.flatMap((order) => identityValues(order));

  return (Array.isArray(deliveries) ? deliveries : []).filter((delivery) => {
    if (
      valuesOverlap(
        identityValuesFromFields(delivery, CUSTOMER_RELATION_FIELDS),
        identityValues(customer)
      )
    ) {
      return true;
    }

    if (
      valuesOverlap(identityValuesFromFields(delivery, ORDER_RELATION_FIELDS), orderValues)
    ) {
      return true;
    }

    if (
      getCustomerAddress(customer) &&
      addressesEquivalent(getCustomerAddress(customer), delivery.address)
    ) {
      return true;
    }

    return orders.some((order) =>
      deliveryMatchesOrder(delivery, order, getOrderShipment(order, shipments))
    );
  });
}

function addPathValueVariants(values = [], value) {
  const cleanValue = String(value || "").trim().replace(/^\/+/, "");

  if (!cleanValue) {
    return values;
  }

  values.push(cleanValue);

  if (cleanValue.includes("/")) {
    const segments = cleanValue.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1];

    if (lastSegment) {
      values.push(lastSegment);
    }
  }

  return values;
}

function relationValueVariants(value) {
  if (value === undefined || value === null) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(relationValueVariants);
  }

  if (typeof value === "object") {
    const values = [];

    ["id", "firestoreId", "documentId"].forEach((field) => {
      if (value[field] !== undefined && value[field] !== null) {
        values.push(value[field]);
      }
    });

    if (typeof value.path === "string") {
      addPathValueVariants(values, value.path);
    }

    const keySegments = value?._key?.path?.segments || value?._path?.segments;

    if (Array.isArray(keySegments) && keySegments.length > 0) {
      addPathValueVariants(values, keySegments.join("/"));
    }

    return uniqueIdentityValues(values);
  }

  const values = [value];

  if (String(value).includes("/")) {
    addPathValueVariants(values, value);
  }

  return uniqueIdentityValues(values);
}

function flattenFieldValues(record = {}, fields = []) {
  return fields.flatMap((field) => relationValueVariants(record?.[field]));
}

function normalizedTextValues(values = []) {
  return uniqueIdentityValues(values).map(normalizeSearchText).filter(Boolean);
}

function textValuesOverlap(leftValues = [], rightValues = []) {
  const rightSet = new Set(normalizedTextValues(rightValues));

  return normalizedTextValues(leftValues).some((value) => rightSet.has(value));
}

function getOrderReferenceValues(order = {}) {
  return uniqueIdentityValues([
    getOrderReference(order),
    order.reference,
    order.orderReference,
    order.orderRef,
    order.orderNumber,
    order.number
  ]);
}

function getPackageTaskOrderReferenceValues(task = {}) {
  return uniqueIdentityValues([
    task.orderReference,
    task.orderRef,
    task.orderNumber,
    task.reference,
    ...flattenFieldValues(task, ["orderReferences"])
  ]);
}

const PACKAGE_NUMBER_FIELDS = [
  "packageNumber",
  "packageNo",
  "packageCode",
  "packageId",
  "packageLocalId",
  "androidPackageId",
  "androidPackageLocalId"
];

function getPackageTaskOrderValues(task = {}) {
  return uniqueIdentityValues([
    ...identityValuesFromFields(task, ORDER_RELATION_FIELDS),
    ...flattenFieldValues(task, [
      "orderId",
      "orderLocalId",
      "androidOrderId",
      "androidOrderLocalId",
      "orderFirestoreId",
      "legacyOrderId",
      "remoteOrderId",
      "orderIds",
      "orderIdsLocal",
      "linkedOrderIds",
      "order",
      "orderPath",
      "orderDocumentPath",
      "orderDocumentReference",
      "orderDocumentRef",
      "orderRefPath",
      "orderDocPath"
    ])
  ]);
}

function getPackageTaskCustomerValues(task = {}) {
  return uniqueIdentityValues([
    ...identityValuesFromFields(task, CUSTOMER_RELATION_FIELDS),
    ...flattenFieldValues(task, [
      "customerId",
      "customerLocalId",
      "androidCustomerId",
      "androidCustomerLocalId",
      "customerFirestoreId",
      "remoteCustomerId",
      "legacyCustomerId"
    ])
  ]);
}

function getPackageTaskPackageNumbers(task = {}) {
  return uniqueIdentityValues(flattenFieldValues(task, PACKAGE_NUMBER_FIELDS));
}

export function getPackageTaskGroupKey(task = {}, index = 0) {
  const packageNumber = firstText(...getPackageTaskPackageNumbers(task));
  const orderKey = firstText(
    ...getPackageTaskOrderValues(task),
    ...getPackageTaskOrderReferenceValues(task)
  );
  const customerKey = firstText(...getPackageTaskCustomerValues(task));

  if (packageNumber) {
    return ["package", packageNumber, customerKey || orderKey]
      .map(normalizeSearchText)
      .filter(Boolean)
      .join(":");
  }

  if (orderKey || customerKey) {
    return ["order", orderKey, "customer", customerKey]
      .map(normalizeSearchText)
      .filter(Boolean)
      .join(":");
  }

  return `task:${firstText(task.documentId, task.firestoreId, task.id, index)}`;
}

function getPackageGroupIdentity(tasks = []) {
  return {
    packageNumbers: uniqueIdentityValues(tasks.flatMap(getPackageTaskPackageNumbers)),
    orderValues: uniqueIdentityValues(tasks.flatMap(getPackageTaskOrderValues)),
    orderReferences: uniqueIdentityValues(tasks.flatMap(getPackageTaskOrderReferenceValues)),
    customerValues: uniqueIdentityValues(tasks.flatMap(getPackageTaskCustomerValues))
  };
}

export function getOrderPackageTasks(order, packageTasks = []) {
  const orderValues = uniqueIdentityValues([
    ...identityValues(order),
    order.id,
    order.localId,
    order.androidLocalId,
    order.firestoreId,
    order.documentId,
    order.legacyId,
    order.remoteId,
    ...flattenFieldValues(order, ["ref", "orderRef", "documentReference", "documentRef", "path"])
  ]);
  const orderReferenceValues = getOrderReferenceValues(order);

  return (Array.isArray(packageTasks) ? packageTasks : []).filter((task) => {
    const taskOrderValues = uniqueIdentityValues([
      ...identityValuesFromFields(task, ORDER_RELATION_FIELDS),
      ...flattenFieldValues(task, [
        "orderId",
        "orderLocalId",
        "androidOrderId",
        "androidOrderLocalId",
        "orderFirestoreId",
        "legacyOrderId",
        "remoteOrderId",
        "orderIds",
        "orderIdsLocal",
        "linkedOrderIds",
        "orderRef",
        "orderReference",
        "orderNumber",
        "reference",
        "order",
        "orderPath",
        "orderDocumentPath",
        "orderDocumentReference",
        "orderDocumentRef",
        "orderRefPath",
        "orderDocPath"
      ])
    ]);

    if (valuesOverlap(taskOrderValues, orderValues)) {
      return true;
    }

    return textValuesOverlap(getPackageTaskOrderReferenceValues(task), orderReferenceValues);
  });
}

export function getCustomerPackageTasks(customer, packageTasks = [], orders = []) {
  const customerValues = identityValues(customer);

  return (Array.isArray(packageTasks) ? packageTasks : []).filter((task) => {
    if (
      valuesOverlap(
        identityValuesFromFields(task, CUSTOMER_RELATION_FIELDS),
        customerValues
      ) ||
      valuesOverlap([task.customerId], customerValues)
    ) {
      return true;
    }

    return orders.some((order) => getOrderPackageTasks(order, [task]).length > 0);
  });
}

export function getOrderRequestedItems(order, requestedItems = []) {
  return (Array.isArray(requestedItems) ? requestedItems : []).filter(
    (requestedItem) => requestedItemMatchesOrder(requestedItem, order)
  );
}

export function getCustomerRequestedItems(customer, requestedItems = [], orders = []) {
  const orderValues = orders.flatMap((order) => identityValues(order));

  return (Array.isArray(requestedItems) ? requestedItems : []).filter((requestedItem) => {
    if (requestedItemMatchesCustomer(requestedItem, customer)) {
      return true;
    }

    return valuesOverlap(
      identityValuesFromFields(requestedItem, ORDER_RELATION_FIELDS),
      orderValues
    );
  });
}

export function isPendingRequestedItem(requestedItem = {}) {
  const status = normalizeSearchText(requestedItem.status);

  return !["purchased", "delivered", "cancelled", "canceled", "out of stock"].includes(
    status
  );
}

function normalizeStatusToken(value) {
  return normalizeSearchText(value).replace(/[_\s-]+/g, "");
}

export function normalizePackageTaskStatus(task = {}) {
  const token = normalizeStatusToken(firstText(task.status, task.packageStatus));

  if (["handedover", "handover", "delivered", "complete", "completed"].includes(token)) {
    return "handedOver";
  }

  if (["packed", "ready", "readyforpickup", "readyfordelivery"].includes(token)) {
    return "packed";
  }

  if (["partiallypacked", "partial", "inprogress", "packing"].includes(token)) {
    return "partiallyPacked";
  }

  const quantityNeeded = Math.max(0, Number(task.quantityNeeded) || 0);
  const quantityPacked = Math.max(0, Number(task.quantityPacked) || 0);

  if (quantityNeeded > 0 && quantityPacked >= quantityNeeded) {
    return "packed";
  }

  if (quantityPacked > 0) {
    return "partiallyPacked";
  }

  return "pending";
}

export const PACKING_STATUS = {
  PENDING: "pending",
  PARTIALLY_PACKED: "partiallyPacked",
  PACKED: "packed",
  HANDED_OVER: "handedOver"
};

export const PACKAGE_DELIVERY_STATUS = {
  DELIVERED: "delivered",
  OUT_FOR_DELIVERY: "outForDelivery",
  RETURNED: "returned",
  CANCELLED: "cancelled",
  READY: "ready",
  NOT_READY: "notReady",
  SYNC_ISSUE: "syncIssue",
  SHIPPED: "shipped",
  OPEN: "open"
};

export const CUSTOMER_ORDER_STATUS = {
  PACKAGE_PENDING: "Package pending",
  PARTIALLY_PACKED: "Partially packed",
  PACKED: "Packed",
  PACKING_HANDED_OVER: "Packing handed over",
  DELIVERED: "Delivered to customer",
  OUT_FOR_DELIVERY: "Out for delivery",
  RETURNED: "Returned",
  CANCELLED: "Delivery cancelled",
  READY: "Ready for delivery",
  NOT_READY: "Not ready for delivery",
  SYNC_ISSUE: "Delivery sync issue",
  OPEN: "Open",
  SHIPPED: "Shipped / in shipment"
};

const DELIVERY_STATUS_LABELS = {
  [PACKAGE_DELIVERY_STATUS.DELIVERED]: CUSTOMER_ORDER_STATUS.DELIVERED,
  [PACKAGE_DELIVERY_STATUS.OUT_FOR_DELIVERY]: CUSTOMER_ORDER_STATUS.OUT_FOR_DELIVERY,
  [PACKAGE_DELIVERY_STATUS.RETURNED]: CUSTOMER_ORDER_STATUS.RETURNED,
  [PACKAGE_DELIVERY_STATUS.CANCELLED]: CUSTOMER_ORDER_STATUS.CANCELLED,
  [PACKAGE_DELIVERY_STATUS.READY]: CUSTOMER_ORDER_STATUS.READY,
  [PACKAGE_DELIVERY_STATUS.NOT_READY]: CUSTOMER_ORDER_STATUS.NOT_READY,
  [PACKAGE_DELIVERY_STATUS.SYNC_ISSUE]: CUSTOMER_ORDER_STATUS.SYNC_ISSUE,
  [PACKAGE_DELIVERY_STATUS.SHIPPED]: CUSTOMER_ORDER_STATUS.SHIPPED,
  [PACKAGE_DELIVERY_STATUS.OPEN]: CUSTOMER_ORDER_STATUS.OPEN
};

const PACKING_STATUS_LABELS = {
  [PACKING_STATUS.PENDING]: CUSTOMER_ORDER_STATUS.PACKAGE_PENDING,
  [PACKING_STATUS.PARTIALLY_PACKED]: CUSTOMER_ORDER_STATUS.PARTIALLY_PACKED,
  [PACKING_STATUS.PACKED]: CUSTOMER_ORDER_STATUS.PACKED,
  [PACKING_STATUS.HANDED_OVER]: CUSTOMER_ORDER_STATUS.PACKING_HANDED_OVER
};

const DELIVERY_DATE_FIELDS = [
  "deliveryUpdatedAt",
  "deliveryUpdatedAtLocal",
  "deliveredAt",
  "deliveredAtLocal",
  "returnedAt",
  "returnedAtLocal",
  "updatedAt",
  "createdAt"
];

const SCAN_LOG_DELIVERY_STATUS_FIELDS = [
  "deliveryStatus",
  "status",
  "scanStatus",
  "event",
  "eventType",
  "action"
];

function normalizeDateValue(value) {
  if (!value) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object") {
    if (typeof value.toDate === "function") {
      const date = value.toDate();
      return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : "";
    }

    if (Number.isFinite(Number(value.seconds))) {
      const milliseconds = Number(value.seconds) * 1000 + Math.floor((Number(value.nanoseconds) || 0) / 1000000);
      return new Date(milliseconds).toISOString();
    }
  }

  return String(value || "").trim();
}

function getRecordTime(record = {}, fields = []) {
  for (const field of fields) {
    const dateValue = normalizeDateValue(record[field]);
    const date = dateValue ? new Date(dateValue) : null;

    if (date && !Number.isNaN(date.getTime())) {
      return date.getTime();
    }
  }

  return 0;
}

function normalizeDeliveryStatusValue(value) {
  const token = normalizeStatusToken(value);

  if (["delivered", "complete", "completed", "handover", "handedover"].includes(token)) {
    return PACKAGE_DELIVERY_STATUS.DELIVERED;
  }

  if (["outfordelivery", "outforpickup", "delivering", "onroute", "onway"].includes(token)) {
    return PACKAGE_DELIVERY_STATUS.OUT_FOR_DELIVERY;
  }

  if (["returned", "return", "returnedtoshop", "returnedtosender"].includes(token)) {
    return PACKAGE_DELIVERY_STATUS.RETURNED;
  }

  if (["cancelled", "canceled"].includes(token)) {
    return PACKAGE_DELIVERY_STATUS.CANCELLED;
  }

  if (["ready", "readyfordelivery"].includes(token)) {
    return PACKAGE_DELIVERY_STATUS.READY;
  }

  if (["notready", "pending", "notdelivered"].includes(token)) {
    return PACKAGE_DELIVERY_STATUS.NOT_READY;
  }

  return token || "";
}

export function normalizePackageTaskDeliveryStatus(task = {}) {
  return normalizeDeliveryStatusValue(task.deliveryStatus);
}

export function isPackageTaskDelivered(task = {}) {
  return normalizePackageTaskDeliveryStatus(task) === PACKAGE_DELIVERY_STATUS.DELIVERED;
}

function getPackingStatusLabel(status) {
  return PACKING_STATUS_LABELS[status] || status || CUSTOMER_ORDER_STATUS.PACKAGE_PENDING;
}

function getDeliveryStatusLabel(status) {
  return DELIVERY_STATUS_LABELS[status] || status || CUSTOMER_ORDER_STATUS.NOT_READY;
}

function getPackageTaskAggregatePackingStatus(packageTasks = []) {
  const packageStatuses = packageTasks.map(normalizePackageTaskStatus);

  if (packageStatuses.every((status) => status === PACKING_STATUS.HANDED_OVER)) {
    return PACKING_STATUS.HANDED_OVER;
  }

  if (packageStatuses.every((status) => [PACKING_STATUS.PACKED, PACKING_STATUS.HANDED_OVER].includes(status))) {
    return PACKING_STATUS.PACKED;
  }

  if (packageStatuses.some((status) => [PACKING_STATUS.PARTIALLY_PACKED, PACKING_STATUS.PACKED, PACKING_STATUS.HANDED_OVER].includes(status))) {
    return PACKING_STATUS.PARTIALLY_PACKED;
  }

  return PACKING_STATUS.PENDING;
}

function packagePackingIsReady(packageTasks = []) {
  const packingStatus = getPackageTaskAggregatePackingStatus(packageTasks);

  return [PACKING_STATUS.PACKED, PACKING_STATUS.HANDED_OVER].includes(packingStatus);
}

function getTaskDeliveryStatusEntry(task = {}) {
  const status = normalizePackageTaskDeliveryStatus(task);

  if (!status) {
    return null;
  }

  return {
    status,
    time: getRecordTime(task, DELIVERY_DATE_FIELDS),
    record: task
  };
}

function selectPackageGroupDeliveryStatus(entries = []) {
  if (entries.length === 0) {
    return "";
  }

  const latestDeliveredTime = Math.max(
    0,
    ...entries
      .filter((entry) => entry.status === PACKAGE_DELIVERY_STATUS.DELIVERED)
      .map((entry) => entry.time || 0)
  );
  const latestConflictingTime = Math.max(
    0,
    ...entries
      .filter((entry) => entry.status !== PACKAGE_DELIVERY_STATUS.DELIVERED)
      .map((entry) => entry.time || 0)
  );

  if (latestDeliveredTime > 0 && latestConflictingTime <= latestDeliveredTime) {
    return PACKAGE_DELIVERY_STATUS.DELIVERED;
  }

  const grouped = new Map();

  entries.forEach((entry) => {
    const current = grouped.get(entry.status) || { count: 0, latestTime: 0 };
    grouped.set(entry.status, {
      count: current.count + 1,
      latestTime: Math.max(current.latestTime, entry.time || 0)
    });
  });

  return [...grouped.entries()]
    .sort((leftEntry, rightEntry) => {
      const left = leftEntry[1];
      const right = rightEntry[1];

      if (right.count !== left.count) {
        return right.count - left.count;
      }

      return right.latestTime - left.latestTime;
    })[0]?.[0] || entries[0].status;
}

function getScanLogDeliveryStatus(log = {}) {
  return normalizeDeliveryStatusValue(
    firstText(...SCAN_LOG_DELIVERY_STATUS_FIELDS.map((field) => log[field]))
  );
}

function getScanLogOrderReferenceValues(log = {}) {
  return uniqueIdentityValues([
    log.orderReference,
    log.orderRef,
    log.orderNumber,
    log.reference,
    log.remoteOrderNumber
  ]);
}

function scanLogMatchesPackageGroup(log = {}, groupIdentity = {}) {
  const logPackageNumbers = uniqueIdentityValues(flattenFieldValues(log, PACKAGE_NUMBER_FIELDS));
  const logOrderValues = uniqueIdentityValues([
    ...identityValuesFromFields(log, ORDER_RELATION_FIELDS),
    ...flattenFieldValues(log, ["orderId", "orderIds", "linkedOrderIds"])
  ]);
  const logCustomerValues = uniqueIdentityValues([
    ...identityValuesFromFields(log, CUSTOMER_RELATION_FIELDS),
    ...flattenFieldValues(log, ["customerId"])
  ]);

  if (valuesOverlap(logPackageNumbers, groupIdentity.packageNumbers)) {
    return true;
  }

  if (valuesOverlap(logOrderValues, groupIdentity.orderValues)) {
    return true;
  }

  if (textValuesOverlap(getScanLogOrderReferenceValues(log), groupIdentity.orderReferences)) {
    return true;
  }

  return (
    groupIdentity.orderValues.length === 0 &&
    groupIdentity.orderReferences.length === 0 &&
    valuesOverlap(logCustomerValues, groupIdentity.customerValues)
  );
}

function getPackageGroupScanEvidence(groupIdentity = {}, packageScanLogs = []) {
  return (Array.isArray(packageScanLogs) ? packageScanLogs : [])
    .map((log) => ({
      log,
      status: getScanLogDeliveryStatus(log),
      time: getRecordTime(log, ["deliveryUpdatedAt", "deliveryUpdatedAtLocal", "scannedAt", "scanTime", "timestamp", "updatedAt", "createdAt"])
    }))
    .filter(({ log, status }) =>
      [
        PACKAGE_DELIVERY_STATUS.DELIVERED,
        PACKAGE_DELIVERY_STATUS.OUT_FOR_DELIVERY,
        PACKAGE_DELIVERY_STATUS.RETURNED
      ].includes(status) && scanLogMatchesPackageGroup(log, groupIdentity)
    )
    .sort((leftEntry, rightEntry) => (rightEntry.time || 0) - (leftEntry.time || 0));
}

export function getPackageTaskGroups(packageTasks = [], packageScanLogs = []) {
  const groupsByKey = new Map();

  (Array.isArray(packageTasks) ? packageTasks : []).forEach((task, index) => {
    const key = getPackageTaskGroupKey(task, index);
    const current = groupsByKey.get(key) || [];

    current.push(task);
    groupsByKey.set(key, current);
  });

  return [...groupsByKey.entries()].map(([key, tasks]) => {
    const groupIdentity = getPackageGroupIdentity(tasks);
    const packingStatus = getPackageTaskAggregatePackingStatus(tasks);
    const deliveryEntries = tasks.map(getTaskDeliveryStatusEntry).filter(Boolean);
    const scanLogEvidence = deliveryEntries.length === 0
      ? getPackageGroupScanEvidence(groupIdentity, packageScanLogs)
      : [];
    const hasScanLogInconsistency = deliveryEntries.length === 0 && scanLogEvidence.length > 0;
    const deliveryStatus = hasScanLogInconsistency
      ? PACKAGE_DELIVERY_STATUS.SYNC_ISSUE
      : selectPackageGroupDeliveryStatus(deliveryEntries) ||
        (packagePackingIsReady(tasks) ? PACKAGE_DELIVERY_STATUS.READY : PACKAGE_DELIVERY_STATUS.NOT_READY);

    return {
      key,
      tasks,
      identity: groupIdentity,
      packingStatus,
      packingStatusLabel: getPackingStatusLabel(packingStatus),
      deliveryStatus,
      deliveryStatusLabel: getDeliveryStatusLabel(deliveryStatus),
      hasDeliveryStatus: deliveryEntries.length > 0,
      hasScanLogInconsistency,
      scanLogEvidence: scanLogEvidence.slice(0, 3).map(({ log, status, time }) => ({
        status,
        statusLabel: getDeliveryStatusLabel(status),
        time,
        documentId: firstText(log.documentId, log.firestoreId, log.id),
        reference: firstText(log.orderReference, log.orderNumber, log.orderRef, log.reference)
      }))
    };
  });
}

function aggregateOrderPackingStatus(packageGroups = []) {
  const statuses = packageGroups.map((group) => group.packingStatus);

  if (statuses.length === 0) {
    return "";
  }

  if (statuses.every((status) => status === PACKING_STATUS.HANDED_OVER)) {
    return PACKING_STATUS.HANDED_OVER;
  }

  if (statuses.every((status) => [PACKING_STATUS.PACKED, PACKING_STATUS.HANDED_OVER].includes(status))) {
    return PACKING_STATUS.PACKED;
  }

  if (statuses.some((status) => [PACKING_STATUS.PARTIALLY_PACKED, PACKING_STATUS.PACKED, PACKING_STATUS.HANDED_OVER].includes(status))) {
    return PACKING_STATUS.PARTIALLY_PACKED;
  }

  return PACKING_STATUS.PENDING;
}

function aggregateOrderDeliveryStatus(packageGroups = []) {
  const statuses = packageGroups.map((group) => group.deliveryStatus);

  if (statuses.length === 0) {
    return "";
  }

  if (statuses.includes(PACKAGE_DELIVERY_STATUS.SYNC_ISSUE)) {
    return PACKAGE_DELIVERY_STATUS.SYNC_ISSUE;
  }

  if (statuses.every((status) => status === PACKAGE_DELIVERY_STATUS.DELIVERED)) {
    return PACKAGE_DELIVERY_STATUS.DELIVERED;
  }

  if (statuses.includes(PACKAGE_DELIVERY_STATUS.RETURNED)) {
    return PACKAGE_DELIVERY_STATUS.RETURNED;
  }

  if (statuses.includes(PACKAGE_DELIVERY_STATUS.OUT_FOR_DELIVERY)) {
    return PACKAGE_DELIVERY_STATUS.OUT_FOR_DELIVERY;
  }

  if (statuses.every((status) => status === PACKAGE_DELIVERY_STATUS.READY)) {
    return PACKAGE_DELIVERY_STATUS.READY;
  }

  return PACKAGE_DELIVERY_STATUS.NOT_READY;
}

function orderHasShipmentLink(order = {}, shipment = null, delivery = null) {
  return Boolean(
    shipment ||
      delivery ||
      order.shipmentId ||
      order.shipmentDate ||
      order.shippedAt ||
      order.shippedOn ||
      order.shippedDate ||
      order.shipmentTrackingNumber ||
      order.closedAt
  );
}

function orderHasItems(order = {}, purchases = []) {
  return Boolean(
    (Array.isArray(purchases) && purchases.length > 0) ||
      (Array.isArray(order.items) && order.items.length > 0) ||
      Number(order.itemCount) > 0
  );
}

function orderMarkedForShipment(order = {}) {
  const token = normalizeStatusToken(firstText(order.status, order.orderStatus, order.shipmentStatus));

  return [
    "shipped",
    "intransit",
    "inshipment",
    "delivered",
    "complete",
    "completed",
    "closed"
  ].includes(token);
}

function getFallbackOrderStatusDetail(order = {}, shipments = [], deliveries = [], purchases = []) {
  const explicitStatus = firstText(order.status, order.orderStatus);
  const shipment = getOrderShipment(order, shipments);
  const delivery = getOrderDelivery(order, deliveries, shipments);
  const deliveryStatus = orderMarkedForShipment(order) || orderHasShipmentLink(order, shipment, delivery)
    ? PACKAGE_DELIVERY_STATUS.SHIPPED
    : PACKAGE_DELIVERY_STATUS.OPEN;

  if (deliveryStatus === PACKAGE_DELIVERY_STATUS.OPEN && normalizeStatusToken(explicitStatus) !== "open" && !orderHasItems(order, purchases)) {
    return {
      deliveryStatus: PACKAGE_DELIVERY_STATUS.OPEN,
      deliveryStatusLabel: explicitStatus || CUSTOMER_ORDER_STATUS.OPEN,
      packingStatus: "",
      packingStatusLabel: "No package tasks",
      packageGroups: [],
      deliverySyncIssues: []
    };
  }

  return {
    deliveryStatus,
    deliveryStatusLabel: getDeliveryStatusLabel(deliveryStatus),
    packingStatus: "",
    packingStatusLabel: "No package tasks",
    packageGroups: [],
    deliverySyncIssues: []
  };
}

export function isCustomerFacingOrderDeliveredStatus(statusOrSummary) {
  if (statusOrSummary && typeof statusOrSummary === "object") {
    return statusOrSummary.deliveryStatus === PACKAGE_DELIVERY_STATUS.DELIVERED;
  }

  return statusOrSummary === CUSTOMER_ORDER_STATUS.DELIVERED;
}

export function isCustomerFacingOrderOpenStatus(statusOrSummary) {
  if (statusOrSummary && typeof statusOrSummary === "object") {
    return statusOrSummary.deliveryStatus === PACKAGE_DELIVERY_STATUS.OPEN;
  }

  return statusOrSummary === CUSTOMER_ORDER_STATUS.OPEN;
}

export function getCustomerFacingOrderStatusDetail(
  order = {},
  packageTasks = [],
  shipments = [],
  deliveries = [],
  purchases = [],
  packageScanLogs = []
) {
  const orderPackageTasks = getOrderPackageTasks(order, packageTasks);

  if (orderPackageTasks.length === 0) {
    return getFallbackOrderStatusDetail(order, shipments, deliveries, purchases);
  }

  const packageGroups = getPackageTaskGroups(orderPackageTasks, packageScanLogs);
  const packingStatus = aggregateOrderPackingStatus(packageGroups);
  const deliveryStatus = aggregateOrderDeliveryStatus(packageGroups);
  const deliverySyncIssues = packageGroups.filter((group) => group.hasScanLogInconsistency);

  return {
    deliveryStatus,
    deliveryStatusLabel: getDeliveryStatusLabel(deliveryStatus),
    packingStatus,
    packingStatusLabel: getPackingStatusLabel(packingStatus),
    packageGroups,
    deliverySyncIssues
  };
}

export function getCustomerFacingOrderStatus(
  order = {},
  packageTasks = [],
  shipments = [],
  deliveries = [],
  purchases = [],
  packageScanLogs = []
) {
  return getCustomerFacingOrderStatusDetail(
    order,
    packageTasks,
    shipments,
    deliveries,
    purchases,
    packageScanLogs
  ).deliveryStatusLabel;
}

export function getOrderStatus(order = {}, shipments = [], deliveries = [], packageTasks = []) {
  return getCustomerFacingOrderStatus(order, packageTasks, shipments, deliveries);
}

export function isOrderOpen(order = {}, shipments = [], deliveries = [], packageTasks = [], purchases = []) {
  return isCustomerFacingOrderOpenStatus(
    getCustomerFacingOrderStatus(order, packageTasks, shipments, deliveries, purchases)
  );
}

export function getOrderSummary(
  order,
  purchases = [],
  shipments = [],
  deliveries = [],
  packageTasks = [],
  packageScanLogs = []
) {
  const orderPurchases = getOrderPurchases(order, purchases);
  const shipment = getOrderShipment(order, shipments);
  const delivery = getOrderDelivery(order, deliveries, shipments);
  const tasks = getOrderPackageTasks(order, packageTasks);
  const currencyTotals = getPurchaseCurrencyTotals(orderPurchases);
  const statusDetail = getCustomerFacingOrderStatusDetail(
    order,
    packageTasks,
    shipments,
    deliveries,
    orderPurchases,
    packageScanLogs
  );

  return {
    purchases: orderPurchases,
    itemCount: orderPurchases.length,
    totalAmount: orderPurchases.reduce(
      (runningTotal, purchase) => runningTotal + getPurchaseLineTotal(purchase),
      0
    ),
    currencyTotals,
    shipment,
    delivery,
    packageTasks: tasks,
    packageGroups: statusDetail.packageGroups,
    packingStatus: statusDetail.packingStatus,
    packingStatusLabel: statusDetail.packingStatusLabel,
    deliveryStatus: statusDetail.deliveryStatus,
    deliveryStatusLabel: statusDetail.deliveryStatusLabel,
    deliverySyncIssues: statusDetail.deliverySyncIssues,
    status: statusDetail.deliveryStatusLabel
  };
}

export function getPurchaseReceiptUrl(purchase = {}) {
  const receipt = purchase.receipt;

  if (receipt && typeof receipt === "object") {
    return firstText(receipt.url, receipt.dataUrl, receipt.downloadUrl);
  }

  return firstText(
    purchase.receiptUrl,
    purchase.receiptLink,
    purchase.photoUrl,
    purchase.imageUrl,
    purchase.fileUrl
  );
}

export function purchaseHasOrderAlias(purchase = {}) {
  return identityValuesFromFields(purchase, ORDER_RELATION_FIELDS).length > 0;
}

export function dateIsInRange(dateValue, startDate, endDate) {
  const cleanDate = formatDateInputValue(dateValue);

  if (!cleanDate) {
    return false;
  }

  return (!startDate || cleanDate >= startDate) && (!endDate || cleanDate <= endDate);
}

function dedupeRecordsByIdentity(records = []) {
  const seen = new Set();

  return records.filter((record, index) => {
    const keys = identityValues(record);
    const fallbackKey = `${firstText(record?.id, record?.firestoreId, record?.trackingNumber)}-${index}`;
    const compareKeys = keys.length ? keys : [fallbackKey];

    if (compareKeys.some((key) => seen.has(key))) {
      return false;
    }

    compareKeys.forEach((key) => seen.add(key));
    return true;
  });
}

export function buildCustomerSummary(
  customer,
  { orders = [], purchases = [], requestedItems = [], shipments = [], deliveries = [], packageTasks = [], packageScanLogs = [] }
) {
  const customerOrders = getCustomerOrders(customer, orders);
  const customerPurchases = getCustomerPurchases(customer, purchases);
  const customerRequestedItems = getCustomerRequestedItems(
    customer,
    requestedItems,
    customerOrders
  );
  const customerDeliveries = getCustomerDeliveries(
    customer,
    deliveries,
    customerOrders,
    shipments
  );
  const customerPackageTasks = getCustomerPackageTasks(
    customer,
    packageTasks,
    customerOrders
  );
  const pendingRequestedItems = customerRequestedItems.filter(isPendingRequestedItem);
  const orderSummaries = customerOrders.map((order) =>
    getOrderSummary(order, purchases, shipments, deliveries, packageTasks, packageScanLogs)
  );
  const shipmentsForOrders = dedupeRecordsByIdentity(orderSummaries
    .map((summary) => summary.shipment)
    .filter(Boolean));
  const currencyTotals = getPurchaseCurrencyTotals(customerPurchases);
  const searchText = normalizeSearchText(
    [
      getCustomerName(customer),
      getCustomerPhone(customer),
      getCustomerAddress(customer),
      getCustomerEmail(customer),
      customer.notes,
      ...identityValues(customer)
    ].join(" ")
  );

  return {
    customer,
    key: identityValues(customer)[0] || String(customer.name || customer.phone || ""),
    name: getCustomerName(customer),
    phone: getCustomerPhone(customer),
    address: getCustomerAddress(customer),
    email: getCustomerEmail(customer),
    notes: firstText(customer.notes, customer.note),
    orders: customerOrders,
    purchases: customerPurchases,
    requestedItems: customerRequestedItems,
    pendingRequestedItems,
    shipments: shipmentsForOrders,
    deliveries: dedupeRecordsByIdentity(customerDeliveries),
    packageTasks: dedupeRecordsByIdentity(customerPackageTasks),
    orderSummaries,
    orderCount: customerOrders.length,
    purchaseCount: customerPurchases.length,
    currencyTotals,
    searchText
  };
}

export function customerMatchesSearch(summary, query) {
  const cleanQuery = normalizeSearchText(query);
  const phoneQuery = normalizePhone(query);

  if (!cleanQuery && !phoneQuery) {
    return true;
  }

  if (phoneQuery && phoneMatches(summary.phone, phoneQuery)) {
    return true;
  }

  return Boolean(cleanQuery && summary.searchText.includes(cleanQuery));
}
