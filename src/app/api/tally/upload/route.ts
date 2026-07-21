import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import {
  parseTallyCsv,
  parseTallyXml,
  type TallyVoucherInput,
  validateTransactionCsvHeaders,
  validateVouchers,
} from "@/lib/tally-xml-parser";
import { Prisma } from "@prisma/client";

export async function POST(req: NextRequest) {
  const { auth, error } = await requireAuth(req);
  if (error) return error;

  let rawContent = "";
  let sourceFileName = "tally-import.csv";
  let fileSize = 0;
  const contentType = req.headers.get("content-type") || "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file");
      if (!file || !(file instanceof File)) {
        return NextResponse.json(
          {
            error: "No file provided",
            details: "Upload a CSV or XML transaction file",
          },
          { status: 400 },
        );
      }
      sourceFileName = file.name || sourceFileName;
      fileSize = file.size;
      rawContent = await file.text();
    } else {
      const body = await req.json().catch(() => ({}));
      rawContent = body.xml || body.content || "";
      sourceFileName = body.sourceFileName || sourceFileName;
    }

    if (!rawContent || rawContent.trim().length === 0) {
      return NextResponse.json(
        {
          error: "Empty file content",
          details: "The uploaded file did not contain any data",
        },
        { status: 400 },
      );
    }

    const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
    if (fileSize > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          error: "File too large",
          details: "Please upload a file smaller than 10MB",
        },
        { status: 413 },
      );
    }

    const isCsvUpload =
      /\.csv$/i.test(sourceFileName) ||
      !rawContent.trim().startsWith("<") ||
      contentType.includes("csv");

    let vouchers: TallyVoucherInput[] = [];
    let csvValidationError: string | null = null;

    if (isCsvUpload) {
      const csvHeaders =
        rawContent
          .split(/\r?\n/)
          .find((line) => line.trim().length > 0)
          ?.split(",")
          .map((header) => header.trim()) || [];
      const csvHeaderValidation = validateTransactionCsvHeaders(csvHeaders);
      if (!csvHeaderValidation.isValid) {
        csvValidationError = `CSV headers are invalid. Missing required columns: ${csvHeaderValidation.missing.join(", ")}`;
      } else {
        vouchers = parseTallyCsv(rawContent, sourceFileName);
      }
    } else {
      vouchers = parseTallyXml(rawContent, sourceFileName);
    }

    if (csvValidationError) {
      return NextResponse.json(
        {
          error: "Unsupported transaction file format",
          details: csvValidationError,
        },
        { status: 422 },
      );
    }

    if (vouchers.length === 0) {
      return NextResponse.json(
        {
          error: "No transaction rows found",
          details:
            "The uploaded file did not contain any parseable transactions.",
        },
        { status: 422 },
      );
    }

    const { valid, invalid, summary } = validateVouchers(vouchers);
    if (!valid.length) {
      return NextResponse.json(
        {
          error: "No valid rows to import",
          details:
            "The CSV rows were missing required values or contained invalid amounts.",
        },
        { status: 422 },
      );
    }
    const batch = await prisma.tallyImportBatch.create({
      data: {
        originalFileName: sourceFileName,
        storedFileName: sourceFileName,
        importedById: auth.userId,
        status: "UPLOADED",
      },
    });

    const rows = valid.map((voucher) => ({
      importBatchId: batch.id,
      customerName: voucher.customerName,
      mobile: voucher.mobile || null,
      matchedCustomerId: null,
      matchedCustomerName: null,
      voucherDate: new Date(`${voucher.voucherDate}T00:00:00.000Z`),
      voucherType: voucher.voucherType,
      voucherNumber: voucher.voucherNumber || null,
      debit: voucher.debit || 0,
      credit: voucher.credit || 0,
      narration: voucher.narration || null,
      reference: voucher.reference || null,
      tallyGuid: voucher.tallyGuid || null,
      tallyRemoteId: voucher.tallyRemoteId || null,
      tallyMasterId: voucher.tallyMasterId || null,
      voucherKey: voucher.voucherKey || null,
      sourceFileName: voucher.sourceFileName || sourceFileName,
      importStatus: "PARSED" as Prisma.ImportRowStatus,
    }));

    await prisma.tallyVoucher.createMany({ data: rows });

    console.info("[tally/upload] uploaded", {
      fileName: sourceFileName,
      batchId: batch.id,
      rowCount: valid.length,
      invalidCount: invalid.length,
    });

    return NextResponse.json({
      ok: true,
      batchId: batch.id,
      fileName: sourceFileName,
      status: "PARSED",
      summary,
      totalRows: vouchers.length,
      validRows: valid.length,
      invalidRows: invalid.length,
      matchedRows: valid.length,
      unmatchedRows: invalid.length,
      duplicateRows: 0,
      totalVouchers: valid.length,
      invalidCount: invalid.length,
      dateRange: {
        from: valid[0]?.voucherDate ?? null,
        to: valid[valid.length - 1]?.voucherDate ?? null,
      },
    });
  } catch (err) {
    console.error("Transaction import failed", {
      fileName: sourceFileName,
      fileType: contentType || "unknown",
      fileSize,
      stage: "upload",
      message: err instanceof Error ? err.message : "Unknown error",
    });
    return NextResponse.json(
      {
        error: "Failed to process transaction file",
        details:
          "The server could not process the transaction upload. Please verify the file format and try again.",
      },
      { status: 500 },
    );
  }
}
