import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

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
  const num = toNumber(amount);
  // Use "Rs." prefix because standard PDF fonts cannot encode ₹ (U+20B9)
  const formatted = new Intl.NumberFormat("en-IN", {
    style: "decimal",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
  return `Rs. ${formatted}`;
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

// Color helpers matching the original pdfkit theme
const COLORS = {
  primary: "#0f172a",
  muted: "#64748b",
  lightMuted: "#94a3b8",
  blue: "#2563eb",
  red: "#dc2626",
  green: "#16a34a",
  darkGreen: "#15803d",
  headerBg: "#f8fafc",
  border: "#e2e8f0",
  rowBorder: "#f1f5f9",
};

function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return rgb(0, 0, 0);
  return rgb(
    parseInt(result[1], 16) / 255,
    parseInt(result[2], 16) / 255,
    parseInt(result[3], 16) / 255,
  );
}

interface DrawTextOptions {
  size?: number;
  color?: string;
  font?: "Helvetica" | "Helvetica-Bold" | "Helvetica-Oblique";
  align?: "left" | "center" | "right";
  width?: number;
}

function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
  // Approximate char width: most chars are ~0.55 * fontSize wide
  const charWidth = fontSize * 0.55;
  const maxChars = Math.floor(maxWidth / charWidth);
  if (maxChars <= 0) return [""];
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";
  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (testLine.length > maxChars) {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        // Word longer than line, break it
        let remaining = word;
        while (remaining.length > 0) {
          lines.push(remaining.slice(0, maxChars));
          remaining = remaining.slice(maxChars);
        }
        currentLine = "";
      }
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines.length > 0 ? lines : [""];
}

