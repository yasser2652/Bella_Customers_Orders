import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Copy,
  Eye,
  FileDown,
  Loader2,
  Lock,
  LogOut,
  MessageCircle,
  Pencil,
  Phone,
  Printer,
  ReceiptText,
  Save,
  Search,
  ShieldCheck,
  ShoppingBag,
  Truck,
  Users,
  WifiOff,
  X
} from "lucide-react";
import {
  AUTHORIZED_BELLA_USER_UID,
  getFirebaseConfigStatus,
  signInBellaEmail,
  signInBellaGoogle,
  signOutBellaUser,
  subscribeToBellaAuthState
} from "./firebase.js";
import {
  FIRESTORE_READ_COLLECTIONS,
  subscribeToFirestoreCollection
} from "./services/firestoreRead.js";
import {
  addPackageTaskPayment,
  correctPackageTaskPayment,
  getCustomerEditableValues,
  updateCustomerInfo
} from "./services/firestoreWrite.js";
import { getRecordKey, identityValues } from "./utils/identity.js";
import {
  buildCustomerSummary,
  combineCurrencyTotals,
  customerMatchesSearch,
  dateIsInRange,
  firstText,
  getCustomerAddress,
  getCustomerEmail,
  getCustomerName,
  getCustomerPhone,
  getOrderDate,
  getOrderPurchases,
  getOrderReference,
  getOrderRequestedItems,
  getOrderSummary,
  getPurchaseItemName,
  getPurchaseLineTotal,
  getPurchaseQuantity,
  getPurchaseReceiptUrl,
  getPurchaseUnitPrice,
  isCustomerFacingOrderDeliveredStatus,
  isOrderOpen,
  isPendingRequestedItem,
  normalizePhone,
  purchaseHasOrderAlias
} from "./utils/relationships.js";
import { formatCurrency, formatCurrencyTotals, formatDisplayDate } from "./utils/formatters.js";
import { buildCustomerPaymentSummary } from "./utils/payments.js";
import {
  buildPrintableReceiptHtml,
  buildReceiptDisplayModel,
  buildReceiptModel,
  buildReceiptText,
  buildWhatsAppUrl,
  copyTextToClipboard,
  downloadOrShareReceiptPdf,
  getReceiptCurrencyLabel,
  getReceiptExchangeRateKey,
  getReceiptExchangeSources,
  hasReceiptExchangeRates,
  printHtmlDocument,
  RECEIPT_TARGET_CURRENCIES,
  shareReceiptImage,
  shareReceiptPdf,
  viewHtmlDocument
} from "./utils/receipts.js";
import "./styles.css";

function createInitialData() {
  return FIRESTORE_READ_COLLECTIONS.reduce((data, collectionName) => {
    data[collectionName] = [];
    return data;
  }, {});
}

function createInitialCollectionState(status = "pending") {
  return FIRESTORE_READ_COLLECTIONS.reduce((state, collectionName) => {
    state[collectionName] = status;
    return state;
  }, {});
}

function useDebouncedValue(value, delayMs = 180) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delayMs);

    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debouncedValue;
}

function getErrorMessage(error) {
  if (!error) {
    return "";
  }

  if (error.code === "permission-denied") {
    return "Missing or insufficient permissions. Sign in with the authorized Bella Boutique account or check Firestore rules.";
  }

  if (error.code === "FIREBASE_NOT_CONFIGURED") {
    return `Firebase is not configured. Missing: ${(error.missing || []).join(", ")}`;
  }

  if (error.code === "auth/not-authorized") {
    return "This Firebase account is not authorized for Bella Customer Orders.";
  }

  const message = String(error.message || error);

  if (message.toLowerCase().includes("missing or insufficient permissions")) {
    return "Missing or insufficient permissions. Sign in with the authorized Bella Boutique account or check Firestore rules.";
  }

  return message;
}

function useBellaData(enabled) {
  const [data, setData] = useState(() => createInitialData());
  const [collectionState, setCollectionState] = useState(() =>
    createInitialCollectionState()
  );
  const [errors, setErrors] = useState([]);
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  );

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setData(createInitialData());
      setErrors([]);
      setCollectionState(createInitialCollectionState());
      return undefined;
    }

    const configStatus = getFirebaseConfigStatus();

    if (!configStatus.configured) {
      const error = new Error("Firebase is not configured.");
      error.code = "FIREBASE_NOT_CONFIGURED";
      error.missing = configStatus.missing;
      setErrors([{ collectionName: "firebase", error }]);
      setCollectionState(createInitialCollectionState("error"));
      return undefined;
    }

    const unsubscribes = FIRESTORE_READ_COLLECTIONS.map((collectionName) =>
      subscribeToFirestoreCollection(
        collectionName,
        (records) => {
          setData((currentData) => ({
            ...currentData,
            [collectionName]: records
          }));
          setCollectionState((currentState) => ({
            ...currentState,
            [collectionName]: "loaded"
          }));
        },
        (error) => {
          setErrors((currentErrors) => {
            const nextErrors = currentErrors.filter(
              (entry) => entry.collectionName !== collectionName
            );

            return [...nextErrors, { collectionName, error }];
          });
          setCollectionState((currentState) => ({
            ...currentState,
            [collectionName]: "error"
          }));
        }
      )
    );

    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [enabled]);

  const pendingCollections = FIRESTORE_READ_COLLECTIONS.filter(
    (collectionName) => collectionState[collectionName] === "pending"
  );
  const loadedCollections = FIRESTORE_READ_COLLECTIONS.filter(
    (collectionName) => collectionState[collectionName] === "loaded"
  );
  const status = !online
    ? "offline"
    : errors.length > 0
      ? "error"
      : pendingCollections.length > 0
        ? "syncing"
        : "connected";

  return {
    data,
    errors,
    loadedCollections,
    pendingCollections,
    status
  };
}

function getLoginErrorMessage(error) {
  if (!error) {
    return "";
  }

  if (error.code === "auth/not-authorized") {
    return "This Firebase account is not authorized for Bella Customer Orders.";
  }

  if (error.code === "FIREBASE_NOT_CONFIGURED") {
    return `Firebase is not configured. Missing: ${(error.missing || []).join(", ")}`;
  }

  if (
    [
      "auth/invalid-credential",
      "auth/invalid-email",
      "auth/user-not-found",
      "auth/wrong-password"
    ].includes(error.code)
  ) {
    return "Email or password is not correct for the authorized Firebase user.";
  }

  if (error.code === "auth/popup-closed-by-user") {
    return "Google sign-in was closed before it finished.";
  }

  if (error.code === "auth/popup-blocked") {
    return "The browser blocked the Google sign-in popup. Allow popups or use email/password.";
  }

  return String(error.message || error);
}

function useBellaAuth() {
  const [authState, setAuthState] = useState({
    status: "checking",
    user: null,
    error: null
  });

  useEffect(() => {
    const configStatus = getFirebaseConfigStatus();

    if (!configStatus.configured) {
      const error = new Error("Firebase is not configured.");
      error.code = "FIREBASE_NOT_CONFIGURED";
      error.missing = configStatus.missing;
      setAuthState({ status: "config-error", user: null, error });
      return undefined;
    }

    return subscribeToBellaAuthState(
      (user) => {
        if (!user) {
          setAuthState({ status: "signed-out", user: null, error: null });
          return;
        }

        if (user.uid === AUTHORIZED_BELLA_USER_UID) {
          setAuthState({ status: "authorized", user, error: null });
          return;
        }

        const error = new Error("This Firebase account is not authorized for Bella Customer Orders.");
        error.code = "auth/not-authorized";
        setAuthState({ status: "denied", user, error });
      },
      (error) => setAuthState({ status: "error", user: null, error })
    );
  }, []);

  return authState;
}

