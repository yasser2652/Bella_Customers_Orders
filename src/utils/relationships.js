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

export function getOrderPackageTasks(order, packageTasks = []) {
  const orderValues = identityValues(order);
  const orderReference = normalizeSearchText(getOrderReference(order));

  return (Array.isArray(packageTasks) ? packageTasks : []).filter((task) => {
    if (valuesOverlap(identityValuesFromFields(task, ORDER_RELATION_FIELDS), orderValues)) {
      return true;
    }

    if (valuesOverlap([task.orderId], orderValues)) {
      return true;
    }

    return (
      firstText(task.orderReference) &&
      normalizeSearchText(task.orderReference) === orderReference
    );
  });
}

export function getCustomerPackageTasks(customer, packageTasks = [], orders = []) {
  const orderValues = orders.flatMap((order) => identityValues(order));

  return (Array.isArray(packageTasks) ? packageTasks : []).filter((task) => {
    if (
      valuesOverlap(
        identityValuesFromFields(task, CUSTOMER_RELATION_FIELDS),
        identityValues(customer)
      ) ||
      valuesOverlap([task.customerId], identityValues(customer))
    ) {
      return true;
    }

    return valuesOverlap(
      uniqueIdentityValues([
        ...identityValuesFromFields(task, ORDER_RELATION_FIELDS),
        task.orderId
      ]),
      orderValues
    );
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

export function isPackageTaskDelivered(task = {}) {
  return normalizePackageTaskStatus(task) === "handedOver";
}

function recordHasDeliveredStatus(record = {}, ...fields) {
  return fields.some((field) => {
    const token = normalizeStatusToken(record?.[field]);

    return ["delivered", "complete", "completed", "handedover", "handover"].includes(token);
  });
}

export function getOrderStatus(order = {}, shipments = [], deliveries = [], packageTasks = []) {
  const explicitStatus = firstText(order.status);
  const explicitStatusText = normalizeSearchText(explicitStatus);

  if (explicitStatusText === "open") {
    return "Open";
  }

  if (["delivered", "complete", "completed"].includes(explicitStatusText)) {
    return "Delivered";
  }

  if (["shipped", "in transit", "in-transit"].includes(explicitStatusText)) {
    return explicitStatus === "in transit" ? "In transit" : explicitStatus;
  }

  const shipment = getOrderShipment(order, shipments);
  const delivery = getOrderDelivery(order, deliveries, shipments);
  const orderPackageTasks = getOrderPackageTasks(order, packageTasks);
  const packageStatuses = orderPackageTasks.map(normalizePackageTaskStatus);
  const hasPackageTasks = packageStatuses.length > 0;
  const allPackagesDelivered =
    hasPackageTasks && packageStatuses.every((status) => status === "handedOver");
  const anyPackageStarted =
    hasPackageTasks && packageStatuses.some((status) => status !== "pending");
  const allPackagesPacked =
    hasPackageTasks && packageStatuses.every((status) => ["packed", "handedOver"].includes(status));
  const shipmentStatus = firstText(shipment?.status, order.shipmentStatus);
  const deliveryStatus = firstText(delivery?.status, order.deliveryStatus);

  if (
    allPackagesDelivered ||
    recordHasDeliveredStatus(delivery, "status", "deliveryStatus") ||
    recordHasDeliveredStatus(order, "deliveryStatus")
  ) {
    return "Delivered";
  }

  if (!hasPackageTasks && recordHasDeliveredStatus(shipment, "status", "shipmentStatus")) {
    return "Delivered";
  }

  if (allPackagesPacked || anyPackageStarted) {
    return "Shipped";
  }

  if (
    shipment ||
    delivery ||
    order.shipmentId ||
    order.shipmentDate ||
    order.shipmentTrackingNumber ||
    order.closedAt
  ) {
    const transportStatus = shipmentStatus || deliveryStatus;

    return transportStatus && normalizeSearchText(transportStatus).includes("delivered")
      ? "Shipped"
      : transportStatus || "Shipped";
  }

  return explicitStatus || "Open";
}

export function isOrderOpen(order = {}, shipments = [], deliveries = []) {
  return getOrderStatus(order, shipments, deliveries) === "Open";
}

export function getOrderSummary(
  order,
  purchases = [],
  shipments = [],
  deliveries = [],
  packageTasks = []
) {
  const orderPurchases = getOrderPurchases(order, purchases);
  const shipment = getOrderShipment(order, shipments);
  const delivery = getOrderDelivery(order, deliveries, shipments);
  const tasks = getOrderPackageTasks(order, packageTasks);
  const currencyTotals = getPurchaseCurrencyTotals(orderPurchases);

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
    status: getOrderStatus(order, shipments, deliveries, packageTasks)
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
  { orders = [], purchases = [], requestedItems = [], shipments = [], deliveries = [], packageTasks = [] }
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
    getOrderSummary(order, purchases, shipments, deliveries, packageTasks)
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