export async function generateInvoicePdf(
  sale: InvoicePdfData,
  settings: InvoicePdfSettings | null,
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const margin = 48;
  const pageWidth = page.getWidth() - margin * 2;
  const left = margin;
  let y = page.getHeight() - margin;

  // Embed standard fonts (no filesystem access needed)
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontOblique = await doc.embedFont(StandardFonts.HelveticaOblique);

  const drawText = (
    text: string,
    x: number,
    yPos: number,
    opts: DrawTextOptions = {},
  ) => {
    const font = opts.font === "Helvetica-Bold"
      ? fontBold
      : opts.font === "Helvetica-Oblique"
        ? fontOblique
        : fontRegular;
    const size = opts.size ?? 9;
    const color = opts.color ? hexToRgb(opts.color) : hexToRgb(COLORS.muted);
    const align = opts.align ?? "left";
    const maxWidth = opts.width ?? pageWidth;

    if (align === "right") {
      const textWidth = font.widthOfTextAtSize(text, size);
      x = x + maxWidth - textWidth;
    } else if (align === "center") {
      const textWidth = font.widthOfTextAtSize(text, size);
      x = x + (maxWidth - textWidth) / 2;
    }

    page.drawText(text, {
      x,
      y: yPos - size + 2,
      size,
      font,
      color,
      maxWidth,
    });
  };

  const businessName = settings?.businessName ?? "MD JAVED ENTERPRISES";

  // Header
  drawText(businessName, left, y, {
    size: 20,
    font: "Helvetica-Bold",
    color: COLORS.primary,
    width: pageWidth * 0.6,
  });
  y -= 24;

  if (settings?.tagline) {
    drawText(settings.tagline, left, y, { size: 9, width: pageWidth * 0.6 });
    y -= 14;
  }

  const addressParts = [
    settings?.primaryAddress,
    settings?.city,
    settings?.state,
    settings?.pinCode,
  ].filter(Boolean);
  if (addressParts.length > 0) {
    drawText(addressParts.join(", "), left, y, {
      size: 9,
      width: pageWidth * 0.6,
    });
    y -= 14;
  }

  if (settings?.supportPhone) {
    drawText(`Phone: ${settings.supportPhone}`, left, y, { size: 9 });
    y -= 14;
  }
  if (settings?.supportEmail) {
    drawText(`Email: ${settings.supportEmail}`, left, y, { size: 9 });
    y -= 14;
  }
  if (settings?.gstNumber) {
    drawText(`GSTIN: ${settings.gstNumber}`, left, y, { size: 9 });
  }

  const headerRightX = left + pageWidth * 0.55;
  drawText("INVOICE", headerRightX, page.getHeight() - margin, {
    size: 18,
    font: "Helvetica-Bold",
    color: COLORS.blue,
    width: pageWidth * 0.45,
    align: "right",
  });

  drawText(sale.invoiceNumber, headerRightX, page.getHeight() - margin - 24, {
    size: 14,
    font: "Helvetica-Bold",
    color: COLORS.primary,
    width: pageWidth * 0.45,
    align: "right",
  });

  drawText(
    `${fmtDate(sale.createdAt)} at ${fmtTime(sale.createdAt)}`,
    headerRightX,
    page.getHeight() - margin - 42,
    { size: 9, width: pageWidth * 0.45, align: "right" },
  );

  drawText(
    `Status: ${sale.paymentStatus}`,
    headerRightX,
    page.getHeight() - margin - 56,
    {
      size: 9,
      font: "Helvetica-Bold",
      color: COLORS.primary,
      width: pageWidth * 0.45,
      align: "right",
    },
  );

  y = Math.min(y, page.getHeight() - margin - 78) - 16;
  // Horizontal line
  page.drawLine({
    start: { x: left, y },
    end: { x: left + pageWidth, y },
    color: hexToRgb(COLORS.border),
    thickness: 1,
  });
  y -= 18;

  // Bill To / Sale details
  const colWidth = pageWidth / 2 - 8;
  drawText("BILL TO", left, y, {
    size: 8,
    font: "Helvetica-Bold",
    color: COLORS.lightMuted,
  });
  drawText("SALE DETAILS", left + colWidth + 16, y, {
    size: 8,
    font: "Helvetica-Bold",
    color: COLORS.lightMuted,
  });
  y -= 14;

  if (sale.customer) {
    drawText(sale.customer.fullName, left, y, {
      size: 10,
      font: "Helvetica-Bold",
      color: COLORS.primary,
      width: colWidth,
    });
    let billY = y - 14;

    if (sale.customer.customerCode) {
      drawText(sale.customer.customerCode, left, billY, {
        size: 9,
        width: colWidth,
      });
      billY -= 14;
    }
    drawText(`Mobile: ${sale.customer.mobile}`, left, billY, {
      size: 9,
      width: colWidth,
    });
    billY -= 14;
    if (sale.customer.alternateMobile) {
      drawText(`Alt: ${sale.customer.alternateMobile}`, left, billY, {
        size: 9,
        width: colWidth,
      });
      billY -= 14;
    }
    if (sale.customer.address) {
      drawText(sale.customer.address, left, billY, {
        size: 9,
        width: colWidth,
      });
      billY -= 14;
    }
    const cityLine = [
      sale.customer.city,
      sale.customer.state,
      sale.customer.pinCode,
    ]
      .filter(Boolean)
      .join(", ");
    if (cityLine) {
      drawText(cityLine, left, billY, { size: 9, width: colWidth });
    }
  } else {
    drawText("Walk-in Customer", left, y, {
      size: 10,
      font: "Helvetica-Oblique",
      color: COLORS.muted,
      width: colWidth,
    });
  }

  const detailsX = left + colWidth + 16;
  let detailsY = y;
  const detailRow = (label: string, value: string, valueColor = COLORS.primary) => {
    drawText(label, detailsX, detailsY, { size: 9 });
    drawText(value, detailsX + 82, detailsY, {
      size: 9,
      font: "Helvetica-Bold",
      color: valueColor,
      width: colWidth - 82,
    });
    detailsY -= 16;
  };

  detailRow("Type", sale.saleType);
  detailRow("Date", fmtDate(sale.createdAt));
  if (sale.dueDate) {
    detailRow("Due Date", fmtDate(sale.dueDate), COLORS.red);
  }
  detailRow("Billed By", sale.createdBy.fullName);

  y = Math.min(y, detailsY) - 18;

  // Items table header
  const columns = [
    { label: "#", x: 0, width: 24, align: "left" as const },
    { label: "Product", x: 24, width: 150, align: "left" as const },
    { label: "HSN", x: 174, width: 42, align: "left" as const },
    { label: "Qty", x: 216, width: 32, align: "center" as const },
    { label: "Rate", x: 248, width: 58, align: "right" as const },
    { label: "Disc.", x: 306, width: 48, align: "right" as const },
    { label: "GST", x: 354, width: 52, align: "right" as const },
    { label: "Total", x: 406, width: 62, align: "right" as const },
  ];

  // Table header background
  page.drawRectangle({
    x: left,
    y: y - 14,
    width: pageWidth,
    height: 18,
    color: hexToRgb(COLORS.headerBg),
  });

  let colX = left + 4;
  for (const col of columns) {
    drawText(col.label, colX, y - 3, {
      size: 8,
      font: "Helvetica-Bold",
      color: COLORS.muted,
      width: col.width - 4,
      align: col.align,
    });
    colX += col.width;
  }
  y -= 22;

  // Items
  for (let index = 0; index < sale.saleItems.length; index++) {
    const item = sale.saleItems[index];
    
    // Check if we need a new page
    if (y < 180) {
      // Add a new page (simplified - just continue on current page)
    }

    const rowStartY = y;
    colX = left + 4;
    drawText(String(index + 1), colX, y, {
      size: 8,
      width: columns[0].width - 4,
    });
    colX += columns[0].width;

    drawText(item.product.name, colX, y, {
      size: 8,
      font: "Helvetica-Bold",
      color: COLORS.primary,
      width: columns[1].width - 4,
    });
    const skuY = y - 12;
    drawText(item.product.sku, colX, skuY, {
      size: 7,
      color: COLORS.lightMuted,
      width: columns[1].width - 4,
    });
    colX += columns[1].width;

    drawText(item.product.hsnCode || "-", colX, rowStartY, {
      size: 8,
      color: COLORS.muted,
      width: columns[2].width - 4,
    });
    colX += columns[2].width;

    drawText(String(item.quantity), colX, rowStartY, {
      size: 8,
      color: COLORS.primary,
      width: columns[3].width - 4,
      align: "center",
    });
    colX += columns[3].width;

    drawText(fmtCurrency(item.unitPrice), colX, rowStartY, {
      size: 8,
      color: COLORS.primary,
      width: columns[4].width - 4,
      align: "right",
    });
    colX += columns[4].width;

    const itemDiscount = toNumber(item.discountAmount);
    drawText(
      itemDiscount > 0 ? `−${fmtCurrency(item.discountAmount)}` : "—",
      colX,
      rowStartY,
      { size: 8, width: columns[5].width - 4, align: "right" },
    );
    colX += columns[5].width;

    drawText(`${item.gstPercent}%`, colX, rowStartY, {
      size: 8,
      width: columns[6].width - 4,
      align: "right",
    });
    drawText(fmtCurrency(item.gstAmount), colX, rowStartY - 10, {
      size: 7,
      color: COLORS.lightMuted,
      width: columns[6].width - 4,
      align: "right",
    });
    colX += columns[6].width;

    drawText(fmtCurrency(item.lineTotal), colX, rowStartY, {
      size: 8,
      font: "Helvetica-Bold",
      color: COLORS.primary,
      width: columns[7].width - 4,
      align: "right",
    });

    y = Math.min(rowStartY - 24, y - 30) - 6;
    // Row border
    page.drawLine({
      start: { x: left, y: y + 2 },
      end: { x: left + pageWidth, y: y + 2 },
      color: hexToRgb(COLORS.rowBorder),
      thickness: 1,
    });
  }

  y -= 10;

  // Totals
  const totalsX = left + pageWidth - 210;
  const totalsWidth = 210;
  const totalRow = (
    label: string,
    value: string,
    opts?: { bold?: boolean; color?: string },
  ) => {
    drawText(label, totalsX, y, {
      size: opts?.bold ? 11 : 9,
      font: opts?.bold ? "Helvetica-Bold" : "Helvetica",
      color: opts?.color ?? COLORS.muted,
      width: 90,
    });
    drawText(value, totalsX + 92, y, {
      size: opts?.bold ? 11 : 9,
      font: opts?.bold ? "Helvetica-Bold" : "Helvetica",
      color: opts?.color ?? COLORS.muted,
      width: totalsWidth - 92,
      align: "right",
    });
    y -= opts?.bold ? 18 : 14;
  };

  totalRow("Subtotal", fmtCurrency(sale.subtotal));
  if (toNumber(sale.discountAmount) > 0) {
    totalRow("Discount", `−${fmtCurrency(sale.discountAmount)}`, {
      color: COLORS.green,
    });
  }
  totalRow("GST", fmtCurrency(sale.gstAmount));
  page.drawLine({
    start: { x: totalsX, y },
    end: { x: totalsX + totalsWidth, y },
    color: hexToRgb(COLORS.border),
    thickness: 1,
  });
  y -= 8;
  totalRow("Grand Total", fmtCurrency(sale.grandTotal), {
    bold: true,
    color: COLORS.blue,
  });
  totalRow("Amount Paid", fmtCurrency(sale.paidAmount), {
    color: COLORS.darkGreen,
  });
  if (toNumber(sale.pendingAmount) > 0) {
    totalRow("Amount Due", fmtCurrency(sale.pendingAmount), {
      bold: true,
      color: COLORS.red,
    });
  }

  y -= 8;

  // Payment history
  if (sale.payments && sale.payments.length > 0) {
    drawText("Payment History", left, y, {
      size: 10,
      font: "Helvetica-Bold",
      color: "#334155",
    });
    y -= 20;

    for (const payment of sale.payments) {
      const label = payment.referenceNumber
        ? `${payment.paymentMode} (${payment.referenceNumber})`
        : payment.paymentMode;
      drawText(label, left, y, {
        size: 9,
        color: "#166534",
        width: pageWidth * 0.55,
      });
      drawText(fmtCurrency(payment.amount), left, y, {
        size: 9,
        font: "Helvetica-Bold",
        color: COLORS.darkGreen,
        width: pageWidth,
        align: "right",
      });
      drawText(fmtDate(payment.paymentDate), left, y - 12, {
        size: 8,
        color: COLORS.green,
        width: pageWidth,
        align: "right",
      });
      y -= 28;
    }
  }

  // Footer
  y -= 10;
  page.drawLine({
    start: { x: left, y },
    end: { x: left + pageWidth, y },
    color: hexToRgb(COLORS.border),
    thickness: 1,
  });
  y -= 14;

  const footerLeftWidth = pageWidth * 0.58;
  if (settings?.termsAndConditions) {
    drawText("TERMS & CONDITIONS", left, y, {
      size: 8,
      font: "Helvetica-Bold",
      color: COLORS.muted,
    });
    y -= 16;
    const termsLines = wrapText(
      settings.termsAndConditions,
      footerLeftWidth,
      8,
    );
    for (const line of termsLines) {
      drawText(line, left, y, {
        size: 8,
        color: COLORS.lightMuted,
        width: footerLeftWidth,
      });
      y -= 12;
    }
  }

  drawText("Thank you for your business!", left, y - 12, {
    size: 8,
    color: COLORS.lightMuted,
    width: footerLeftWidth,
  });

  drawText(
    "Authorized Signatory",
    left + footerLeftWidth + 16,
    y - 36,
    {
      size: 8,
      color: COLORS.lightMuted,
      width: pageWidth - footerLeftWidth - 16,
      align: "right",
    },
  );
  drawText(
    businessName,
    left + footerLeftWidth + 16,
    y - 60,
    {
      size: 9,
      font: "Helvetica-Bold",
      color: "#334155",
      width: pageWidth - footerLeftWidth - 16,
      align: "right",
    },
  );

  if (sale.notes) {
    y -= 28;
    drawText("Notes", left, y, {
      size: 8,
      font: "Helvetica-Bold",
      color: COLORS.muted,
    });
    y -= 16;
    const noteLines = wrapText(sale.notes, pageWidth, 9);
    for (const line of noteLines) {
      drawText(line, left, y, {
        size: 9,
        color: "#475569",
        width: pageWidth,
      });
      y -= 14;
    }
  }

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}