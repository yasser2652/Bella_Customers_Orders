import {
  CUSTOMER_RELATION_FIELDS,
  ORDER_RELATION_FIELDS,
  identityValues,
  identityValuesFromFields,
  uniqueIdentityValues,
  valuesOverlap
} from "./identity.js";
import {
  combineCurrencyTotals,
  firstText,
  getOrderReference,
  roundCurrencyAmount
} from "./relationships.js";

const PAYMENT_FIELDS = [
  ["deliveryPaymentLyd", "LYD"],
  ["deliveryPaymentUsd", "USD"]
];

const PACKAGE_TASK_RELATION_FIELDS = [
  "packageTaskId",
  "packageTaskLocalId",
  "androidPackageTaskId",
  "androidPackageTaskLocalId",
  "packageTaskFirestoreId",
  "remotePackageTaskId",
  "legacyPackageTaskId",
  "taskId",
  "taskLocalId",
  "androidTaskId",
  "androidTaskLocalId",
  "taskFirestoreId",
  "remoteTaskId",
  "legacyTaskId"
];

const LOG_ORDER_REFERENCE_FIELDS = [
  "orderReference",
  "orderNumber",
  "orderRef",
  "reference",
  "remoteOrderNumber"
];

const PAYMENT_DATE_FIELDS = [
  "deliveryPaymentUpdatedAt",
  "deliveryPaymentUpdatedAtLocal",
  "deliveredAt",
  "scannedAt",
  "scanTime",
  "timestamp",
  "updatedAt",
  "createdAt"
];

function normalizeComparableText(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePaymentAmount(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return 0;
  }

  return roundCurrencyAmount(numericValue);
}

function hasCurrencyTotals(currencyTotals = []) {
  return (Array.isArray(currencyTotals) ? currencyTotals : []).some(
    (total) => Math.abs(Number(total?.amount) || 0) > 0.009
  );
}

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

function getPaymentDate(record = {}) {
  for (const field of PAYMENT_DATE_FIELDS) {
    const value = normalizeDateValue(record[field]);

    if (value) {
      return value;
    }
  }

  return "";
}

function getDateTimeValue(value) {
  const dateValue = normalizeDateValue(value);
  const date = dateValue ? new Date(dateValue) : null;

  return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
}

function getPaymentTime(record = {}) {
  return getDateTimeValue(getPaymentDate(record));
}

function latestDateValue(values = []) {
  return (
    values
      .filter(Boolean)
      .sort((leftValue, rightValue) => {
        const leftTime = getDateTimeValue(leftValue);
        const rightTime = getDateTimeValue(rightValue);

        return rightTime - leftTime;
      })[0] || ""
  );
}

function totalsToMap(currencyTotals = []) {
  const map = new Map();

  (Array.isArray(currencyTotals) ? currencyTotals : []).forEach((total) => {
    const currency = String(total?.currency || "").trim().toUpperCase();
    const amount = Number(total?.amount) || 0;

    map.set(currency, roundCurrencyAmount((map.get(currency) || 0) + amount));
  });

  return map;
}

function mapToCurrencyTotals(map, { positiveOnly = false } = {}) {
  const currencies = ["", "LYD", "USD", "CAD", ...map.keys()];
  const seen = new Set();

  return currencies
    .filter((currency) => {
      if (seen.has(currency) || !map.has(currency)) {
        return false;
      }

      seen.add(currency);
      return true;
    })
    .map((currency) => ({
      currency,
      amount: roundCurrencyAmount(map.get(currency) || 0)
    }))
    .filter((total) => !positiveOnly || total.amount > 0.009);
}

function subtractCurrencyTotals(leftTotals = [], rightTotals = []) {
  const leftMap = totalsToMap(leftTotals);
  const rightMap = totalsToMap(rightTotals);
  const result = new Map();
  const currencies = new Set([...leftMap.keys(), ...rightMap.keys()]);

  currencies.forEach((currency) => {
    result.set(
      currency,
      roundCurrencyAmount((leftMap.get(currency) || 0) - (rightMap.get(currency) || 0))
    );
  });

  return mapToCurrencyTotals(result, { positiveOnly: true });
}

