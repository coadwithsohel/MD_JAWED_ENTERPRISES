import PDFDocument from "pdfkit";

export interface InvoicePdfSaleItem {
  product: { name: string; sku: string; hsnCode?: string | null };
  quantity: number;
  unitPrice: string | number;
  discountAmount: string | number;
  gstPercent: string | number;
  gstAmount: string | number;
  lineTotal: string | number;
}

export interface InvoicePdfData {
  invoiceNumber: string;
  createdAt: Date | string;
  dueDate?: Date | string | null;
  customer?: {
    fullName: string;
    mobile: string;
    customerCode?: string;
    alternateMobile?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    pinCode?: string | null;
  } | null;
  createdBy: { fullName: string };
  saleItems: InvoicePdfSaleItem[];
  subtotal: string | number;
  discountAmount: string | number;
  gstAmount: string | number;
  grandTotal: string | number;
  paidAmount: string | number;
  pendingAmount: string | number;
  paymentStatus: string;
  saleType: string;
  notes?: string | null;
  payments?: Array<{
    amount: string | number;
    paymentMode: string;
    paymentDate: Date | string;
    referenceNumber?: string | null;
  }>;
}

export interface InvoicePdfSettings {
  businessName: string;
  tagline?: string | null;
  ownerName?: string | null;
  supportPhone?: string | null;
  supportEmail?: string | null;
  primaryAddress?: string | null;
  city?: string | null;
  state?: string | null;
  pinCode?: string | null;
  gstNumber?: string | null;
  termsAndConditions?: string | null;
}

function toNumber(value: string | number): number {
  return typeof value === "number" ? value : parseFloat(String(value));
}

function fmtCurrency(amount: string | number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(toNumber(amount));
}

