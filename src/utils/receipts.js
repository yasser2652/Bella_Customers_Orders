import {
  formatCurrency,
  formatCurrencyTotals,
  formatDisplayDate,
  normalizeCurrencyCode
} from "./formatters.js";
import {
  combineCurrencyTotals,
  firstText,
  getOrderDate,
  getOrderPurchases,
  getOrderReference,
  getOrderSummary,
  getPurchaseCurrencyTotals,
  getPurchaseItemName,
  getPurchaseLineTotal,
  getPurchaseQuantity,
  getPurchaseUnitPrice,
  normalizePhone,
  roundCurrencyAmount
} from "./relationships.js";

const BRAND_NAME = "Bella Boutique";
export const RECEIPT_TARGET_CURRENCIES = ["USD", "LYD"];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getLogoUrl(variant = "default") {
  const filename =
    variant === "print" ? "bella-butterfly_print.png" : "bella-butterfly.png";

  if (typeof window === "undefined") {
    return `/${filename}`;
  }

  return new URL(`/${filename}`, window.location.origin).toString();
}

function getReceiptFileName(model, extension = "pdf") {
  const customerSegment = String(model.customer?.name || model.customer?.id || "customer")
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const dateSegment = new Date().toISOString().slice(0, 10);
  const cleanExtension = String(extension || "pdf").replace(/^\.+/, "") || "pdf";

  return `bella-receipt-${customerSegment || "customer"}-${dateSegment}.${cleanExtension}`;
}

export function getReceiptImageFileName(model) {
  return getReceiptFileName(model, "jpg");
}

function extractBodyMarkup(html) {
  const match = String(html || "").match(/<body[^>]*>([\s\S]*)<\/body>/i);

  return match ? match[1] : html;
}

function extractStyleMarkup(html) {
  return [...String(html || "").matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1])
    .join("\n");
}

function withAutoPrintScript(html) {
  const script = `
    <script>
      window.addEventListener("load", function () {
        window.setTimeout(function () {
          window.focus();
          window.print();
        }, 250);
      });
    </script>
  `;

  return String(html).replace("</body>", `${script}</body>`);
}

async function waitForImages(root) {
  const images = Array.from(root.querySelectorAll("img"));

  await Promise.all(
    images.map(
      (image) =>
        image.complete ||
        new Promise((resolve) => {
          image.onload = resolve;
          image.onerror = resolve;
        })
    )
  );
}

function createReceiptRenderHost(html) {
  const styleElement = document.createElement("style");
  const renderHost = document.createElement("div");

  styleElement.textContent = `
    ${extractStyleMarkup(html)}
    .pdf-render-host {
      position: fixed;
      left: -12000px;
      top: 0;
      width: 980px;
      min-height: 1px;
      background: #ffffff;
      z-index: -1;
      pointer-events: none;
    }
    .pdf-render-host .sheet {
      max-width: 980px;
      box-shadow: none;
    }
  `;
  renderHost.className = "pdf-render-host";
  renderHost.innerHTML = extractBodyMarkup(html);
  document.head.appendChild(styleElement);
  document.body.appendChild(renderHost);

  return {
    element: renderHost.querySelector(".sheet") || renderHost,
    cleanup() {
      renderHost.remove();
      styleElement.remove();
    }
  };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function renderReceiptCanvas(model) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("Receipt image generation is only available in the browser.");
  }

  const html2canvasModule = await import("html2canvas");
  const html2canvas = html2canvasModule.default || html2canvasModule;
  const html = buildPrintableReceiptHtml(model);
  const renderHost = createReceiptRenderHost(html);

  try {
    await waitForImages(renderHost.element);

    return await html2canvas(renderHost.element, {
      backgroundColor: "#ffffff",
      scale: Math.min(window.devicePixelRatio || 2, 2),
      useCORS: true,
      logging: false,
      windowWidth: 980
    });
  } finally {
    renderHost.cleanup();
  }
}