function getPaymentTotals(record = {}) {
  return PAYMENT_FIELDS.map(([field, currency]) => ({
    currency,
    amount: normalizePaymentAmount(record[field])
  })).filter((total) => total.amount > 0);
}

function getSourceKey(record = {}, fallback = "") {
  return (
    identityValues(record)[0] ||
    firstText(
      record.packageTaskId,
      record.taskId,
      record.orderId,
      record.orderReference,
      record.reference,
      fallback
    )
  );
}

function getTaskKey(task = {}, index = 0) {
  return getSourceKey(task, `task-${index}`);
}

function getTaskOrderReference(task = {}) {
  return firstText(task.orderReference, task.orderNumber, task.orderRef, task.reference);
}

function getTaskPaymentGroupKey(task = {}, index = 0) {
  const orderKey = firstText(
    ...identityValuesFromFields(task, ORDER_RELATION_FIELDS),
    task.orderId,
    getTaskOrderReference(task)
  );

  if (orderKey) {
    return `order:${normalizeComparableText(orderKey)}`;
  }

  const customerKey = firstText(...identityValuesFromFields(task, CUSTOMER_RELATION_FIELDS), task.customerId);
  const deliveryKey = firstText(task.packageId, task.packageLocalId, task.deliveryId, task.shipmentId, task.trackingNumber, task.tracking);

  if (customerKey && deliveryKey) {
    return `delivery:${normalizeComparableText(`${customerKey}:${deliveryKey}`)}`;
  }

  return `task:${getTaskKey(task, index)}`;
}

function getLogOrderReference(log = {}) {
  return firstText(...LOG_ORDER_REFERENCE_FIELDS.map((field) => log[field]));
}

function logMatchesTask(log = {}, task = {}) {
  const logTaskValues = uniqueIdentityValues([
    ...identityValuesFromFields(log, PACKAGE_TASK_RELATION_FIELDS),
    log.packageTask?.id,
    log.packageTask?.firestoreId,
    log.task?.id,
    log.task?.firestoreId
  ]);

  if (valuesOverlap(logTaskValues, identityValues(task))) {
    return true;
  }

  return Boolean(
    getLogOrderReference(log) &&
      getTaskOrderReference(task) &&
      normalizeComparableText(getLogOrderReference(log)) ===
        normalizeComparableText(getTaskOrderReference(task))
  );
}

function logMatchesOrderOrTask(log = {}, orders = [], tasks = []) {
  const orderValues = (Array.isArray(orders) ? orders : []).flatMap((order) => identityValues(order));
  const orderReferences = (Array.isArray(orders) ? orders : []).map(getOrderReference).filter(Boolean);

  if (valuesOverlap(identityValuesFromFields(log, ORDER_RELATION_FIELDS), orderValues)) {
    return true;
  }

  if (
    getLogOrderReference(log) &&
    orderReferences.some(
      (reference) => normalizeComparableText(reference) === normalizeComparableText(getLogOrderReference(log))
    )
  ) {
    return true;
  }

  return (Array.isArray(tasks) ? tasks : []).some((task) => logMatchesTask(log, task));
}

function logMatchesSummary(log = {}, summary = {}) {
  const customerValues = identityValues(summary.customer);

  if (valuesOverlap(identityValuesFromFields(log, CUSTOMER_RELATION_FIELDS), customerValues)) {
    return true;
  }

  return logMatchesOrderOrTask(log, summary.orders, summary.packageTasks);
}

function selectLatestSourcesByGroup(sources = []) {
  const latestByGroup = new Map();

  sources.forEach((source) => {
    const current = latestByGroup.get(source.groupKey);

    if (!current || getPaymentTime(source.record) >= getPaymentTime(current.record)) {
      latestByGroup.set(source.groupKey, source);
    }
  });

  return [...latestByGroup.values()];
}

