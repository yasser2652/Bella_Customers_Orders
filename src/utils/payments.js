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

function getPaymentDate(record = {}) {
  return firstText(...PAYMENT_DATE_FIELDS.map((field) => record[field]));
}

function getPaymentTime(record = {}) {
  const dateValue = getPaymentDate(record);
  const date = dateValue ? new Date(dateValue) : null;

  return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
}

function latestDateValue(values = []) {
  return (
    values
      .filter(Boolean)
      .sort((leftValue, rightValue) => {
        const leftTime = new Date(leftValue).getTime();
        const rightTime = new Date(rightValue).getTime();

        return (rightTime || 0) - (leftTime || 0);
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
      firstText(task.orderReference, task.orderNumber, task.orderRef, task.reference) &&
      normalizeComparableText(getLogOrderReference(log)) ===
        normalizeComparableText(
          firstText(task.orderReference, task.orderNumber, task.orderRef, task.reference)
        )
  );
}

function logMatchesSummary(log = {}, summary = {}) {
  const customerValues = identityValues(summary.customer);
  const orderValues = (summary.orders || []).flatMap((order) => identityValues(order));
  const orderReferences = (summary.orders || []).map(getOrderReference).filter(Boolean);

  if (valuesOverlap(identityValuesFromFields(log, CUSTOMER_RELATION_FIELDS), customerValues)) {
    return true;
  }

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

  return (summary.packageTasks || []).some((task) => logMatchesTask(log, task));
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

function buildPaymentSources(summary = {}, packageScanLogs = []) {
  const tasks = Array.isArray(summary.packageTasks) ? summary.packageTasks : [];
  const taskSources = tasks
    .map((task, index) => ({
      type: "packageTask",
      groupKey: `task:${getTaskKey(task, index)}`,
      record: task,
      currencyTotals: getPaymentTotals(task)
    }))
    .filter((source) => hasCurrencyTotals(source.currencyTotals));
  const taskSourcesByGroup = new Map(
    taskSources.map((source) => [source.groupKey, source])
  );
  const logSources = (Array.isArray(packageScanLogs) ? packageScanLogs : [])
    .filter((log) => hasCurrencyTotals(getPaymentTotals(log)))
    .filter((log) => logMatchesSummary(log, summary))
    .map((log, index) => {
      const matchingTaskIndex = tasks.findIndex((task) => logMatchesTask(log, task));
      const groupKey =
        matchingTaskIndex >= 0
          ? `task:${getTaskKey(tasks[matchingTaskIndex], matchingTaskIndex)}`
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

export function buildCustomerPaymentSummary(summary = {}, packageScanLogs = []) {
  const owedTotals = Array.isArray(summary.currencyTotals) ? summary.currencyTotals : [];
  const sources = buildPaymentSources(summary, packageScanLogs);
  const paidTotals = combineCurrencyTotals(sources.map((source) => source.currencyTotals));
  const remainingTotals = subtractCurrencyTotals(owedTotals, paidTotals);
  const overpaidTotals = subtractCurrencyTotals(paidTotals, owedTotals);
  const hasOwedBalance = hasCurrencyTotals(owedTotals);
  const hasRecordedPayment = hasCurrencyTotals(paidTotals);
  const hasOutstandingBalance = hasCurrencyTotals(remainingTotals);
  let status = "no-balance";

  if (hasOwedBalance && hasOutstandingBalance && hasRecordedPayment) {
    status = "partial";
  } else if (hasOwedBalance && hasOutstandingBalance) {
    status = "unpaid";
  } else if (hasOwedBalance && hasCurrencyTotals(overpaidTotals)) {
    status = "overpaid";
  } else if (hasOwedBalance) {
    status = "paid";
  }

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
    paymentSourceCount: sources.length,
    packageTaskPaymentCount: sources.filter((source) => source.type === "packageTask").length,
    scanLogPaymentCount: sources.filter((source) => source.type === "packageScanLog").length,
    lastPaymentAt: latestDateValue(sources.map((source) => getPaymentDate(source.record)))
  };
}

export function getPaymentFollowUps(summaries = [], packageScanLogs = []) {
  return (Array.isArray(summaries) ? summaries : [])
    .map((summary) => buildCustomerPaymentSummary(summary, packageScanLogs))
    .filter((paymentSummary) => paymentSummary.hasOutstandingBalance)
    .sort((leftSummary, rightSummary) => {
      const statusOrder = { unpaid: 0, partial: 1, overpaid: 2, paid: 3, "no-balance": 4 };
      const leftStatus = statusOrder[leftSummary.status] ?? 9;
      const rightStatus = statusOrder[rightSummary.status] ?? 9;

      if (leftStatus !== rightStatus) {
        return leftStatus - rightStatus;
      }

      return leftSummary.customerName.localeCompare(rightSummary.customerName, undefined, {
        sensitivity: "base"
      });
    });
}