function LoginScreen({ authState }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loginError, setLoginError] = useState("");
  const authError = getLoginErrorMessage(authState.error);
  const disabled = submitting || authState.status === "checking" || authState.status === "config-error";

  const handleEmailLogin = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setLoginError("");

    try {
      await signInBellaEmail(email, password);
    } catch (error) {
      setLoginError(getLoginErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    setSubmitting(true);
    setLoginError("");

    try {
      await signInBellaGoogle();
    } catch (error) {
      setLoginError(getLoginErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    setSubmitting(true);
    setLoginError("");

    try {
      await signOutBellaUser();
    } catch (error) {
      setLoginError(getLoginErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="app-shell auth-shell">
      <header className="app-header auth-header">
        <div className="brand-mark">
          <img src="/bella-butterfly.png" alt="Bella Boutique logo" />
        </div>
        <div>
          <p className="eyebrow">Bella Boutique</p>
          <h1>Customer Orders</h1>
          <p>Sign in to view customers, orders, receipts, and delivery payments.</p>
        </div>
      </header>

      <main className="auth-panel" aria-labelledby="login-title">
        <section className="auth-card">
          <div className="auth-card-header">
            <div className="auth-icon" aria-hidden="true">
              <Lock size={24} />
            </div>
            <div>
              <p className="eyebrow">Secure access</p>
              <h2 id="login-title">Staff login</h2>
              <p>Only the authorized Bella Boutique Firebase user can open this workspace.</p>
            </div>
          </div>

          {authState.status === "checking" ? (
            <p className="auth-state">
              <Loader2 className="spin" size={16} aria-hidden="true" />
              Checking saved sign-in...
            </p>
          ) : null}

          {authError ? <p className="warning-text">{authError}</p> : null}
          {loginError ? <p className="warning-text">{loginError}</p> : null}

          {authState.status === "denied" ? (
            <div className="auth-denied-actions">
              <p className="helper-text">
                Signed in UID: {authState.user?.uid || "unknown"}. Use the authorized account instead.
              </p>
              <button className="button secondary" type="button" onClick={handleSignOut} disabled={submitting}>
                <LogOut size={16} aria-hidden="true" />
                Use another account
              </button>
            </div>
          ) : null}

          <form className="auth-form" onSubmit={handleEmailLogin}>
            <label className="field">
              <span>Email</span>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                disabled={disabled}
                required
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                disabled={disabled}
                required
              />
            </label>
            <div className="auth-actions">
              <button className="button" type="submit" disabled={disabled}>
                <ShieldCheck size={16} aria-hidden="true" />
                {submitting ? "Signing in..." : "Sign in"}
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={handleGoogleLogin}
                disabled={disabled}
              >
                Sign in with Google
              </button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
function StatusIndicator({ status, errors, loadedCollections, pendingCollections, collectionCounts = [] }) {
  const labels = {
    connected: "Connected",
    syncing: "Syncing/loading",
    offline: "Offline",
    error: "Missing permissions/error"
  };
  const Icon =
    status === "connected"
      ? CheckCircle2
      : status === "offline"
        ? WifiOff
        : status === "error"
          ? AlertCircle
          : Loader2;

  return (
    <div className={`status-pill status-${status}`}>
      <Icon className={status === "syncing" ? "spin" : ""} size={16} aria-hidden="true" />
      <span>{labels[status]}</span>
      <small>
        {loadedCollections.length}/{FIRESTORE_READ_COLLECTIONS.length}
      </small>
      {pendingCollections.length > 0 ? (
        <small>{pendingCollections.slice(0, 2).join(", ")}</small>
      ) : null}
      {errors.length > 0 ? <small>{getErrorMessage(errors[0].error)}</small> : null}
      <details className="status-details">
        <summary>Collections</summary>
        <div className="status-collection-list" aria-label="Loaded collection counts">
          {collectionCounts.map((entry) => (
            <span key={entry.collectionName}>
              {entry.collectionName}: <strong>{entry.count}</strong>
            </span>
          ))}
        </div>
      </details>
    </div>
  );
}

function ErrorBanner({ errors }) {
  if (errors.length === 0) {
    return null;
  }

  return (
    <div className="sync-banner" role="alert">
      <AlertCircle size={18} aria-hidden="true" />
      <div>
        <strong>Firestore read issue</strong>
        {errors.map((entry) => (
          <p key={entry.collectionName}>
            {entry.collectionName}: {getErrorMessage(entry.error)}
          </p>
        ))}
      </div>
    </div>
  );
}

function Toast({ notice, onClose }) {
  if (!notice) {
    return null;
  }

  return (
    <div className={`toast toast-${notice.tone || "neutral"}`} role="status">
      <span>{notice.message}</span>
      <button className="icon-button subtle" type="button" onClick={onClose}>
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

function CustomerCard({ summary, selected, onSelect }) {
  return (
    <button
      className={`customer-card${selected ? " selected" : ""}`}
      type="button"
      onClick={() => onSelect(summary)}
    >
      <div className="customer-card-main">
        <div>
          <strong>{summary.name}</strong>
          <p>{summary.phone || "No phone on record"}</p>
          {summary.address ? <p className="muted">{summary.address}</p> : null}
        </div>
        <ChevronRight size={18} aria-hidden="true" />
      </div>
      <div className="mini-stats">
        <span>{summary.orderCount} orders</span>
        <span>{summary.purchaseCount} items</span>
        <span>{formatCurrencyTotals(summary.currencyTotals)}</span>
      </div>
    </button>
  );
}

function SearchWorkspace({
  panelRef,
  query,
  setQuery,
  showAll,
  setShowAll,
  filters,
  setFilters,
  summaries,
  visibleSummaries,
  selectedSummary,
  onSelect
}) {
  const shouldShowResults = showAll || query.trim();

  return (
    <section className="search-panel" ref={panelRef}>
      <div className="section-title-row">
        <div>
          <p className="eyebrow">Customer search</p>
          <h2>Find customer orders</h2>
        </div>
        <span className="count-badge">{summaries.length} customers</span>
      </div>

      <label className="search-box">
        <Search size={18} aria-hidden="true" />
        <input
          type="search"
          value={query}
          placeholder="Search by name or phone"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      <div className="toolbar">
        <button className="button" type="button" onClick={() => setShowAll(true)}>
          <Users size={16} aria-hidden="true" />
          Show all customers
        </button>
        <button
          className="button secondary"
          type="button"
          onClick={() => {
            setQuery("");
            setShowAll(false);
          }}
        >
          Clear
        </button>
      </div>

      <div className="filter-row" aria-label="Customer filters">
        <label>
          <input
            type="checkbox"
            checked={filters.openOnly}
            onChange={(event) =>
              setFilters((currentFilters) => ({
                ...currentFilters,
                openOnly: event.target.checked
              }))
            }
          />
          Open orders only
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.deliveredOnly}
            onChange={(event) =>
              setFilters((currentFilters) => ({
                ...currentFilters,
                deliveredOnly: event.target.checked
              }))
            }
          />
          Delivered orders only
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.pendingRequests}
            onChange={(event) =>
              setFilters((currentFilters) => ({
                ...currentFilters,
                pendingRequests: event.target.checked
              }))
            }
          />
          Has pending requested items
        </label>
      </div>

      {!shouldShowResults ? (
        <div className="empty-state">
          <Users size={24} aria-hidden="true" />
          <h3>Search for a customer</h3>
          <p>Enter a name or phone number, or use Show all customers.</p>
        </div>
      ) : visibleSummaries.length === 0 ? (
        <div className="empty-state">
          <Search size={24} aria-hidden="true" />
          <h3>No matching customers</h3>
          <p>Try a shorter phone number, a different spelling, or clear filters.</p>
        </div>
      ) : (
        <div className="customer-results">
          {visibleSummaries.map((summary) => (
            <CustomerCard
              key={summary.key}
              summary={summary}
              selected={selectedSummary?.key === summary.key}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </section>
  );
}

const PAYMENT_ENTRY_CURRENCIES = ["LYD", "USD"];

function getDefaultPaymentCurrency(paymentSummary = {}) {
  const remainingCurrencies = (paymentSummary.remainingTotals || []).map(
    (total) => total.currency
  );

  if (remainingCurrencies.includes("LYD")) {
    return "LYD";
  }

  if (remainingCurrencies.includes("USD")) {
    return "USD";
  }

  return "LYD";
}

function getPackageTaskPaymentAmount(packageTask = {}, currency = "LYD") {
  const field = currency === "USD" ? "deliveryPaymentUsd" : "deliveryPaymentLyd";
  const amount = Number(packageTask[field]);

  return Number.isFinite(amount) ? amount : 0;
}

function getPackageTaskOptionLabel(packageTask = {}, index = 0) {
  return firstText(
    packageTask.orderReference,
    packageTask.orderNumber,
    packageTask.orderRef,
    packageTask.reference,
    packageTask.orderId,
    packageTask.id,
    `Package task ${index + 1}`
  );
}

function formatPaymentInputAmount(amount) {
  const numericAmount = Number(amount);

  if (!Number.isFinite(numericAmount)) {
    return "0";
  }

  return String(Math.round((numericAmount + Number.EPSILON) * 100) / 100);
}

function getDefaultPaymentForm(summary = {}, paymentSummary = {}) {
  const firstTask = summary.packageTasks?.[0] || null;

  return {
    packageTaskKey: firstTask ? getRecordKey(firstTask, "package-task-0") : "",
    currency: getDefaultPaymentCurrency(paymentSummary),
    amount: ""
  };
}

function getDefaultPaymentCorrectionForm(summary = {}, paymentSummary = {}) {
  const firstTask = summary.packageTasks?.[0] || null;
  const currency = getDefaultPaymentCurrency(paymentSummary);

  return {
    packageTaskKey: firstTask ? getRecordKey(firstTask, "package-task-0") : "",
    currency,
    amount: formatPaymentInputAmount(firstTask ? getPackageTaskPaymentAmount(firstTask, currency) : 0)
  };
}
function PaymentTotals({ label, totals, emptyLabel = "Not recorded" }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{totals.length ? formatCurrencyTotals(totals) : emptyLabel}</strong>
    </div>
  );
}

function CustomerPaymentStatusCard({ paymentSummary, canRecordPayment, canCorrectPayment, onRecordPayment, onCorrectPayment }) {
  return (
    <section className={`customer-payment-card payment-${paymentSummary.status}`}>
      <div className="section-title-row compact">
        <div>
          <p className="eyebrow">Delivery payments</p>
          <h3>Payment status</h3>
        </div>
        <div className="payment-card-actions">
          <span className={`badge payment-badge payment-${paymentSummary.status}`}>
            {paymentSummary.statusLabel}
          </span>
          <button
            className="button secondary"
            type="button"
            disabled={!canRecordPayment}
            onClick={onRecordPayment}
          >
            <Save size={16} aria-hidden="true" />
            Record payment
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={!canCorrectPayment}
            onClick={onCorrectPayment}
          >
            <Pencil size={16} aria-hidden="true" />
            Correct payment
          </button>
        </div>
      </div>
      <div className="payment-metrics">
        <PaymentTotals label="Order total" totals={paymentSummary.owedTotals} emptyLabel="No balance" />
        <PaymentTotals label="Recorded paid" totals={paymentSummary.paidTotals} />
        <PaymentTotals label="Remaining" totals={paymentSummary.remainingTotals} emptyLabel="No remaining balance" />
        <div>
          <span>Last payment update</span>
          <strong>
            {paymentSummary.lastPaymentAt
              ? formatDisplayDate(paymentSummary.lastPaymentAt, "Not recorded", { includeTime: true })
              : "Not recorded"}
          </strong>
        </div>
      </div>
      <div className="payment-source-line">
        <span>{paymentSummary.packageTaskPaymentCount} package task payments</span>
        <span>{paymentSummary.scanLogPaymentCount} scan log payments</span>
      </div>
    </section>
  );
}

function PaymentRecordForm({ packageTasks, values, setValues, saving, onSave, onCancel }) {
  const selectedTask =
    packageTasks.find(
      (task, index) => getRecordKey(task, `package-task-${index}`) === values.packageTaskKey
    ) || packageTasks[0];
  const existingAmount = selectedTask
    ? getPackageTaskPaymentAmount(selectedTask, values.currency)
    : 0;
  const amountToAdd = Number(values.amount);
  const projectedAmount =
    Number.isFinite(amountToAdd) && amountToAdd > 0
      ? existingAmount + amountToAdd
      : existingAmount;
  const canSave = Boolean(selectedTask) && Number.isFinite(amountToAdd) && amountToAdd > 0;

  return (
    <form className="payment-record-form" onSubmit={onSave}>
      <div className="section-title-row compact">
        <div>
          <p className="eyebrow">Add payment</p>
          <h3>Record customer payment</h3>
        </div>
      </div>
      <div className="edit-grid">
        <label className="field">
          <span>Package task</span>
          <select
            className="input"
            value={values.packageTaskKey}
            onChange={(event) =>
              setValues((currentValues) => ({
                ...currentValues,
                packageTaskKey: event.target.value
              }))
            }
          >
            {packageTasks.map((task, index) => {
              const key = getRecordKey(task, `package-task-${index}`);

              return (
                <option value={key} key={key}>
                  {getPackageTaskOptionLabel(task, index)}
                </option>
              );
            })}
          </select>
        </label>
        <label className="field">
          <span>Currency</span>
          <select
            className="input"
            value={values.currency}
            onChange={(event) =>
              setValues((currentValues) => ({
                ...currentValues,
                currency: event.target.value
              }))
            }
          >
            {PAYMENT_ENTRY_CURRENCIES.map((currency) => (
              <option value={currency} key={currency}>
                {currency}
              </option>
            ))}
          </select>
        </label>
        <label className="field wide">
          <span>Amount paid now</span>
          <input
            className="input"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={values.amount}
            onChange={(event) =>
              setValues((currentValues) => ({
                ...currentValues,
                amount: event.target.value
              }))
            }
            placeholder="0.00"
          />
        </label>
      </div>
      <p className="helper-text">
        Existing {values.currency} payment is {formatCurrency(existingAmount, values.currency)}.
        Saving will update it to {formatCurrency(projectedAmount, values.currency)}.
      </p>
      <div className="form-actions">
        <button className="button secondary" type="button" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
        <button className="button" type="submit" disabled={saving || !canSave}>
          <Save size={16} aria-hidden="true" />
          {saving ? "Saving..." : "Add payment"}
        </button>
      </div>
    </form>
  );
}
function PaymentCorrectionForm({ packageTasks, values, setValues, saving, onSave, onCancel }) {
  const selectedTask =
    packageTasks.find(
      (task, index) => getRecordKey(task, `package-task-${index}`) === values.packageTaskKey
    ) || packageTasks[0];
  const existingAmount = selectedTask
    ? getPackageTaskPaymentAmount(selectedTask, values.currency)
    : 0;
  const correctedAmount = Number(values.amount);
  const changed =
    Number.isFinite(correctedAmount) &&
    Math.abs(correctedAmount - existingAmount) > 0.009;
  const canSave = Boolean(selectedTask) && Number.isFinite(correctedAmount) && correctedAmount >= 0 && changed;
  const updateValuesForSelection = (packageTaskKey, currency) => {
    const task =
      packageTasks.find(
        (candidateTask, index) => getRecordKey(candidateTask, `package-task-${index}`) === packageTaskKey
      ) || packageTasks[0];

    return {
      packageTaskKey,
      currency,
      amount: formatPaymentInputAmount(task ? getPackageTaskPaymentAmount(task, currency) : 0)
    };
  };

  return (
    <form className="payment-record-form payment-correction-form" onSubmit={onSave}>
      <div className="section-title-row compact">
        <div>
          <p className="eyebrow">Correct payment</p>
          <h3>Replace recorded payment total</h3>
        </div>
      </div>
      <div className="edit-grid">
        <label className="field">
          <span>Package task</span>
          <select
            className="input"
            value={values.packageTaskKey}
            onChange={(event) =>
              setValues((currentValues) =>
                updateValuesForSelection(event.target.value, currentValues.currency)
              )
            }
          >
            {packageTasks.map((task, index) => {
              const key = getRecordKey(task, `package-task-${index}`);

              return (
                <option value={key} key={key}>
                  {getPackageTaskOptionLabel(task, index)}
                </option>
              );
            })}
          </select>
        </label>
        <label className="field">
          <span>Currency</span>
          <select
            className="input"
            value={values.currency}
            onChange={(event) =>
              setValues((currentValues) =>
                updateValuesForSelection(currentValues.packageTaskKey, event.target.value)
              )
            }
          >
            {PAYMENT_ENTRY_CURRENCIES.map((currency) => (
              <option value={currency} key={currency}>
                {currency}
              </option>
            ))}
          </select>
        </label>
        <label className="field wide">
          <span>Correct recorded total</span>
          <input
            className="input"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={values.amount}
            onChange={(event) =>
              setValues((currentValues) => ({
                ...currentValues,
                amount: event.target.value
              }))
            }
            placeholder="0.00"
          />
        </label>
      </div>
      <p className="helper-text warning-text compact-warning">
        Existing {values.currency} payment is {formatCurrency(existingAmount, values.currency)}.
        Saving will replace it with {Number.isFinite(correctedAmount) && correctedAmount >= 0
          ? formatCurrency(correctedAmount, values.currency)
          : "an invalid amount"}.
      </p>
      <div className="form-actions">
        <button className="button secondary" type="button" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
        <button className="button" type="submit" disabled={saving || !canSave}>
          <Save size={16} aria-hidden="true" />
          {saving ? "Saving..." : "Save correction"}
        </button>
      </div>
    </form>
  );
}
function PaymentFollowUpsPanel({ paymentSummaries, selectedCustomerKey, isProfileOpen, onSelect }) {
  const [isOpen, setIsOpen] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.localStorage.getItem("bella.paymentFollowUpsOpen") === "true";
  });
  const visibleFollowUps = paymentSummaries
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
  const remainingTotals = combineCurrencyTotals(
    visibleFollowUps.map((paymentSummary) => paymentSummary.deliveredRemainingTotals)
  );
  const totalsLabel = remainingTotals.length
    ? formatCurrencyTotals(remainingTotals)
    : "No delivered balances";

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("bella.paymentFollowUpsOpen", isOpen ? "true" : "false");
    }
  }, [isOpen]);

  if (isProfileOpen) {
    return null;
  }

  return (
    <section className={`payment-panel${isOpen ? "" : " collapsed"}`} aria-label="Payment follow-ups">
      <div className="section-title-row compact">
        <div>
          <p className="eyebrow">Payment follow-ups</p>
          <h2>Delivered customers with remaining balance</h2>
        </div>
        <div className="payment-panel-summary">
          <span className="count-badge">{visibleFollowUps.length} customers</span>
          <span className="count-badge">{totalsLabel}</span>
          <button
            className="button secondary payment-panel-toggle"
            type="button"
            aria-expanded={isOpen}
            aria-controls="payment-follow-ups-body"
            onClick={() => setIsOpen((currentValue) => !currentValue)}
          >
            <ChevronDown className={isOpen ? "" : "collapsed-icon"} size={16} aria-hidden="true" />
            {isOpen ? "Collapse" : "Expand"}
          </button>
        </div>
      </div>

      {isOpen ? (
        <div id="payment-follow-ups-body" className="payment-follow-ups-body">
          {visibleFollowUps.length === 0 ? (
            <div className="empty-state inline payment-empty">
              <ReceiptText size={22} aria-hidden="true" />
              <h3>No delivered unpaid customers</h3>
              <p>Customers waiting for delivery are hidden until the package is delivered.</p>
            </div>
          ) : (
            <div className="payment-follow-up-list">
              {visibleFollowUps.map((paymentSummary) => (
                <button
                  className={`payment-follow-up-row payment-${paymentSummary.deliveredStatus}${
                    selectedCustomerKey === paymentSummary.customerKey ? " selected" : ""
                  }`}
                  type="button"
                  key={paymentSummary.customerKey}
                  onClick={() => onSelect(paymentSummary.summary)}
                >
                  <div className="payment-row-main">
                    <div>
                      <strong>{paymentSummary.customerName}</strong>
                      <p>{paymentSummary.customerPhone || "No phone on record"}</p>
                    </div>
                    <span className={`badge payment-badge payment-${paymentSummary.deliveredStatus}`}>
                      {paymentSummary.deliveredStatusLabel}
                    </span>
                  </div>
                  <div className="payment-row-grid">
                    <PaymentTotals label="Delivered owed" totals={paymentSummary.deliveredOwedTotals} emptyLabel="No balance" />
                    <PaymentTotals label="Delivered paid" totals={paymentSummary.deliveredPaidTotals} />
                    <PaymentTotals label="Remaining" totals={paymentSummary.deliveredRemainingTotals} emptyLabel="No remaining balance" />
                    <div>
                      <span>Last update</span>
                      <strong>
                        {paymentSummary.deliveredLastPaymentAt
                          ? formatDisplayDate(paymentSummary.deliveredLastPaymentAt, "Not recorded", { includeTime: true })
                          : "Not recorded"}
                      </strong>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
function CopyPhoneButton({ phone, setNotice }) {
  const disabled = !phone;

  return (
    <button
      className="button secondary"
      type="button"
      disabled={disabled}
      onClick={async () => {
        await copyTextToClipboard(phone);
        setNotice({ message: "Phone copied." });
      }}
    >
      <Copy size={16} aria-hidden="true" />
      Copy phone
    </button>
  );
}

function OrderItemsTable({ purchases }) {
  if (purchases.length === 0) {
    return (
      <div className="inline-empty">
        <ShoppingBag size={18} aria-hidden="true" />
        No linked purchase/order items.
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Qty</th>
            <th>Unit</th>
            <th>Total</th>
            <th>Purchased by</th>
            <th>Supplier</th>
            <th>Receipt/photo</th>
          </tr>
        </thead>
        <tbody>
          {purchases.map((purchase, index) => {
            const receiptUrl = getPurchaseReceiptUrl(purchase);
            const meta = [purchase.brand, purchase.category, purchase.color, purchase.size]
              .filter(Boolean)
              .join(" / ");

            return (
              <tr key={getRecordKey(purchase, `${purchase.item}-${index}`)}>
                <td>
                  <strong>{getPurchaseItemName(purchase)}</strong>
                  {meta ? <span>{meta}</span> : null}
                </td>
                <td>{getPurchaseQuantity(purchase)}</td>
                <td>{formatCurrency(getPurchaseUnitPrice(purchase), purchase.currency)}</td>
                <td>{formatCurrency(getPurchaseLineTotal(purchase), purchase.currency)}</td>
                <td>{purchase.purchasedBy || "Not provided"}</td>
                <td>{purchase.supplier || "Not provided"}</td>
                <td>
                  {receiptUrl ? (
                    <a href={receiptUrl} target="_blank" rel="noreferrer">
                      Open
                    </a>
                  ) : (
                    "Not provided"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OrderCard({
  order,
  data,
  expanded,
  onToggle
}) {
  const summary = getOrderSummary(
    order,
    data.purchases,
    data.shipments,
    data.deliveries,
    data.packageTasks,
    data.packageScanLogs
  );
  const date = getOrderDate(order);
  const trackingNumber = firstText(
    summary.shipment?.trackingNumber,
    summary.shipment?.tracking,
    order.shipmentTrackingNumber
  );
  const requestedItems = getOrderRequestedItems(order, data.requestedItems);
  const statusClassName = `status-${summary.status
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`;

  return (
    <article className="order-card">
      <button className="order-header" type="button" onClick={onToggle}>
        <div>
          <div className="order-title-line">
            {expanded ? (
              <ChevronDown size={18} aria-hidden="true" />
            ) : (
            <ChevronRight size={18} aria-hidden="true" />
            )}
            <h3>{getOrderReference(order)}</h3>
            <span className={`badge ${statusClassName}`}>
              {summary.status}
            </span>
          </div>
          <p>
            Order ID: {firstText(order.id, order.firestoreId, "Unknown")} |{" "}
            {formatDisplayDate(date, "Date not provided")}
          </p>
        </div>
        <div className="order-stats">
          <strong>{summary.itemCount} items</strong>
          <span>{formatCurrencyTotals(summary.currencyTotals, summary.totalAmount)}</span>
        </div>
      </button>

      <div className="order-meta-grid">
        <span>
          <Truck size={15} aria-hidden="true" />
          {trackingNumber ? `Tracking ${trackingNumber}` : "No shipment tracking"}
        </span>
        <span>
          <ShoppingBag size={15} aria-hidden="true" />
          Packing: {summary.packingStatusLabel || "No package tasks"}
        </span>
        <span>
          <Truck size={15} aria-hidden="true" />
          Delivery: {summary.deliveryStatusLabel || summary.status}
        </span>
        <span>
          <ReceiptText size={15} aria-hidden="true" />
          {requestedItems.length} requested items
        </span>
        <span>
          <ShoppingBag size={15} aria-hidden="true" />
          {summary.packageTasks.length} package tasks
        </span>
        {summary.deliverySyncIssues?.length ? (
          <span className="sync-warning-meta">
            <AlertCircle size={15} aria-hidden="true" />
            Scan log says {summary.deliverySyncIssues[0].scanLogEvidence?.[0]?.statusLabel || "delivery activity"}; package deliveryStatus missing
          </span>
        ) : null}
      </div>

      {expanded ? (
        <div className="order-expanded">
          <OrderItemsTable purchases={summary.purchases} />

          {requestedItems.length > 0 ? (
            <div className="related-strip">
              <strong>Requested items</strong>
              <div>
                {requestedItems.map((item, index) => (
                  <span key={getRecordKey(item, index)}>
                    {firstText(item.item, item.productName, item.name, "Requested item")}{" "}
                    ({item.status || "Requested"})
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function getDefaultReceiptCurrency(receiptModel) {
  const currencies = [
    ...new Set(
      (receiptModel.purchases || [])
        .map((purchase) => String(purchase.currency || "").trim().toUpperCase())
        .filter((currency) => RECEIPT_TARGET_CURRENCIES.includes(currency))
    )
  ];

  return currencies.length === 1 ? currencies[0] : "USD";
}

function ReceiptCurrencyModal({
  request,
  receiptModel,
  onChange,
  onCancel,
  onConfirm
}) {
  if (!request) {
    return null;
  }

  const targetCurrency = request.targetCurrency;
  const exchangeSources = getReceiptExchangeSources(
    receiptModel.purchases,
    targetCurrency
  );
  const isRateStep = request.step === "rates";
  const canConfirmRates = hasReceiptExchangeRates(
    receiptModel.purchases,
    targetCurrency,
    request.exchangeRates
  );
  const currentTotals = formatCurrencyTotals(
    receiptModel.currencyTotals,
    receiptModel.totalAmount
  );

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal-card currency-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="receipt-currency-title"
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">
              {isRateStep ? "Exchange rates" : "Receipt currency"}
            </p>
            <h3 id="receipt-currency-title">
              {isRateStep ? "Enter conversion rates" : "Choose receipt currency"}
            </h3>
          </div>
          <button className="icon-button" type="button" onClick={onCancel}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="currency-dialog-body">
          <div className="currency-summary">
            <span>Current total</span>
            <strong>{currentTotals}</strong>
          </div>

          {isRateStep ? (
            <>
              <p className="helper-text">
                Enter each required rate. If no exchange rate is available, use Back
                or Cancel and no receipt action will run.
              </p>
              <div className="rate-grid">
                {exchangeSources.map((sourceCurrency) => {
                  const rateKey = getReceiptExchangeRateKey(
                    sourceCurrency,
                    targetCurrency
                  );

                  return (
                    <label className="field" key={rateKey}>
                      <span>
                        1 {sourceCurrency} = ? {targetCurrency}
                      </span>
                      <input
                        className="input"
                        type="number"
                        min="0"
                        step="0.0001"
                        inputMode="decimal"
                        value={request.exchangeRates[rateKey] || ""}
                        onChange={(event) =>
                          onChange({
                            ...request,
                            exchangeRates: {
                              ...request.exchangeRates,
                              [rateKey]: event.target.value
                            }
                          })
                        }
                        placeholder={targetCurrency}
                      />
                    </label>
                  );
                })}
              </div>
              {!canConfirmRates ? (
                <p className="warning-text">
                  Enter a numeric exchange rate greater than 0 to continue.
                </p>
              ) : null}
            </>
          ) : (
            <>
              <p className="helper-text">
                Select the currency for this receipt before viewing, printing, saving,
                copying, or sharing it.
              </p>
              <div className="currency-options" role="group" aria-label="Receipt currency">
                {RECEIPT_TARGET_CURRENCIES.map((currency) => (
                  <button
                    className={`currency-option${
                      targetCurrency === currency ? " selected" : ""
                    }`}
                    type="button"
                    key={currency}
                    onClick={() =>
                      onChange({
                        ...request,
                        targetCurrency: currency,
                        exchangeRates: {}
                      })
                    }
                  >
                    <span>{currency}</span>
                    <strong>{getReceiptCurrencyLabel(currency)}</strong>
                  </button>
                ))}
              </div>
              {exchangeSources.length === 0 ? (
                <p className="helper-text">
                  No exchange rate is needed because selected items are already in{" "}
                  {targetCurrency}, or have no stored currency.
                </p>
              ) : (
                <p className="helper-text">
                  Exchange rates will be needed from {exchangeSources.join(", ")} to{" "}
                  {targetCurrency}.
                </p>
              )}
            </>
          )}
        </div>

        <div className="modal-actions">
          {isRateStep ? (
            <button
              className="button secondary"
              type="button"
              onClick={() => onChange({ ...request, step: "currency" })}
            >
              Back
            </button>
          ) : null}
          <button className="button secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="button"
            type="button"
            disabled={isRateStep && !canConfirmRates}
            onClick={() => {
              if (!isRateStep && exchangeSources.length > 0) {
                onChange({ ...request, step: "rates" });
                return;
              }

              if (isRateStep && !canConfirmRates) {
                return;
              }

              onConfirm({
                targetCurrency,
                exchangeRates: { ...request.exchangeRates }
              });
            }}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

function ReceiptPanel({ summary, data, setNotice }) {
  const [mode, setMode] = useState("single");
  const [selectedOrderKey, setSelectedOrderKey] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [currencyRequest, setCurrencyRequest] = useState(null);
  const orders = summary.orders;

  useEffect(() => {
    const firstOrderKey = orders[0] ? getRecordKey(orders[0], getOrderReference(orders[0])) : "";

    setSelectedOrderKey((currentKey) => {
      if (currentKey && orders.some((order) => getRecordKey(order, getOrderReference(order)) === currentKey)) {
        return currentKey;
      }

      return firstOrderKey;
    });
  }, [orders]);

  const receiptOrders = useMemo(() => {
    if (mode === "open") {
      return orders.filter((order) =>
        isOrderOpen(order, data.shipments, data.deliveries, data.packageTasks, data.purchases)
      );
    }

    if (mode === "range") {
      return orders.filter((order) =>
        dateIsInRange(getOrderDate(order), startDate, endDate)
      );
    }

    return orders.filter(
      (order) => getRecordKey(order, getOrderReference(order)) === selectedOrderKey
    );
  }, [data.deliveries, data.packageTasks, data.purchases, data.shipments, endDate, mode, orders, selectedOrderKey, startDate]);

  const receiptModel = useMemo(
    () =>
      buildReceiptModel({
        customer: summary.customer,
        orders: receiptOrders,
        purchases: data.purchases,
        shipments: data.shipments,
        deliveries: data.deliveries,
        packageTasks: data.packageTasks,
        packageScanLogs: data.packageScanLogs,
        scopeLabel:
          mode === "open"
            ? "All open orders"
            : mode === "range"
              ? `Orders from ${startDate || "start"} to ${endDate || "end"}`
              : "Selected order"
      }),
    [
      data.deliveries,
      data.packageScanLogs,
      data.packageTasks,
      data.purchases,
      data.shipments,
      endDate,
      mode,
      receiptOrders,
      startDate,
      summary.customer
    ]
  );
  const runReceiptAction = async (action) => {
    try {
      await action();
    } catch (error) {
      setNotice({
        tone: "warning",
        message: error?.message || "Receipt action failed."
      });
    }
  };
  const beginReceiptAction = (actionType) => {
    setCurrencyRequest({
      actionType,
      step: "currency",
      targetCurrency: getDefaultReceiptCurrency(receiptModel),
      exchangeRates: {}
    });
  };
  const executeReceiptAction = async (currencyOptions) => {
    const actionType = currencyRequest?.actionType;
    const displayModel = buildReceiptDisplayModel(receiptModel, currencyOptions);

    setCurrencyRequest(null);

    await runReceiptAction(async () => {
      if (actionType === "view") {
        viewHtmlDocument(buildPrintableReceiptHtml(displayModel), () => {
          setNotice({
            tone: "warning",
            message: "Receipt view could not open."
          });
        });
        setNotice({ message: "Receipt opened for viewing." });
        return;
      }

      if (actionType === "print") {
        printHtmlDocument(buildPrintableReceiptHtml(displayModel), () => {
          setNotice({
            tone: "warning",
            message: "Print preview could not open."
          });
        });
        setNotice({ message: "Receipt document opened for print." });
        return;
      }

      if (actionType === "pdf") {
        setNotice({ message: "Preparing receipt PDF..." });
        const result = await downloadOrShareReceiptPdf(displayModel, () => {
          setNotice({
            tone: "warning",
            message: "PDF print dialog could not open."
          });
        });
        setNotice({
          message:
            result === "print-to-pdf"
              ? "Receipt opened. Choose Save as PDF in the print dialog."
              : "PDF ready."
        });
        return;
      }

      if (actionType === "copy") {
        await copyTextToClipboard(buildReceiptText(displayModel));
        setNotice({ message: "Receipt text copied." });
        return;
      }

      if (actionType === "whatsapp") {
        setNotice({ message: "Preparing PDF for WhatsApp..." });
        let result = "";

        try {
          result = await shareReceiptPdf(displayModel, {
            phone: summary.phone
          });
        } catch (error) {
          if (error?.name === "AbortError") {
            setNotice({ message: "PDF share canceled." });
            return;
          }

          throw error;
        }

        setNotice({
          message:
            result === "shared"
              ? "PDF receipt shared. Choose WhatsApp if prompted."
              : result === "downloaded-opened-whatsapp"
                ? "PDF downloaded. Attach it in the WhatsApp chat."
                : "PDF downloaded. This browser cannot share files directly."
        });
        return;
      }

      if (actionType === "snapchat") {
        setNotice({ message: "Preparing JPG receipt for Snapchat..." });
        let result = "";

        try {
          result = await shareReceiptImage(displayModel);
        } catch (error) {
          if (error?.name === "AbortError") {
            setNotice({ message: "Image share canceled." });
            return;
          }

          throw error;
        }

        setNotice({
          message:
            result === "shared"
              ? "Receipt image shared. Choose Snapchat if prompted."
              : "Receipt image downloaded. Attach it in Snapchat."
        });
      }
    });
  };

  return (
    <section className="receipt-panel">
      <div className="section-title-row compact">
        <div>
          <p className="eyebrow">Receipts</p>
          <h3>Generate customer receipt</h3>
        </div>
        <span className="count-badge">
          {receiptModel.purchaseCount} items |{" "}
          {formatCurrencyTotals(receiptModel.currencyTotals, receiptModel.totalAmount)}
        </span>
      </div>

      <div className="receipt-controls">
        <label>
          <span>Receipt scope</span>
          <select value={mode} onChange={(event) => setMode(event.target.value)}>
            <option value="single">One selected order</option>
            <option value="open">All open orders</option>
            <option value="range">All orders in date range</option>
          </select>
        </label>

        {mode === "single" ? (
          <label>
            <span>Order</span>
            <select
              value={selectedOrderKey}
              onChange={(event) => setSelectedOrderKey(event.target.value)}
            >
              {orders.map((order) => (
                <option
                  key={getRecordKey(order, getOrderReference(order))}
                  value={getRecordKey(order, getOrderReference(order))}
                >
                  {getOrderReference(order)} | {formatDisplayDate(getOrderDate(order), "No date")}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {mode === "range" ? (
          <>
            <label>
              <span>From</span>
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </label>
            <label>
              <span>To</span>
              <input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </label>
          </>
        ) : null}
      </div>

      <div className="receipt-actions">
        <button
          className="button secondary"
          type="button"
          onClick={() => beginReceiptAction("view")}
        >
          <Eye size={16} aria-hidden="true" />
          View receipt
        </button>
        <button
          className="button"
          type="button"
          onClick={() => beginReceiptAction("print")}
        >
          <Printer size={16} aria-hidden="true" />
          Print receipt
        </button>
        <button
          className="button secondary"
          type="button"
          onClick={() => beginReceiptAction("pdf")}
        >
          <FileDown size={16} aria-hidden="true" />
          Save PDF
        </button>
        <button
          className="button secondary"
          type="button"
          onClick={() => beginReceiptAction("copy")}
        >
          <Clipboard size={16} aria-hidden="true" />
          Copy receipt text
        </button>
        <button
          className="button secondary"
          type="button"
          onClick={() => beginReceiptAction("whatsapp")}
        >
          <MessageCircle size={16} aria-hidden="true" />
          WhatsApp PDF
        </button>
        <button
          className="button secondary"
          type="button"
          onClick={() => beginReceiptAction("snapchat")}
        >
          <Camera size={16} aria-hidden="true" />
          Snapchat JPG
        </button>
      </div>
      <ReceiptCurrencyModal
        request={currencyRequest}
        receiptModel={receiptModel}
        onChange={setCurrencyRequest}
        onCancel={() => setCurrencyRequest(null)}
        onConfirm={executeReceiptAction}
      />
    </section>
  );
}

function normalizeEditableCustomerValues(values = {}) {
  return {
    name: String(values.name || "").trim(),
    phone: String(values.phone || "").trim(),
    address: String(values.address || "").trim(),
    email: String(values.email || "").trim(),
    notes: String(values.notes || "").trim()
  };
}

function editableCustomerValuesChanged(initialValues, currentValues) {
  const initial = normalizeEditableCustomerValues(initialValues);
  const current = normalizeEditableCustomerValues(currentValues);

  return Object.keys(initial).some((key) => initial[key] !== current[key]);
}

function CustomerEditForm({
  values,
  setValues,
  initialValues,
  saving,
  onSave,
  onCancel
}) {
  const changed = editableCustomerValuesChanged(initialValues, values);

  return (
    <form className="customer-edit-form" onSubmit={onSave}>
      <div className="section-title-row compact">
        <div>
          <p className="eyebrow">Edit customer</p>
          <h3>Update customer information</h3>
        </div>
      </div>

      <div className="edit-grid">
        <label className="field">
          <span>Name</span>
          <input
            className="input"
            value={values.name}
            onChange={(event) =>
              setValues((currentValues) => ({
                ...currentValues,
                name: event.target.value
              }))
            }
          />
        </label>
        <label className="field">
          <span>Phone</span>
          <input
            className="input"
            value={values.phone}
            inputMode="tel"
            onChange={(event) =>
              setValues((currentValues) => ({
                ...currentValues,
                phone: event.target.value
              }))
            }
          />
        </label>
        <label className="field">
          <span>Email</span>
          <input
            className="input"
            type="email"
            value={values.email}
            onChange={(event) =>
              setValues((currentValues) => ({
                ...currentValues,
                email: event.target.value
              }))
            }
          />
        </label>
        <label className="field">
          <span>Address</span>
          <input
            className="input"
            value={values.address}
            onChange={(event) =>
              setValues((currentValues) => ({
                ...currentValues,
                address: event.target.value
              }))
            }
          />
        </label>
        <label className="field wide">
          <span>Notes</span>
          <textarea
            className="input"
            rows={3}
            value={values.notes}
            onChange={(event) =>
              setValues((currentValues) => ({
                ...currentValues,
                notes: event.target.value
              }))
            }
          />
        </label>
      </div>

      <div className="form-actions">
        <button
          className="button secondary"
          type="button"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button className="button" type="submit" disabled={saving || !changed}>
          <Save size={16} aria-hidden="true" />
          {saving ? "Saving..." : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function CustomerProfile({ summary, data, onClose, onBackToSearch, panelRef, setNotice }) {
  const [expandedOrderKeys, setExpandedOrderKeys] = useState(() => new Set());
  const [editing, setEditing] = useState(false);
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [editValues, setEditValues] = useState(() =>
    getCustomerEditableValues(summary.customer)
  );
  const initialEditValues = useMemo(
    () => getCustomerEditableValues(summary.customer),
    [summary.customer]
  );

  useEffect(() => {
    setExpandedOrderKeys(
      new Set(
        summary.orders[0]
          ? [getRecordKey(summary.orders[0], getOrderReference(summary.orders[0]))]
          : []
      )
    );
    setEditing(false);
    setSavingCustomer(false);
    setEditValues(getCustomerEditableValues(summary.customer));
  }, [summary.customer, summary.key, summary.orders]);

  const unassignedPurchases = summary.purchases.filter(
    (purchase) =>
      !purchaseHasOrderAlias(purchase) ||
      !summary.orders.some((order) =>
        getOrderPurchases(order, [purchase]).includes(purchase)
      )
  );
  const pendingRequestedItems = summary.requestedItems.filter(isPendingRequestedItem);
  const whatsappProfileUrl = buildWhatsAppUrl(summary.phone, "");
  const paymentSummary = useMemo(
    () => buildCustomerPaymentSummary(summary, data.packageScanLogs),
    [data.packageScanLogs, summary]
  );
  const defaultPaymentForm = useMemo(
    () => getDefaultPaymentForm(summary, paymentSummary),
    [paymentSummary, summary]
  );
  const defaultPaymentCorrectionForm = useMemo(
    () => getDefaultPaymentCorrectionForm(summary, paymentSummary),
    [paymentSummary, summary]
  );
  const [recordingPayment, setRecordingPayment] = useState(false);
  const [correctingPayment, setCorrectingPayment] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [savingPaymentCorrection, setSavingPaymentCorrection] = useState(false);
  const [paymentForm, setPaymentForm] = useState(() => defaultPaymentForm);
  const [paymentCorrectionForm, setPaymentCorrectionForm] = useState(
    () => defaultPaymentCorrectionForm
  );
  const canRecordPayment = paymentSummary.hasOutstandingBalance && summary.packageTasks.length > 0;
  const canCorrectPayment = summary.packageTasks.length > 0;

  useEffect(() => {
    setRecordingPayment(false);
    setCorrectingPayment(false);
    setSavingPayment(false);
    setSavingPaymentCorrection(false);
    setPaymentForm(defaultPaymentForm);
    setPaymentCorrectionForm(defaultPaymentCorrectionForm);
  }, [defaultPaymentCorrectionForm, defaultPaymentForm]);

  const toggleOrder = (order) => {
    const orderKey = getRecordKey(order, getOrderReference(order));

    setExpandedOrderKeys((currentKeys) => {
      const nextKeys = new Set(currentKeys);

      if (nextKeys.has(orderKey)) {
        nextKeys.delete(orderKey);
      } else {
        nextKeys.add(orderKey);
      }

      return nextKeys;
    });
  };
  const handleEditCustomerSave = async (event) => {
    event.preventDefault();

    if (!editableCustomerValuesChanged(initialEditValues, editValues)) {
      return;
    }

    setSavingCustomer(true);

    try {
      await updateCustomerInfo(
        summary.customer,
        normalizeEditableCustomerValues(editValues)
      );
      setEditing(false);
      setNotice({ message: "Customer updated." });
    } catch (error) {
      setNotice({
        tone: "warning",
        message: getErrorMessage(error) || "Customer update failed."
      });
    } finally {
      setSavingCustomer(false);
    }
  };
  const handleCancelEditCustomer = () => {
    setEditValues(initialEditValues);
    setEditing(false);
  };
  const handleSavePayment = async (event) => {
    event.preventDefault();

    const selectedTask = summary.packageTasks.find(
      (task, index) => getRecordKey(task, `package-task-${index}`) === paymentForm.packageTaskKey
    );

    if (!selectedTask) {
      setNotice({ tone: "warning", message: "Select a package task before saving payment." });
      return;
    }

    setSavingPayment(true);

    try {
      await addPackageTaskPayment(selectedTask, paymentForm);
      setRecordingPayment(false);
      setPaymentForm(defaultPaymentForm);
      setNotice({ message: "Payment added to package task." });
    } catch (error) {
      setNotice({
        tone: "warning",
        message: getErrorMessage(error) || "Payment update failed."
      });
    } finally {
      setSavingPayment(false);
    }
  };
  const handleCancelPayment = () => {
    setPaymentForm(defaultPaymentForm);
    setRecordingPayment(false);
  };
  const handleSavePaymentCorrection = async (event) => {
    event.preventDefault();

    const selectedTask = summary.packageTasks.find(
      (task, index) => getRecordKey(task, `package-task-${index}`) === paymentCorrectionForm.packageTaskKey
    );

    if (!selectedTask) {
      setNotice({ tone: "warning", message: "Select a package task before saving payment correction." });
      return;
    }

    setSavingPaymentCorrection(true);

    try {
      await correctPackageTaskPayment(selectedTask, paymentCorrectionForm);
      setCorrectingPayment(false);
      setPaymentCorrectionForm(defaultPaymentCorrectionForm);
      setNotice({ message: "Payment correction saved." });
    } catch (error) {
      setNotice({
        tone: "warning",
        message: getErrorMessage(error) || "Payment correction failed."
      });
    } finally {
      setSavingPaymentCorrection(false);
    }
  };
  const handleCancelPaymentCorrection = () => {
    setPaymentCorrectionForm(defaultPaymentCorrectionForm);
    setCorrectingPayment(false);
  };

  return (
    <section className="profile-panel" ref={panelRef}>
      <div className="profile-header">
        <div>
          <p className="eyebrow">Customer profile</p>
          <h2>{summary.name}</h2>
          <p>{summary.phone || "No phone on record"}</p>
        </div>
        <button className="icon-button" type="button" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="profile-actions">
        <button
          className="button secondary mobile-only"
          type="button"
          onClick={onBackToSearch}
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Back to search
        </button>
        <button
          className="button secondary"
          type="button"
          disabled={savingCustomer}
          onClick={() => {
            setEditValues(initialEditValues);
            setEditing(true);
          }}
        >
          <Pencil size={16} aria-hidden="true" />
          Edit customer
        </button>
        <CopyPhoneButton phone={summary.phone} setNotice={setNotice} />
        <a
          className={`button secondary${whatsappProfileUrl ? "" : " disabled"}`}
          href={whatsappProfileUrl || undefined}
          target="_blank"
          rel="noreferrer"
          aria-disabled={!whatsappProfileUrl}
        >
          <MessageCircle size={16} aria-hidden="true" />
          WhatsApp
        </a>
      </div>

      {editing ? (
        <CustomerEditForm
          values={editValues}
          setValues={setEditValues}
          initialValues={initialEditValues}
          saving={savingCustomer}
          onSave={handleEditCustomerSave}
          onCancel={handleCancelEditCustomer}
        />
      ) : (
        <div className="detail-grid profile-details">
          <div>
            <span>Name</span>
            <strong>{getCustomerName(summary.customer)}</strong>
          </div>
          <div>
            <span>Phone</span>
            <strong>{getCustomerPhone(summary.customer) || "Not provided"}</strong>
          </div>
          <div>
            <span>Address</span>
            <strong>{getCustomerAddress(summary.customer) || "Not provided"}</strong>
          </div>
          <div>
            <span>Email</span>
            <strong>{getCustomerEmail(summary.customer) || "Not provided"}</strong>
          </div>
          {summary.notes ? (
            <div className="wide">
              <span>Notes</span>
              <strong>{summary.notes}</strong>
            </div>
          ) : null}
        </div>
      )}

      <div className="profile-stats">
        <div>
          <span>Orders</span>
          <strong>{summary.orderCount}</strong>
        </div>
        <div>
          <span>Order items</span>
          <strong>{summary.purchaseCount}</strong>
        </div>
        <div>
          <span>Pending requests</span>
          <strong>{pendingRequestedItems.length}</strong>
        </div>
        <div>
          <span>Total</span>
          <strong>{formatCurrencyTotals(summary.currencyTotals)}</strong>
        </div>
      </div>

      <CustomerPaymentStatusCard
        paymentSummary={paymentSummary}
        canRecordPayment={canRecordPayment}
        canCorrectPayment={canCorrectPayment}
        onRecordPayment={() => {
          setPaymentForm(defaultPaymentForm);
          setCorrectingPayment(false);
          setRecordingPayment(true);
        }}
        onCorrectPayment={() => {
          setPaymentCorrectionForm(defaultPaymentCorrectionForm);
          setRecordingPayment(false);
          setCorrectingPayment(true);
        }}
      />

      {recordingPayment ? (
        <PaymentRecordForm
          packageTasks={summary.packageTasks}
          values={paymentForm}
          setValues={setPaymentForm}
          saving={savingPayment}
          onSave={handleSavePayment}
          onCancel={handleCancelPayment}
        />
      ) : null}

      {correctingPayment ? (
        <PaymentCorrectionForm
          packageTasks={summary.packageTasks}
          values={paymentCorrectionForm}
          setValues={setPaymentCorrectionForm}
          saving={savingPaymentCorrection}
          onSave={handleSavePaymentCorrection}
          onCancel={handleCancelPaymentCorrection}
        />
      ) : null}

      <ReceiptPanel summary={summary} data={data} setNotice={setNotice} />

      <section className="related-panel">
        <div className="section-title-row compact">
          <div>
            <p className="eyebrow">Linked records</p>
            <h3>Requests and logistics</h3>
          </div>
        </div>
        <div className="related-grid">
          <div>
            <strong>Requested items</strong>
            {summary.requestedItems.length ? (
              summary.requestedItems.map((item, index) => (
                <p key={getRecordKey(item, index)}>
                  {firstText(item.item, item.productName, item.name, "Requested item")} |{" "}
                  {item.status || "Requested"}
                </p>
              ))
            ) : (
              <p>No linked requested items.</p>
            )}
          </div>
          <div>
            <strong>Shipments</strong>
            {summary.shipments.length ? (
              summary.shipments.map((shipment, index) => (
                <p key={getRecordKey(shipment, index)}>
                  {firstText(shipment.trackingNumber, shipment.tracking, shipment.id, "Shipment")} |{" "}
                  {shipment.status || "Shipped"}
                </p>
              ))
            ) : (
              <p>No linked shipments.</p>
            )}
          </div>
          <div>
            <strong>Deliveries</strong>
            {summary.deliveries.length ? (
              summary.deliveries.map((delivery, index) => (
                <p key={getRecordKey(delivery, index)}>
                  {firstText(delivery.deliveryProviderName, delivery.address, delivery.id, "Delivery")} |{" "}
                  {delivery.status || "Linked"}
                </p>
              ))
            ) : (
              <p>No linked deliveries.</p>
            )}
          </div>
          <div>
            <strong>Package tasks</strong>
            {summary.packageTasks.length ? (
              <p>{summary.packageTasks.length} linked package tasks</p>
            ) : (
              <p>No linked package tasks.</p>
            )}
          </div>
        </div>
      </section>

      <section className="orders-section">
        <div className="section-title-row compact">
          <div>
            <p className="eyebrow">Orders</p>
            <h3>Related orders newest first</h3>
          </div>
        </div>

        {summary.orders.length ? (
          <div className="orders-list">
            {summary.orders.map((order) => {
              const orderKey = getRecordKey(order, getOrderReference(order));

              return (
                <OrderCard
                  key={orderKey}
                  order={order}
                  data={data}
                  expanded={expandedOrderKeys.has(orderKey)}
                  onToggle={() => toggleOrder(order)}
                />
              );
            })}
          </div>
        ) : (
          <div className="empty-state inline">
            <ShoppingBag size={22} aria-hidden="true" />
            <h3>No related orders</h3>
            <p>This customer has no linked orders in the shared collections.</p>
          </div>
        )}
      </section>

      {unassignedPurchases.length ? (
        <section className="orders-section">
          <div className="section-title-row compact">
            <div>
              <p className="eyebrow">Order items</p>
              <h3>Customer items not linked to a visible order</h3>
            </div>
          </div>
          <OrderItemsTable purchases={unassignedPurchases} />
        </section>
      ) : null}
    </section>
  );
}

function CustomerOrdersWorkspace({ dataState, authUser }) {
  const { data, errors, loadedCollections, pendingCollections, status } = dataState;
  const searchPanelRef = useRef(null);
  const profilePanelRef = useRef(null);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [filters, setFilters] = useState({
    openOnly: false,
    deliveredOnly: false,
    pendingRequests: false
  });
  const [selectedCustomerKey, setSelectedCustomerKey] = useState("");
  const [notice, setNotice] = useState(null);
  const debouncedQuery = useDebouncedValue(query);

  useEffect(() => {
    if (!notice) {
      return undefined;
    }

    const timer = window.setTimeout(() => setNotice(null), 3500);

    return () => window.clearTimeout(timer);
  }, [notice]);

  const summaries = useMemo(
    () =>
      data.customers
        .map((customer) => buildCustomerSummary(customer, data))
        .sort((leftSummary, rightSummary) =>
          leftSummary.name.localeCompare(rightSummary.name, undefined, {
            sensitivity: "base"
          })
        ),
    [data]
  );

  const selectedSummary = useMemo(() => {
    if (!selectedCustomerKey) {
      return null;
    }

    return (
      summaries.find((summary) => summary.key === selectedCustomerKey) ||
      summaries.find((summary) =>
        identityValues(summary.customer).includes(selectedCustomerKey)
      ) ||
      null
    );
  }, [selectedCustomerKey, summaries]);

  const paymentSummaries = useMemo(
    () => summaries.map((summary) => buildCustomerPaymentSummary(summary, data.packageScanLogs)),
    [data.packageScanLogs, summaries]
  );

  const visibleSummaries = useMemo(() => {
    if (!showAll && !debouncedQuery.trim()) {
      return [];
    }

    return summaries.filter((summary) => {
      if (debouncedQuery.trim() && !customerMatchesSearch(summary, debouncedQuery)) {
        return false;
      }

      if (
        filters.openOnly &&
        !summary.orderSummaries.some((orderSummary) => orderSummary.status === "Open")
      ) {
        return false;
      }

      if (
        filters.deliveredOnly &&
        !summary.orderSummaries.some((orderSummary) =>
          isCustomerFacingOrderDeliveredStatus(orderSummary.status)
        )
      ) {
        return false;
      }

      if (filters.pendingRequests && summary.pendingRequestedItems.length === 0) {
        return false;
      }

      return true;
    });
  }, [debouncedQuery, filters, showAll, summaries]);

  const collectionCounts = FIRESTORE_READ_COLLECTIONS.map((collectionName) => ({
    collectionName,
    count: data[collectionName]?.length || 0
  }));
  const isNarrowScreen = () =>
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 1100px)").matches;
  const scrollToProfileOnPhone = () => {
    if (!isNarrowScreen()) {
      return;
    }

    window.setTimeout(() => {
      profilePanelRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }, 80);
  };
  const scrollToSearchOnPhone = () => {
    if (!isNarrowScreen()) {
      return;
    }

    searchPanelRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  };
  const handleWorkspaceSignOut = async () => {
    try {
      await signOutBellaUser();
    } catch (error) {
      setNotice({
        tone: "warning",
        message: getErrorMessage(error) || "Sign out failed."
      });
    }
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-mark">
          <img src="/bella-butterfly.png" alt="Bella Boutique logo" />
        </div>
        <div>
          <p className="eyebrow">Bella Boutique</p>
          <h1>Customer Orders</h1>
          <p>Customer, order, receipt, and delivery payment workspace.</p>
        </div>
        <div className="header-side">
          <StatusIndicator
            status={status}
            errors={errors}
            loadedCollections={loadedCollections}
            pendingCollections={pendingCollections}
            collectionCounts={collectionCounts}
          />
          <div className="user-strip">
            <span>{authUser.email || authUser.uid}</span>
            <button className="button secondary compact-button" type="button" onClick={handleWorkspaceSignOut}>
              <LogOut size={15} aria-hidden="true" />
              Sign out
            </button>
          </div>
        </div>
      </header>

      <ErrorBanner errors={errors} />

      <PaymentFollowUpsPanel
        paymentSummaries={paymentSummaries}
        selectedCustomerKey={selectedCustomerKey}
        isProfileOpen={Boolean(selectedSummary)}
        onSelect={(summary) => {
          setSelectedCustomerKey(summary.key);
          scrollToProfileOnPhone();
        }}
      />

      <main className="workspace">
        <SearchWorkspace
          panelRef={searchPanelRef}
          query={query}
          setQuery={setQuery}
          showAll={showAll}
          setShowAll={setShowAll}
          filters={filters}
          setFilters={setFilters}
          summaries={summaries}
          visibleSummaries={visibleSummaries}
          selectedSummary={selectedSummary}
          onSelect={(summary) => {
            setSelectedCustomerKey(summary.key);
            scrollToProfileOnPhone();
          }}
        />

        {selectedSummary ? (
          <CustomerProfile
            summary={selectedSummary}
            data={data}
            panelRef={profilePanelRef}
            onClose={() => setSelectedCustomerKey("")}
            onBackToSearch={scrollToSearchOnPhone}
            setNotice={setNotice}
          />
        ) : (
          <section className="profile-panel empty-profile">
            <Phone size={28} aria-hidden="true" />
            <h2>Select a customer</h2>
            <p>Search by name or phone, then open a profile to view orders and receipts.</p>
          </section>
        )}
      </main>

      <Toast notice={notice} onClose={() => setNotice(null)} />
    </div>
  );
}

function App() {
  const authState = useBellaAuth();
  const isAuthorized = authState.status === "authorized";
  const dataState = useBellaData(isAuthorized);

  if (!isAuthorized) {
    return <LoginScreen authState={authState} />;
  }

  return <CustomerOrdersWorkspace dataState={dataState} authUser={authState.user} />;
}
export default App;