function buildPaymentSources(summary = {}, packageScanLogs = [], scope = {}) {
  const tasks = Array.isArray(scope.packageTasks)
    ? scope.packageTasks
    : Array.isArray(summary.packageTasks)
      ? summary.packageTasks
      : [];
  const orders = Array.isArray(scope.orders) ? scope.orders : summary.orders;
  const matchLog = scope.requireOrderOrTaskMatch
    ? (log) => logMatchesOrderOrTask(log, orders, tasks)
    : (log) => logMatchesSummary(log, summary);
  const rawTaskSources = tasks
    .map((task, index) => ({
      type: "packageTask",
      groupKey: getTaskPaymentGroupKey(task, index),
      record: task,
      currencyTotals: getPaymentTotals(task)
    }))
    .filter((source) => hasCurrencyTotals(source.currencyTotals));
  // Delivery payment fields can be mirrored onto every package task for the same order.
  // Count the latest order-level record once instead of summing duplicated task documents.
  const taskSources = selectLatestSourcesByGroup(rawTaskSources);
  const taskSourcesByGroup = new Map(
    taskSources.map((source) => [source.groupKey, source])
  );
  const logSources = (Array.isArray(packageScanLogs) ? packageScanLogs : [])
    .filter((log) => hasCurrencyTotals(getPaymentTotals(log)))
    .filter(matchLog)
    .map((log, index) => {
      const matchingTaskIndex = tasks.findIndex((task) => logMatchesTask(log, task));
      const groupKey =
        matchingTaskIndex >= 0
          ? getTaskPaymentGroupKey(tasks[matchingTaskIndex], matchingTaskIndex)
          : `log:${firstText(
              ...identityValuesFromFields(log, ORDER_RELATION_FIELDS),
              getLogOrderReference(log),
              getSourceKey(log, `log-${index}`)
            )}`;
      const taskSource = taskSourcesByGroup.get(groupKey);
      const taskCurrencies = new Set(
        (taskSource?.currencyTotals || []).map((total) => total.currency)
      );
      const currencyTotals = getPaymentTotals(log).filter(
        (total) => !taskCurrencies.has(total.currency)
      );

      if (!hasCurrencyTotals(currencyTotals)) {
        return null;
      }

      return {
        type: "packageScanLog",
        groupKey,
        record: log,
        currencyTotals
      };
    })
    .filter(Boolean);

  return [...taskSources, ...selectLatestSourcesByGroup(logSources)];
}

function getPaymentStatus({ owedTotals = [], paidTotals = [], remainingTotals = [], overpaidTotals = [] } = {}) {
  const hasOwedBalance = hasCurrencyTotals(owedTotals);
  const hasRecordedPayment = hasCurrencyTotals(paidTotals);
  const hasOutstandingBalance = hasCurrencyTotals(remainingTotals);

  if (hasOwedBalance && hasOutstandingBalance && hasRecordedPayment) {
    return "partial";
  }

  if (hasOwedBalance && hasOutstandingBalance) {
    return "unpaid";
  }

  if (hasOwedBalance && hasCurrencyTotals(overpaidTotals)) {
    return "overpaid";
  }

  if (hasOwedBalance) {
    return "paid";
  }

  return "no-balance";
}

function getDeliveredPaymentScope(summary = {}) {
  const orders = Array.isArray(summary.orders) ? summary.orders : [];
  const deliveredEntries = (Array.isArray(summary.orderSummaries) ? summary.orderSummaries : [])
    .map((orderSummary, index) => ({
      order: orders[index],
      orderSummary
    }))
    .filter(({ orderSummary }) => orderSummary?.status === "Delivered");

  return {
    orders: deliveredEntries.map(({ order }) => order).filter(Boolean),
    orderSummaries: deliveredEntries.map(({ orderSummary }) => orderSummary).filter(Boolean),
    packageTasks: deliveredEntries.flatMap(({ orderSummary }) =>
      Array.isArray(orderSummary?.packageTasks) ? orderSummary.packageTasks : []
    )
  };
}

