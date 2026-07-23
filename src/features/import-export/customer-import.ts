// ─── Customer Import Service ──────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { parseCsv, getCellValue } from "./csv-parser";
import { requireAmount, parseSignedAmount, parseCreditLimit, normalizeMobile, isValidIndianMobile } from "./amount-parser";
import type { CustomerImportRow, CustomerImportValidation, PreviewRow, MatchStatus, DuplicateStatus, ImportRowStatus } from "./types";
import { ValidationError, AuthError } from "./errors";

const CUSTOMER_REQUIRED_HEADERS = ["name", "mobile"];
const CUSTOMER_OPTIONAL_HEADERS = ["alternate mobile", "email", "city", "state", "address", "credit limit", "opening balance"];

interface CustomerPreviewRow {
  rowNumber: number;
  name: string;
  mobile: string;
  alternateMobile?: string | null;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  address?: string | null;
  creditLimit: number;
  openingBalance: number;
  validationStatus: ImportRowStatus;
  validationErrors: string[];
  duplicateInFile: boolean;
  duplicateInDb: boolean;
  existingCustomerId?: string;
}

/**
 * Parse and validate a customer CSV file.
 * Returns preview rows ready for review.
 */
export async function previewCustomerImport(
  fileContent: string,
  fileName: string,
  userId: string,
): Promise<{
  batchId: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  rows: CustomerPreviewRow[];
}> {
  // Verify user exists
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isActive: true },
  });
  if (!user || !user.isActive) {
    throw new AuthError("Your session is no longer valid. Please sign in again.");
  }

  // Parse CSV
  const requiredHeaders = ["name", "mobile"];
  const parsed = parseCsv(fileContent, requiredHeaders);

  // Get all existing customers for duplicate detection
  const existingCustomers = await prisma.customer.findMany({
    select: { id: true, mobile: true, normalizedMobile: true, fullName: true },
  });
  const existingMobileSet = new Set<string>();
  const existingNormalizedSet = new Set<string>();
  for (const c of existingCustomers) {
    if (c.mobile) existingMobileSet.add(c.mobile);
    if (c.normalizedMobile) existingNormalizedSet.add(c.normalizedMobile);
  }

  // Create import batch
  const batch = await prisma.customerImportBatch.create({
    data: {
      originalFileName: fileName,
      importedById: userId,
      status: "UPLOADED",
      totalRows: parsed.rows.length,
    },
  });

  // Process each row
  const rows: CustomerPreviewRow[] = [];
  let validCount = 0;
  let invalidCount = 0;
  const seenMobiles = new Set<string>();

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i];
    const rowNumber = i + 2; // 1-based, +2 because header is row 1
    const errors: string[] = [];

    const name = getCellValue(row, ["Name", "Full Name", "Customer Name"]);
    const mobile = getCellValue(row, ["Mobile", "Phone", "Contact", "Mobile No"]);
    const alternateMobile = getCellValue(row, ["Alternate Mobile", "Alt Mobile", "Alternate Phone"]);
    const email = getCellValue(row, ["Email", "Email Address"]);
    const city = getCellValue(row, ["City", "Town"]);
    const state = getCellValue(row, ["State"]);
    const address = getCellValue(row, ["Address", "Full Address"]);
    const creditLimitRaw = getCellValue(row, ["Credit Limit", "Limit"]);
    const openingBalanceRaw = getCellValue(row, ["Opening Balance", "Balance", "Dues"]);

    // Validate name
    if (!name) errors.push("Name is required");

    // Validate mobile
    let normalizedMobile: string | null = null;
    if (!mobile) {
      errors.push("Mobile is required");
    } else {
      normalizedMobile = normalizeMobile(mobile);
      if (!normalizedMobile || !isValidIndianMobile(mobile)) {
        errors.push("Invalid Indian mobile number");
      }
    }

    // Validate amounts
    let creditLimit = 0;
    let openingBalance = 0;

    if (creditLimitRaw) {
      const limitResult = parseCreditLimit(creditLimitRaw);
      if (limitResult.isValid && limitResult.value !== null) {
        creditLimit = limitResult.value;
      } else {
        errors.push(limitResult.error || "Invalid credit limit");
      }
    }

    if (openingBalanceRaw) {
      const balanceResult = parseSignedAmount(openingBalanceRaw);
      if (balanceResult.isValid && balanceResult.value !== null) {
        openingBalance = balanceResult.value;
      } else {
        errors.push(balanceResult.error || "Invalid opening balance");
      }
    }

    // Check duplicate in file
    let duplicateInFile = false;
    if (normalizedMobile) {
      if (seenMobiles.has(normalizedMobile)) {
        duplicateInFile = true;
        errors.push("Duplicate mobile within the same file");
      }
      seenMobiles.add(normalizedMobile);
    }

    // Check duplicate in database
    let duplicateInDb = false;
    let existingCustomerId: string | undefined;
    if (normalizedMobile) {
      const dbCustomer = existingCustomers.find(
        (c) => c.mobile === mobile || c.mobile === normalizedMobile || c.normalizedMobile === normalizedMobile,
      );
      if (dbCustomer) {
        duplicateInDb = true;
        existingCustomerId = dbCustomer.id;
        errors.push("Mobile number already exists in database");
      }
    }

    const validationStatus: ImportRowStatus = errors.length === 0 ? "VALID" : "INVALID";
    if (validationStatus === "VALID") validCount++;
    else invalidCount++;

    // Store staged row
    await prisma.customerImportRow.create({
      data: {
        importBatchId: batch.id,
        rowNumber,
        rawData: row as Prisma.JsonObject,
        normalizedData: {
          name,
          mobile,
          normalizedMobile,
          alternateMobile: alternateMobile || null,
          email: email || null,
          city: city || null,
          state: state || null,
          address: address || null,
          creditLimit,
          openingBalance,
        } as Prisma.JsonObject,
        resultStatus: validationStatus,
        errorMessage: errors.length > 0 ? errors.join("; ") : null,
      },
    });

    rows.push({
      rowNumber,
      name: name || "",
      mobile: mobile || "",
      alternateMobile: alternateMobile || null,
      email: email || null,
      city: city || null,
      state: state || null,
      address: address || null,
      creditLimit,
      openingBalance,
      validationStatus,
      validationErrors: errors,
      duplicateInFile,
      duplicateInDb,
      existingCustomerId,
    });
  }

  // Update batch with counts
  await prisma.customerImportBatch.update({
    where: { id: batch.id },
    data: {
      totalRows: parsed.rows.length,
      validRows: validCount,
      status: validCount > 0 ? "READY" : "FAILED",
      errorSummary: invalidCount > 0 ? { invalidRows: invalidCount } : Prisma.JsonNull,
    },
  });

  return {
    batchId: batch.id,
    totalRows: parsed.rows.length,
    validRows: validCount,
    invalidRows: invalidCount,
    rows,
  };
}