function canvasToBlob(canvas, type = "image/jpeg", quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error("Receipt image could not be generated."));
      },
      type,
      quality
    );
  });
}

export function normalizeReceiptTargetCurrency(value) {
  const cleanCurrency = normalizeCurrencyCode(value);

  return RECEIPT_TARGET_CURRENCIES.includes(cleanCurrency) ? cleanCurrency : "USD";
}

export function getReceiptCurrencyLabel(currency) {
  const cleanCurrency = normalizeReceiptTargetCurrency(currency);

  return cleanCurrency === "LYD" ? "Libyan dinar (LYD)" : "US dollar (USD)";
}

export function getReceiptExchangeRateKey(sourceCurrency, targetCurrency) {
  return `${normalizeCurrencyCode(sourceCurrency) || "NO_CURRENCY"}:${
    normalizeReceiptTargetCurrency(targetCurrency)
  }`;
}

export function getReceiptExchangeRateValue(value) {
  const rate = Number(String(value || "").trim().replace(",", "."));

  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

export function getReceiptExchangeSources(purchases = [], targetCurrency) {
  const cleanTargetCurrency = normalizeReceiptTargetCurrency(targetCurrency);

  return [
    ...new Set(
      (Array.isArray(purchases) ? purchases : [])
        .map((purchase) => normalizeCurrencyCode(purchase?.currency))
        .filter(
          (sourceCurrency) =>
            sourceCurrency && sourceCurrency !== cleanTargetCurrency
        )
    )
  ];
}

export function hasReceiptExchangeRates(
  purchases = [],
  targetCurrency,
  exchangeRates = {}
) {
  const cleanTargetCurrency = normalizeReceiptTargetCurrency(targetCurrency);

  return getReceiptExchangeSources(purchases, cleanTargetCurrency).every(
    (sourceCurrency) =>
      getReceiptExchangeRateValue(
        exchangeRates[
          getReceiptExchangeRateKey(sourceCurrency, cleanTargetCurrency)
        ]
      )
  );
}

export function buildReceiptExchangeRateLines(purchases = [], options = {}) {
  const targetCurrency = normalizeReceiptTargetCurrency(options.targetCurrency);

  return getReceiptExchangeSources(purchases, targetCurrency)
    .map((sourceCurrency) => {
      const rate = getReceiptExchangeRateValue(
        options.exchangeRates?.[
          getReceiptExchangeRateKey(sourceCurrency, targetCurrency)
        ]
      );

      return rate ? `1 ${sourceCurrency} = ${rate} ${targetCurrency}` : "";
    })
    .filter(Boolean);
}

function getPurchaseExchangeRate(purchase, targetCurrency, exchangeRates = {}) {
  const sourceCurrency = normalizeCurrencyCode(purchase?.currency);
  const cleanTargetCurrency = normalizeReceiptTargetCurrency(targetCurrency);

  if (!sourceCurrency || sourceCurrency === cleanTargetCurrency) {
    return 1;
  }

  const rate = getReceiptExchangeRateValue(
    exchangeRates[getReceiptExchangeRateKey(sourceCurrency, cleanTargetCurrency)]
  );

  if (!rate) {
    throw new Error(`Missing exchange rate from ${sourceCurrency} to ${cleanTargetCurrency}.`);
  }

  return rate;
}

export function buildReceiptDisplayPurchases(purchases = [], options = {}) {
  const targetCurrency = normalizeReceiptTargetCurrency(options.targetCurrency);

  return (Array.isArray(purchases) ? purchases : []).map((purchase) => {
    const rate = getPurchaseExchangeRate(
      purchase,
      targetCurrency,
      options.exchangeRates || {}
    );

    return {
      ...purchase,
      originalCurrency: normalizeCurrencyCode(purchase.currency),
      originalUnitPrice: getPurchaseUnitPrice(purchase),
      originalAmount: getPurchaseLineTotal(purchase),
      unitPrice: roundCurrencyAmount(getPurchaseUnitPrice(purchase) * rate),
      amount: roundCurrencyAmount(getPurchaseLineTotal(purchase) * rate),
      currency: targetCurrency
    };
  });
}

export function buildReceiptDisplayModel(model, options = {}) {
  const targetCurrency = normalizeReceiptTargetCurrency(options.targetCurrency);
  const exchangeRates = options.exchangeRates || {};
  const exchangeRateLines = buildReceiptExchangeRateLines(
    model.purchases,
    { targetCurrency, exchangeRates }
  );
  const orderRows = model.orderRows.map((row) => {
    const purchases = buildReceiptDisplayPurchases(row.purchases, {
      targetCurrency,
      exchangeRates
    });

    return {
      ...row,
      purchases,
      currencyTotals: getPurchaseCurrencyTotals(purchases)
    };
  });
  const allPurchases = orderRows.flatMap((row) => row.purchases);
  const currencyTotals = combineCurrencyTotals(
    orderRows.map((row) => row.currencyTotals)
  );

  return {
    ...model,
    orderRows,
    purchases: allPurchases,
    purchaseCount: allPurchases.length,
    currencyTotals,
    totalAmount: roundCurrencyAmount(
      allPurchases.reduce(
        (runningTotal, purchase) => runningTotal + getPurchaseLineTotal(purchase),
        0
      )
    ),
    targetCurrency,
    exchangeRates: { ...exchangeRates },
    exchangeRateLines
  };
}

export function buildReceiptModel({
  customer,
  orders = [],
  purchases = [],
  shipments = [],
  deliveries = [],
  packageTasks = [],
  scopeLabel = "Selected orders"
}) {
  const orderRows = (Array.isArray(orders) ? orders : []).map((order) => {
    const orderPurchases = getOrderPurchases(order, purchases);
    const summary = getOrderSummary(
      order,
      purchases,
      shipments,
      deliveries,
      packageTasks
    );

    return {
      order,
      reference: getOrderReference(order),
      id: firstText(order.id, order.firestoreId, "Unknown"),
      date: getOrderDate(order),
      status: summary.status,
      purchases: orderPurchases,
      currencyTotals: getPurchaseCurrencyTotals(orderPurchases),
      shipment: summary.shipment,
      delivery: summary.delivery,
      packageTasks: summary.packageTasks
    };
  });
  const allPurchases = orderRows.flatMap((row) => row.purchases);
  const currencyTotals = combineCurrencyTotals(
    orderRows.map((row) => row.currencyTotals)
  );

  return {
    brandName: BRAND_NAME,
    customer,
    scopeLabel,
    generatedOn: new Date().toISOString(),
    orderRows,
    purchases: allPurchases,
    purchaseCount: allPurchases.length,
    currencyTotals,
    totalAmount: allPurchases.reduce(
      (runningTotal, purchase) => runningTotal + getPurchaseLineTotal(purchase),
      0
    )
  };
}

export function buildReceiptText(model) {
  const customer = model.customer || {};
  const targetCurrency = normalizeCurrencyCode(model.targetCurrency);
  const lines = [
    `${model.brandName} receipt`,
    `Generated: ${formatDisplayDate(model.generatedOn, model.generatedOn, {
      includeTime: true
    })}`,
    `Scope: ${model.scopeLabel}`
  ];

  if (targetCurrency) {
    lines.push(`Receipt currency: ${targetCurrency}`);
  }

  if (model.exchangeRateLines?.length) {
    lines.push(`Exchange rates: ${model.exchangeRateLines.join(" | ")}`);
  }

  lines.push(
    "",
    "Customer",
    `Name: ${firstText(customer.name, "Unknown customer")}`,
    `Phone: ${firstText(customer.phone, "Not provided")}`,
    `Address: ${firstText(customer.address, "Not provided")}`,
    "",
    "Orders"
  );

  if (model.orderRows.length === 0) {
    lines.push("No orders selected.");
  }

  model.orderRows.forEach((row, orderIndex) => {
    const shipmentInfo = row.shipment
      ? ` | Shipment: ${firstText(
          row.shipment.trackingNumber,
          row.shipment.tracking,
          row.shipment.id,
          "Linked"
        )} (${firstText(row.shipment.status, "Shipped")})`
      : "";
    const deliveryInfo = row.delivery
      ? ` | Delivery: ${firstText(
          row.delivery.trackingNumber,
          row.delivery.deliveryProviderName,
          row.delivery.id,
          "Linked"
        )} (${firstText(row.delivery.status, "Linked")})`
      : "";

    lines.push("");
    lines.push(
      `${orderIndex + 1}. ${row.reference} | Order ID: ${row.id} | Date: ${formatDisplayDate(
        row.date,
        "Not provided"
      )} | Status: ${row.status}${shipmentInfo}${deliveryInfo}`
    );

    if (row.packageTasks.length > 0) {
      const packed = row.packageTasks.reduce(
        (total, task) => total + (Number(task.quantityPacked) || 0),
        0
      );
      const needed = row.packageTasks.reduce(
        (total, task) => total + (Number(task.quantityNeeded) || 0),
        0
      );
      lines.push(`Package tasks: ${packed}/${needed || row.packageTasks.length}`);
    }

    if (row.purchases.length === 0) {
      lines.push("No linked order items.");
      return;
    }

    row.purchases.forEach((purchase, itemIndex) => {
      const quantity = getPurchaseQuantity(purchase);
      const unitPrice = getPurchaseUnitPrice(purchase);
      const lineTotal = getPurchaseLineTotal(purchase);
      const itemMeta = [
        purchase.brand,
        purchase.category,
        purchase.color,
        purchase.size
      ]
        .filter(Boolean)
        .join(" / ");

      lines.push(
        `  ${itemIndex + 1}. ${getPurchaseItemName(purchase)}${
          itemMeta ? ` (${itemMeta})` : ""
        } | Qty: ${quantity} | Unit: ${formatCurrency(
          unitPrice,
          purchase.currency
        )} | Total: ${formatCurrency(lineTotal, purchase.currency)}${
          purchase.purchasedBy ? ` | Purchased by: ${purchase.purchasedBy}` : ""
        }${purchase.supplier ? ` | Supplier: ${purchase.supplier}` : ""}`
      );
    });

    lines.push(`Order total: ${formatCurrencyTotals(row.currencyTotals)}`);
  });

  lines.push("");
  lines.push(`Receipt total: ${formatCurrencyTotals(model.currencyTotals, model.totalAmount)}`);
  lines.push("");
  lines.push(
    targetCurrency
      ? "Converted amounts are generated for this receipt only and are not saved to Firebase."
      : "Mixed currencies are grouped and not converted."
  );

  return lines.join("\n");
}

export function buildPrintableReceiptHtml(model) {
  const customer = model.customer || {};
  const targetCurrency = normalizeCurrencyCode(model.targetCurrency);
  const currencyLine = targetCurrency
    ? `Receipt totals shown in ${targetCurrency}.`
    : "Mixed currencies are grouped and not converted.";
  const exchangeRateMarkup = model.exchangeRateLines?.length
    ? `<div>Rates: ${escapeHtml(model.exchangeRateLines.join(" | "))}</div>`
    : "";
  const rowsMarkup = model.orderRows
    .map((row) => {
      const shipmentLine = row.shipment
        ? `<div class="muted">Shipment: ${escapeHtml(
            firstText(row.shipment.trackingNumber, row.shipment.tracking, "Linked")
          )} (${escapeHtml(firstText(row.shipment.status, "Shipped"))})</div>`
        : "";
      const packageLine = row.packageTasks.length
        ? `<div class="muted">Package tasks: ${escapeHtml(
            String(row.packageTasks.length)
          )}</div>`
        : "";
      const itemRows = row.purchases.length
        ? row.purchases
            .map((purchase) => {
              const meta = [
                purchase.brand,
                purchase.category,
                purchase.color,
                purchase.size
              ]
                .filter(Boolean)
                .join(" / ");

              return `
                <tr>
                  <td>
                    <strong>${escapeHtml(getPurchaseItemName(purchase))}</strong>
                    ${meta ? `<span>${escapeHtml(meta)}</span>` : ""}
                  </td>
                  <td>${escapeHtml(String(getPurchaseQuantity(purchase)))}</td>
                  <td>${escapeHtml(
                    formatCurrency(getPurchaseUnitPrice(purchase), purchase.currency)
                  )}</td>
                  <td>${escapeHtml(
                    formatCurrency(getPurchaseLineTotal(purchase), purchase.currency)
                  )}</td>
                </tr>
              `;
            })
            .join("")
        : `<tr><td colspan="4">No linked order items.</td></tr>`;

      return `
        <section class="order-block">
          <div class="order-heading">
            <div>
              <p class="eyebrow">Order</p>
              <h2>${escapeHtml(row.reference)}</h2>
              <div class="muted">ID: ${escapeHtml(row.id)} | ${escapeHtml(
                formatDisplayDate(row.date, "Not provided")
              )} | ${escapeHtml(row.status)}</div>
              ${shipmentLine}
              ${packageLine}
            </div>
            <strong>${escapeHtml(formatCurrencyTotals(row.currencyTotals))}</strong>
          </div>
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Unit price</th>
                <th>Line total</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
          </table>
        </section>
      `;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(model.brandName)} receipt</title>
    <style>
      @page { margin: 12mm; }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 32px; font-family: "Segoe UI", Tahoma, sans-serif; background: #f7f3eb; color: #1f2937; }
      .sheet { max-width: 980px; margin: 0 auto; background: #fff; border: 1px solid #eadfce; border-radius: 20px; padding: 28px; }
      .hero { display: flex; gap: 24px; justify-content: space-between; border-bottom: 1px solid #eadfce; padding-bottom: 20px; }
      .brand { display: flex; gap: 18px; align-items: center; }
      .brand img { width: 110px; height: 110px; object-fit: contain; }
      .eyebrow { margin: 0 0 6px; color: #8b5e34; font-size: 12px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; }
      h1, h2, p { margin: 0; }
      h1 { font-size: 30px; line-height: 1.1; }
      h2 { font-size: 20px; }
      .muted { color: #667085; font-size: 13px; }
      .meta { display: grid; gap: 6px; text-align: right; color: #475467; font-size: 13px; }
      .grid { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 16px; margin-top: 20px; }
      .panel { border: 1px solid #eadfce; border-radius: 16px; padding: 16px; background: #fcfaf7; }
      .detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin-top: 10px; }
      .summary { display: flex; justify-content: space-between; gap: 18px; align-items: center; margin-top: 20px; padding: 16px; border-radius: 16px; background: #f7efe3; color: #6c4726; }
      .order-block { margin-top: 24px; break-inside: avoid; }
      .order-heading { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; margin-bottom: 10px; }
      table { width: 100%; border-collapse: collapse; border: 1px solid #eadfce; border-radius: 14px; overflow: hidden; }
      th, td { padding: 12px; text-align: left; border-bottom: 1px solid #eadfce; vertical-align: top; }
      th { background: #f7efe3; color: #6c4726; font-size: 13px; }
      tbody tr:last-child td { border-bottom: 0; }
      td span { display: block; margin-top: 4px; color: #667085; font-size: 12px; }
      .footer { margin-top: 22px; color: #667085; font-size: 13px; }
      @media print {
        body { padding: 0; background: #fff; }
        .sheet { border: 0; border-radius: 0; padding: 0; }
      }
    </style>
  </head>
  <body>
    <main class="sheet">
      <header class="hero">
        <div class="brand">
          <img src="${escapeHtml(getLogoUrl("print"))}" alt="Bella Boutique logo" />
          <div>
            <p class="eyebrow">${escapeHtml(model.brandName)}</p>
            <h1>Customer Receipt</h1>
            <p class="muted">${escapeHtml(currencyLine)}</p>
          </div>
        </div>
        <div class="meta">
          <div>Generated: ${escapeHtml(
            formatDisplayDate(model.generatedOn, model.generatedOn, {
              includeTime: true
            })
          )}</div>
          <div>Scope: ${escapeHtml(model.scopeLabel)}</div>
          ${targetCurrency ? `<div>Currency: ${escapeHtml(targetCurrency)}</div>` : ""}
          ${exchangeRateMarkup}
        </div>
      </header>
      <section class="grid">
        <div class="panel">
          <p class="eyebrow">Customer</p>
          <div class="detail-grid">
            <div><strong>Name:</strong> ${escapeHtml(
              firstText(customer.name, "Unknown customer")
            )}</div>
            <div><strong>Phone:</strong> ${escapeHtml(
              firstText(customer.phone, "Not provided")
            )}</div>
            <div><strong>Email:</strong> ${escapeHtml(
              firstText(customer.email, "Not provided")
            )}</div>
            <div><strong>Address:</strong> ${escapeHtml(
              firstText(customer.address, "Not provided")
            )}</div>
          </div>
        </div>
        <div class="panel">
          <p class="eyebrow">Summary</p>
          <div class="detail-grid">
            <div><strong>Orders:</strong> ${escapeHtml(
              String(model.orderRows.length)
            )}</div>
            <div><strong>Items:</strong> ${escapeHtml(
              String(model.purchaseCount)
            )}</div>
            <div><strong>Total:</strong> ${escapeHtml(
              formatCurrencyTotals(model.currencyTotals, model.totalAmount)
            )}</div>
            ${targetCurrency ? `<div><strong>Currency:</strong> ${escapeHtml(targetCurrency)}</div>` : ""}
          </div>
        </div>
      </section>
      <div class="summary">
        <span>Total</span>
        <strong>${escapeHtml(
          formatCurrencyTotals(model.currencyTotals, model.totalAmount)
        )}</strong>
      </div>
      ${rowsMarkup || '<p class="footer">No orders selected.</p>'}
      <p class="footer">${
        targetCurrency
          ? "Converted amounts are generated for this receipt only and are not saved to Firebase."
          : "Receipt generated from read-only Bella Boutique records."
      }</p>
    </main>
  </body>
</html>`;
}

export function printHtmlDocument(html, onFailure = () => {}) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    onFailure();
    return;
  }

  const printWindow = window.open("", "_blank");

  if (printWindow) {
    try {
      printWindow.opener = null;
      printWindow.document.open();
      printWindow.document.write(withAutoPrintScript(html));
      printWindow.document.close();
      return;
    } catch (error) {
      printWindow.close();
    }
  }

  const blob = new Blob([html], { type: "text/html" });
  const blobUrl = URL.createObjectURL(blob);
  const printFrame = document.createElement("iframe");
  let cleanupTimerId = 0;
  let isCleanedUp = false;

  const cleanup = () => {
    if (isCleanedUp) {
      return;
    }

    isCleanedUp = true;
    window.clearTimeout(cleanupTimerId);
    URL.revokeObjectURL(blobUrl);

    if (printFrame.parentNode) {
      printFrame.parentNode.removeChild(printFrame);
    }
  };

  printFrame.className = "print-frame";
  printFrame.setAttribute("title", "Bella Boutique receipt print frame");
  printFrame.setAttribute("aria-hidden", "true");

  printFrame.onload = () => {
    const frameWindow = printFrame.contentWindow;

    if (!frameWindow) {
      cleanup();
      onFailure();
      return;
    }

    frameWindow.addEventListener("afterprint", cleanup, { once: true });

    cleanupTimerId = window.setTimeout(cleanup, 60000);

    window.setTimeout(() => {
      try {
        frameWindow.focus();
        frameWindow.print();
      } catch (error) {
        cleanup();
        onFailure();
      }
    }, 150);
  };

  printFrame.src = blobUrl;
  document.body.appendChild(printFrame);
}

export function viewHtmlDocument(html, onFailure = () => {}) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    onFailure();
    return;
  }

  const receiptWindow = window.open("", "_blank");

  if (!receiptWindow) {
    onFailure();
    return;
  }

  try {
    receiptWindow.opener = null;
    receiptWindow.document.open();
    receiptWindow.document.write(html);
    receiptWindow.document.close();
  } catch (error) {
    receiptWindow.close();
    onFailure();
  }
}

export async function downloadOrShareReceiptPdf(model, onFailure = () => {}) {
  printHtmlDocument(buildPrintableReceiptHtml(model), onFailure);

  return "print-to-pdf";
}

export async function buildReceiptPdfBlob(model) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("PDF generation is only available in the browser.");
  }

  const [{ jsPDF }, canvas] = await Promise.all([
    import("jspdf"),
    renderReceiptCanvas(model)
  ]);

  const pdf = new jsPDF({
    unit: "pt",
    format: "letter",
    orientation: "portrait"
  });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 30;
  const contentWidth = pageWidth - margin * 2;
  const contentHeight = pageHeight - margin * 2;
  const imageHeight = (canvas.height * contentWidth) / canvas.width;
  const imageData = canvas.toDataURL("image/png");
  let remainingHeight = imageHeight;
  let y = margin;

  pdf.addImage(imageData, "PNG", margin, y, contentWidth, imageHeight);
  remainingHeight -= contentHeight;

  while (remainingHeight > 0) {
    pdf.addPage();
    y = margin - (imageHeight - remainingHeight);
    pdf.addImage(imageData, "PNG", margin, y, contentWidth, imageHeight);
    remainingHeight -= contentHeight;
  }

  return pdf.output("blob");
}

export async function buildReceiptImageBlob(model) {
  const canvas = await renderReceiptCanvas(model);

  return canvasToBlob(canvas, "image/jpeg", 0.92);
}

export async function shareReceiptPdf(model, { phone = "" } = {}) {
  const pdfBlob = await buildReceiptPdfBlob(model);
  const filename = getReceiptFileName(model);
  const pdfFile =
    typeof File === "undefined"
      ? null
      : new File([pdfBlob], filename, { type: "application/pdf" });

  if (
    navigator.share &&
    pdfFile &&
    (!navigator.canShare || navigator.canShare({ files: [pdfFile] }))
  ) {
    await navigator.share({
      files: [pdfFile],
      title: `${model.brandName} receipt`
    });
    return "shared";
  }

  downloadBlob(pdfBlob, filename);

  const whatsappUrl = buildWhatsAppUrl(phone, "");

  if (whatsappUrl) {
    window.open(whatsappUrl, "_blank", "noopener,noreferrer");
    return "downloaded-opened-whatsapp";
  }

  return "downloaded";
}

export async function shareReceiptImage(model) {
  const imageBlob = await buildReceiptImageBlob(model);
  const filename = getReceiptImageFileName(model);
  const imageFile =
    typeof File === "undefined"
      ? null
      : new File([imageBlob], filename, { type: "image/jpeg" });

  if (
    navigator.share &&
    imageFile &&
    (!navigator.canShare || navigator.canShare({ files: [imageFile] }))
  ) {
    await navigator.share({
      files: [imageFile],
      title: `${model.brandName} receipt`
    });
    return "shared";
  }

  downloadBlob(imageBlob, filename);

  return "downloaded";
}

export async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "true");
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand("copy");
  textArea.remove();
}

export function buildWhatsAppUrl(phone, text) {
  const rawDigits = normalizePhone(phone);
  const digits = rawDigits.startsWith("00")
    ? rawDigits.slice(2)
    : rawDigits.startsWith("0") && rawDigits.length >= 9 && rawDigits.length <= 10
      ? `218${rawDigits.replace(/^0+/, "")}`
      : rawDigits;

  if (!digits) {
    return "";
  }

  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
