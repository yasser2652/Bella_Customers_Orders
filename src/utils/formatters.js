export const SUPPORTED_CURRENCIES = ["LYD", "USD", "CAD"];

export function normalizeCurrencyCode(currency) {
  const cleanCurrency = String(currency || "").trim().toUpperCase();

  return SUPPORTED_CURRENCIES.includes(cleanCurrency) ? cleanCurrency : "";
}

export function formatCurrency(amount, currency = "") {
  const numericAmount = Number(amount) || 0;
  const currencyCode = normalizeCurrencyCode(currency);

  try {
    const formattedAmount = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(numericAmount);

    return currencyCode ? `${currencyCode} ${formattedAmount}` : formattedAmount;
  } catch (error) {
    const fallbackAmount = numericAmount.toFixed(2);

    return currencyCode ? `${currencyCode} ${fallbackAmount}` : fallbackAmount;
  }
}

export function formatCurrencyTotals(currencyTotals, fallbackAmount = 0) {
  const totals = Array.isArray(currencyTotals)
    ? currencyTotals.filter((total) => Number(total?.amount) !== 0)
    : [];

  if (totals.length === 0) {
    return formatCurrency(fallbackAmount);
  }

  return totals
    .map((total) => formatCurrency(total.amount, total.currency))
    .join(" + ");
}

export function normalizeDateValue(value, includeTime = false) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  if (
    !includeTime &&
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return new Date(`${value}T12:00:00`);
  }

  return new Date(value);
}

export function formatDisplayDate(value, fallback = "Not provided", options = {}) {
  const { includeTime = false } = options;

  if (!value) {
    return fallback;
  }

  const date = normalizeDateValue(value, includeTime);

  if (!date || Number.isNaN(date.getTime())) {
    return String(value);
  }

  try {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      ...(includeTime
        ? {
            hour: "numeric",
            minute: "2-digit"
          }
        : {})
    }).format(date);
  } catch (error) {
    return String(value);
  }
}

export function formatDateInputValue(date) {
  const resolvedDate = date instanceof Date ? date : new Date(date);

  if (Number.isNaN(resolvedDate.getTime())) {
    return "";
  }

  const year = resolvedDate.getFullYear();
  const month = String(resolvedDate.getMonth() + 1).padStart(2, "0");
  const day = String(resolvedDate.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function getTodayDateValue() {
  return formatDateInputValue(new Date());
}