export function buildCustomerPaymentSummary(summary = {}, packageScanLogs = []) {
  const owedTotals = Array.isArray(summary.currencyTotals) ? summary.currencyTotals : [];
  const sources = buildPaymentSources(summary, packageScanLogs);
  const paidTotals = combineCurrencyTotals(sources.map((source) => source.currencyTotals));
  const remainingTotals = subtractCurrencyTotals(owedTotals, paidTotals);
  const overpaidTotals = subtractCurrencyTotals(paidTotals, owedTotals);
  const hasOwedBalance = hasCurrencyTotals(owedTotals);
  const hasRecordedPayment = hasCurrencyTotals(paidTotals);
  const hasOutstandingBalance = hasCurrencyTotals(remainingTotals);
  const status = getPaymentStatus({ owedTotals, paidTotals, remainingTotals, overpaidTotals });
  const deliveredScope = getDeliveredPaymentScope(summary);
  const deliveredOwedTotals = combineCurrencyTotals(
    deliveredScope.orderSummaries.map((orderSummary) => orderSummary.currencyTotals)
  );
  const deliveredSources = buildPaymentSources(summary, packageScanLogs, {
    orders: deliveredScope.orders,
    packageTasks: deliveredScope.packageTasks,
    requireOrderOrTaskMatch: true
  });
  const deliveredPaidTotals = combineCurrencyTotals(
    deliveredSources.map((source) => source.currencyTotals)
  );
  const deliveredRemainingTotals = subtractCurrencyTotals(
    deliveredOwedTotals,
    deliveredPaidTotals
  );
  const deliveredOverpaidTotals = subtractCurrencyTotals(
    deliveredPaidTotals,
    deliveredOwedTotals
  );
  const hasDeliveredOwedBalance = hasCurrencyTotals(deliveredOwedTotals);
  const hasDeliveredRecordedPayment = hasCurrencyTotals(deliveredPaidTotals);
  const hasDeliveredOutstandingBalance = hasCurrencyTotals(deliveredRemainingTotals);
  const deliveredStatus = getPaymentStatus({
    owedTotals: deliveredOwedTotals,
    paidTotals: deliveredPaidTotals,
    remainingTotals: deliveredRemainingTotals,
    overpaidTotals: deliveredOverpaidTotals
  });

  const statusLabels = {
    "no-balance": "No order balance",
    unpaid: "Payment not recorded",
    partial: "Partially paid",
    paid: "Paid",
    overpaid: "Overpaid"
  };

  return {
    summary,
    customer: summary.customer,
    customerKey: summary.key,
    customerName: summary.name,
    customerPhone: summary.phone,
    owedTotals,
    paidTotals,
    remainingTotals,
    overpaidTotals,
    hasOwedBalance,
    hasRecordedPayment,
    hasOutstandingBalance,
    status,
    statusLabel: statusLabels[status] || status,
    deliveredOrderCount: deliveredScope.orderSummaries.length,
    deliveredOwedTotals,
    deliveredPaidTotals,
    deliveredRemainingTotals,
    deliveredOverpaidTotals,
    hasDeliveredOwedBalance,
    hasDeliveredRecordedPayment,
    hasDeliveredOutstandingBalance,
    deliveredStatus,
    deliveredStatusLabel: statusLabels[deliveredStatus] || deliveredStatus,
    paymentSourceCount: sources.length,
    packageTaskPaymentCount: sources.filter((source) => source.type === "packageTask").length,
    scanLogPaymentCount: sources.filter((source) => source.type === "packageScanLog").length,
    deliveredPaymentSourceCount: deliveredSources.length,
    lastPaymentAt: latestDateValue(sources.map((source) => getPaymentDate(source.record))),
    deliveredLastPaymentAt: latestDateValue(
      deliveredSources.map((source) => getPaymentDate(source.record))
    )
  };
}

export function getPaymentFollowUps(summaries = [], packageScanLogs = []) {
  return (Array.isArray(summaries) ? summaries : [])
    .map((summary) => buildCustomerPaymentSummary(summary, packageScanLogs))
    .filter((paymentSummary) => paymentSummary.hasDeliveredOutstandingBalance)
    .sort((leftSummary, rightSummary) => {
      const statusOrder = { unpaid: 0, partial: 1, overpaid: 2, paid: 3, "no-balance": 4 };
      const leftStatus = statusOrder[leftSummary.deliveredStatus] ?? 9;
      const rightStatus = statusOrder[rightSummary.deliveredStatus] ?? 9;

      if (leftStatus !== rightStatus) {
        return leftStatus - rightStatus;
      }

      return leftSummary.customerName.localeCompare(rightSummary.customerName, undefined, {
        sensitivity: "base"
      });
    });
}