function fmtDate(value: Date | string): string {
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

function fmtTime(value: Date | string): string {
  return new Date(value).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

/** Sanitize invoice number for safe Content-Disposition filenames. */
export function sanitizeInvoiceFilename(invoiceNumber: string): string {
  const safe = invoiceNumber
    .trim()
    .replace(/[^a-zA-Z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `invoice-${safe || "unknown"}.pdf`;
}

export function isValidInvoiceId(invoiceId: string): boolean {
  return /^[a-z0-9]{20,30}$/i.test(invoiceId);
}

export async function generateInvoicePdf(
  sale: InvoicePdfData,
  settings: InvoicePdfSettings | null,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const businessName = settings?.businessName ?? "MD JAVED ENTERPRISES";
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const left = doc.page.margins.left;
    let y = doc.page.margins.top;

    // Header
    doc.font("Helvetica-Bold").fontSize(20).fillColor("#0f172a");
    doc.text(businessName, left, y, { width: pageWidth * 0.6 });
    y = doc.y + 4;

    doc.font("Helvetica").fontSize(9).fillColor("#64748b");
    if (settings?.tagline) {
      doc.text(settings.tagline, left, y);
      y = doc.y + 2;
    }

    const addressParts = [
      settings?.primaryAddress,
      settings?.city,
      settings?.state,
      settings?.pinCode,
    ].filter(Boolean);
    if (addressParts.length > 0) {
      doc.text(addressParts.join(", "), left, y, { width: pageWidth * 0.6 });
      y = doc.y + 2;
    }

    if (settings?.supportPhone) {
      doc.text(`Phone: ${settings.supportPhone}`, left, y);
      y = doc.y + 2;
    }
    if (settings?.supportEmail) {
      doc.text(`Email: ${settings.supportEmail}`, left, y);
      y = doc.y + 2;
    }
    if (settings?.gstNumber) {
      doc.text(`GSTIN: ${settings.gstNumber}`, left, y);
    }

    const headerRightX = left + pageWidth * 0.55;
    doc.font("Helvetica-Bold").fontSize(18).fillColor("#2563eb");
    doc.text("INVOICE", headerRightX, doc.page.margins.top, {
      width: pageWidth * 0.45,
      align: "right",
    });

    doc.font("Helvetica-Bold").fontSize(14).fillColor("#0f172a");
    doc.text(sale.invoiceNumber, headerRightX, doc.page.margins.top + 24, {
      width: pageWidth * 0.45,
      align: "right",
    });

    doc.font("Helvetica").fontSize(9).fillColor("#64748b");
    doc.text(
      `${fmtDate(sale.createdAt)} at ${fmtTime(sale.createdAt)}`,
      headerRightX,
      doc.page.margins.top + 42,
      { width: pageWidth * 0.45, align: "right" },
    );

    doc.font("Helvetica-Bold").fontSize(9).fillColor("#0f172a");
    doc.text(`Status: ${sale.paymentStatus}`, headerRightX, doc.page.margins.top + 56, {
      width: pageWidth * 0.45,
      align: "right",
    });

    y = Math.max(doc.y, doc.page.margins.top + 78) + 16;
    doc
      .moveTo(left, y)
      .lineTo(left + pageWidth, y)
      .strokeColor("#e2e8f0")
      .stroke();
    y += 18;

    // Bill To / Sale details
    const colWidth = pageWidth / 2 - 8;
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#94a3b8");
    doc.text("BILL TO", left, y);
    doc.text("SALE DETAILS", left + colWidth + 16, y);
    y += 14;

    doc.font("Helvetica-Bold").fontSize(10).fillColor("#0f172a");
    if (sale.customer) {
      doc.text(sale.customer.fullName, left, y, { width: colWidth });
      let billY = doc.y + 2;
      doc.font("Helvetica").fontSize(9).fillColor("#64748b");
      if (sale.customer.customerCode) {
        doc.text(sale.customer.customerCode, left, billY, { width: colWidth });
        billY = doc.y + 2;
      }
      doc.text(`Mobile: ${sale.customer.mobile}`, left, billY, { width: colWidth });
      billY = doc.y + 2;
      if (sale.customer.alternateMobile) {
        doc.text(`Alt: ${sale.customer.alternateMobile}`, left, billY, {
          width: colWidth,
        });
        billY = doc.y + 2;
      }
      if (sale.customer.address) {
        doc.text(sale.customer.address, left, billY, { width: colWidth });
        billY = doc.y + 2;
      }
      const cityLine = [
        sale.customer.city,
        sale.customer.state,
        sale.customer.pinCode,
      ]
        .filter(Boolean)
        .join(", ");
      if (cityLine) {
        doc.text(cityLine, left, billY, { width: colWidth });
      }
    } else {
      doc.font("Helvetica-Oblique").fontSize(10).fillColor("#64748b");
      doc.text("Walk-in Customer", left, y, { width: colWidth });
    }

    const detailsX = left + colWidth + 16;
    let detailsY = y;
    const detailRow = (label: string, value: string, valueColor = "#0f172a") => {
      doc.font("Helvetica").fontSize(9).fillColor("#64748b");
      doc.text(label, detailsX, detailsY, { width: 80 });
      doc.font("Helvetica-Bold").fontSize(9).fillColor(valueColor);
      doc.text(value, detailsX + 82, detailsY, { width: colWidth - 82 });
      detailsY = doc.y + 4;
    };

    detailRow("Type", sale.saleType);
    detailRow("Date", fmtDate(sale.createdAt));
    if (sale.dueDate) {
      detailRow("Due Date", fmtDate(sale.dueDate), "#dc2626");
    }
    detailRow("Billed By", sale.createdBy.fullName);

    y = Math.max(doc.y, detailsY) + 18;

    // Items table
    const columns = [
      { label: "#", width: 24, align: "left" as const },
      { label: "Product", width: 150, align: "left" as const },
      { label: "HSN", width: 42, align: "left" as const },
      { label: "Qty", width: 32, align: "center" as const },
      { label: "Rate", width: 58, align: "right" as const },
      { label: "Disc.", width: 48, align: "right" as const },
      { label: "GST", width: 52, align: "right" as const },
      { label: "Total", width: 62, align: "right" as const },
    ];

    doc.rect(left, y, pageWidth, 18).fill("#f8fafc");
    let colX = left + 4;
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#64748b");
    for (const col of columns) {
      doc.text(col.label, colX, y + 5, {
        width: col.width - 4,
        align: col.align,
      });
      colX += col.width;
    }
    y += 22;

    doc.font("Helvetica").fontSize(8).fillColor("#0f172a");
    sale.saleItems.forEach((item, index) => {
      if (y > doc.page.height - 180) {
        doc.addPage();
        y = doc.page.margins.top;
      }

      const rowStartY = y;
      colX = left + 4;
      doc.text(String(index + 1), colX, y, { width: columns[0].width - 4 });
      colX += columns[0].width;

      doc.font("Helvetica-Bold").text(item.product.name, colX, y, {
        width: columns[1].width - 4,
      });
      const skuY = doc.y;
      doc.font("Helvetica").fontSize(7).fillColor("#94a3b8");
      doc.text(item.product.sku, colX, skuY, { width: columns[1].width - 4 });
      colX += columns[1].width;

      doc.font("Helvetica").fontSize(8).fillColor("#64748b");
      doc.text(item.product.hsnCode || "—", colX, rowStartY, {
        width: columns[2].width - 4,
      });
      colX += columns[2].width;

      doc.fillColor("#0f172a").text(String(item.quantity), colX, rowStartY, {
        width: columns[3].width - 4,
        align: "center",
      });
      colX += columns[3].width;

      doc.text(fmtCurrency(item.unitPrice), colX, rowStartY, {
        width: columns[4].width - 4,
        align: "right",
      });
      colX += columns[4].width;

      const itemDiscount = toNumber(item.discountAmount);
      doc.text(itemDiscount > 0 ? `−${fmtCurrency(item.discountAmount)}` : "—", colX, rowStartY, {
        width: columns[5].width - 4,
        align: "right",
      });
      colX += columns[5].width;

      doc.text(`${item.gstPercent}%`, colX, rowStartY, {
        width: columns[6].width - 4,
        align: "right",
      });
      doc.fontSize(7).fillColor("#94a3b8");
      doc.text(fmtCurrency(item.gstAmount), colX, rowStartY + 10, {
        width: columns[6].width - 4,
        align: "right",
      });
      colX += columns[6].width;

      doc.font("Helvetica-Bold").fontSize(8).fillColor("#0f172a");
      doc.text(fmtCurrency(item.lineTotal), colX, rowStartY, {
        width: columns[7].width - 4,
        align: "right",
      });

      y = Math.max(doc.y, rowStartY + 24) + 6;
      doc
        .moveTo(left, y - 2)
        .lineTo(left + pageWidth, y - 2)
        .strokeColor("#f1f5f9")
        .stroke();
    });

    y += 10;

    // Totals — values from database, no recalculation
    const totalsX = left + pageWidth - 210;
    const totalsWidth = 210;
    const totalRow = (label: string, value: string, opts?: { bold?: boolean; color?: string }) => {
      doc
        .font(opts?.bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(opts?.bold ? 11 : 9)
        .fillColor(opts?.color ?? "#64748b");
      doc.text(label, totalsX, y, { width: 90 });
      doc.text(value, totalsX + 92, y, { width: totalsWidth - 92, align: "right" });
      y += opts?.bold ? 18 : 14;
    };

    totalRow("Subtotal", fmtCurrency(sale.subtotal));
    if (toNumber(sale.discountAmount) > 0) {
      totalRow("Discount", `−${fmtCurrency(sale.discountAmount)}`, { color: "#16a34a" });
    }
    totalRow("GST", fmtCurrency(sale.gstAmount));
    doc
      .moveTo(totalsX, y)
      .lineTo(totalsX + totalsWidth, y)
      .strokeColor("#e2e8f0")
      .stroke();
    y += 8;
    totalRow("Grand Total", fmtCurrency(sale.grandTotal), {
      bold: true,
      color: "#2563eb",
    });
    totalRow("Amount Paid", fmtCurrency(sale.paidAmount), { color: "#15803d" });
    if (toNumber(sale.pendingAmount) > 0) {
      totalRow("Amount Due", fmtCurrency(sale.pendingAmount), {
        bold: true,
        color: "#dc2626",
      });
    }

    y += 8;

    // Payment history
    if (sale.payments && sale.payments.length > 0) {
      if (y > doc.page.height - 120) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#334155");
      doc.text("Payment History", left, y);
      y = doc.y + 8;

      for (const payment of sale.payments) {
        doc.font("Helvetica").fontSize(9).fillColor("#166534");
        const label = payment.referenceNumber
          ? `${payment.paymentMode} (${payment.referenceNumber})`
          : payment.paymentMode;
        doc.text(label, left, y, { width: pageWidth * 0.55 });
        doc.font("Helvetica-Bold").text(fmtCurrency(payment.amount), left, y, {
          width: pageWidth,
          align: "right",
        });
        doc.font("Helvetica").fontSize(8).fillColor("#16a34a");
        doc.text(fmtDate(payment.paymentDate), left, y + 12, {
          width: pageWidth,
          align: "right",
        });
        y += 28;
      }
    }

    // Footer
    if (y > doc.page.height - 100) {
      doc.addPage();
      y = doc.page.margins.top;
    }

    y += 10;
    doc
      .moveTo(left, y)
      .lineTo(left + pageWidth, y)
      .strokeColor("#e2e8f0")
      .stroke();
    y += 14;

    const footerLeftWidth = pageWidth * 0.58;
    if (settings?.termsAndConditions) {
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#64748b");
      doc.text("TERMS & CONDITIONS", left, y);
      y = doc.y + 4;
      doc.font("Helvetica").fontSize(8).fillColor("#94a3b8");
      doc.text(settings.termsAndConditions, left, y, { width: footerLeftWidth });
    }

    doc.font("Helvetica").fontSize(8).fillColor("#94a3b8");
    doc.text("Thank you for your business!", left, doc.y + 12, {
      width: footerLeftWidth,
    });

    doc.font("Helvetica").fontSize(8).fillColor("#94a3b8");
    doc.text("Authorized Signatory", left + footerLeftWidth + 16, y + 24, {
      width: pageWidth - footerLeftWidth - 16,
      align: "right",
    });
    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor("#334155")
      .text(businessName, left + footerLeftWidth + 16, y + 52, {
        width: pageWidth - footerLeftWidth - 16,
        align: "right",
      });

    if (sale.notes) {
      y = doc.y + 16;
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#64748b");
      doc.text("Notes", left, y);
      doc.font("Helvetica").fontSize(9).fillColor("#475569");
      doc.text(sale.notes, left, doc.y + 4, { width: pageWidth });
    }

    doc.end();
  });
}