/**
 * Commit a customer import batch.
 * Creates customers in chunks of 50.
 */
export async function commitCustomerImport(
  batchId: string,
  userId: string,
): Promise<{
  batchId: string;
  totalRows: number;
  importedRows: number;
  skippedDuplicates: number;
  skippedInvalid: number;
  failedRows: number;
  status: string;
}> {
  // Verify user
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isActive: true },
  });
  if (!user || !user.isActive) {
    throw new AuthError("Your session is no longer valid. Please sign in again.");
  }

  // Load batch
  const batch = await prisma.customerImportBatch.findUnique({
    where: { id: batchId },
    include: {
      rows: {
        where: {
          resultStatus: { in: ["VALID", "PARSED"] },
        },
        orderBy: { rowNumber: "asc" },
      },
    },
  });

  if (!batch) {
    throw new ValidationError(`Import batch not found: ${batchId}`);
  }

  if (batch.status === "COMPLETED" || batch.status === "IMPORTING") {
    throw new ValidationError(`Batch ${batchId} has already been processed.`);
  }

  // Mark batch as importing
  await prisma.customerImportBatch.update({
    where: { id: batchId },
    data: { status: "IMPORTING" },
  });

  const stagedRows = batch.rows;
  let importedRows = 0;
  let skippedDuplicates = 0;
  let skippedInvalid = 0;
  let failedRows = 0;

  // Process in chunks of 50
  const CHUNK_SIZE = 50;
  for (let i = 0; i < stagedRows.length; i += CHUNK_SIZE) {
    const chunk = stagedRows.slice(i, i + CHUNK_SIZE);

    for (const stagedRow of chunk) {
      try {
        const normalizedData = stagedRow.normalizedData as Record<string, unknown> | null;
        if (!normalizedData) {
          await prisma.customerImportRow.update({
            where: { id: stagedRow.id },
            data: { resultStatus: "FAILED", errorMessage: "No normalized data" },
          });
          failedRows++;
          continue;
        }

        const name = String(normalizedData.name || "");
        const mobile = String(normalizedData.mobile || "");
        const normalizedMobileStr = normalizedData.normalizedMobile ? String(normalizedData.normalizedMobile) : null;
        const alternateMobile = normalizedData.alternateMobile ? String(normalizedData.alternateMobile) : null;
        const email = normalizedData.email ? String(normalizedData.email) : null;
        const city = normalizedData.city ? String(normalizedData.city) : null;
        const state = normalizedData.state ? String(normalizedData.state) : null;
        const address = normalizedData.address ? String(normalizedData.address) : null;
        const creditLimit = Number(normalizedData.creditLimit) || 0;
        const openingBalance = Number(normalizedData.openingBalance) || 0;

        if (!name || !mobile) {
          await prisma.customerImportRow.update({
            where: { id: stagedRow.id },
            data: { resultStatus: "SKIPPED", errorMessage: "Missing required fields" },
          });
          skippedInvalid++;
          continue;
        }

        // Double-check duplicate
        const existing = await prisma.customer.findFirst({
          where: {
            OR: [
              { mobile },
              ...(normalizedMobileStr ? [{ normalizedMobile: normalizedMobileStr }] : []),
              ...(normalizedMobileStr ? [{ mobile: normalizedMobileStr }] : []),
            ],
          },
          select: { id: true },
        });

        if (existing) {
          await prisma.customerImportRow.update({
            where: { id: stagedRow.id },
            data: {
              resultStatus: "SKIPPED",
              customerId: existing.id,
              errorMessage: "Duplicate mobile",
            },
          });
          skippedDuplicates++;
          continue;
        }

        // Generate customer code
        const counter = await prisma.customerCounter.upsert({
          where: { id: "singleton" },
          create: { id: "singleton", current: 1, prefix: "MJE-CUST" },
          update: { current: { increment: 1 } },
        });
        const padded = String(counter.current).padStart(6, "0");
        const customerCode = `${counter.prefix}-${padded}`;

        // Create customer
        const created = await prisma.customer.create({
          data: {
            customerCode,
            fullName: name,
            mobile,
            normalizedMobile: normalizedMobileStr,
            alternateMobile,
            email,
            city,
            state,
            address,
            creditLimit,
            openingBalance,
            currentBalance: openingBalance,
            isActive: true,
          },
          select: { id: true, customerCode: true },
        });

        // Update staged row
        await prisma.customerImportRow.update({
          where: { id: stagedRow.id },
          data: {
            resultStatus: "IMPORTED",
            customerId: created.id,
          },
        });

        // Audit log (non-fatal)
        try {
          await prisma.auditLog.create({
            data: {
              userId,
              action: "CREATE",
              entityType: "Customer",
              entityId: created.id,
              newData: {
                source: "CSV_IMPORT",
                customerCode: created.customerCode,
                fullName: name,
                mobile,
              },
            },
          });
        } catch {
          // Non-critical
        }

        importedRows++;
      } catch (err) {
        await prisma.customerImportRow.update({
          where: { id: stagedRow.id },
          data: {
            resultStatus: "FAILED",
            errorMessage: err instanceof Error ? err.message : "Unknown error",
          },
        });
        failedRows++;
      }
    }
  }

  // Update batch
  const status = failedRows > 0 ? "PARTIALLY_COMPLETED" : "COMPLETED";
  await prisma.customerImportBatch.update({
    where: { id: batchId },
    data: {
      status,
      importedRows,
      skippedRows: skippedDuplicates + skippedInvalid,
      failedRows,
      completedAt: new Date(),
      errorSummary: failedRows > 0 ? { failedRows } : Prisma.JsonNull,
    },
  });

  return {
    batchId,
    totalRows: stagedRows.length + skippedInvalid + skippedDuplicates + failedRows,
    importedRows,
    skippedDuplicates,
    skippedInvalid,
    failedRows,
    status,
  };
}