import { NextRequest, NextResponse } from "next/server";
import { requireAuth, clearAuthCookie } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { parseCsv, getCellValue } from "@/features/import-export/csv-parser";
import { parseSignedAmount, parseCreditLimit, normalizeMobile, isValidIndianMobile } from "@/features/import-export/amount-parser";

export async function POST(req: NextRequest) {
  const { auth, error } = await requireAuth(req);
  if (error) return error;

  let rawContent = "";

  try {
    // Handle both JSON and FormData
    const contentType = req.headers.get("content-type") || "";
    let rows: Record<string, string>[] = [];

    if (contentType.includes("json")) {
      const body = await req.json();
      const customers = body.customers || [];
      if (!Array.isArray(customers) || customers.length === 0) {
        return NextResponse.json(
          { error: "At least one customer is required" },
          { status: 400 },
        );
      }
      rows = customers.map((c: Record<string, unknown>, i: number) => ({
        "Name": String(c.fullName || c.name || ""),
        "Mobile": String(c.mobile || ""),
        "Alternate Mobile": String(c.alternateMobile || ""),
        "Email": String(c.email || ""),
        "City": String(c.city || ""),
        "State": String(c.state || ""),
        "Address": String(c.address || ""),
        "Credit Limit": String(c.creditLimit ?? ""),
        "Opening Balance": String(c.openingBalance ?? ""),
      }));
    } else {
      // FormData with file
      const formData = await req.formData();
      const file = formData.get("file");
      if (!file || !(file instanceof File)) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      }
      rawContent = await file.text();
      const parsed = parseCsv(rawContent, ["name", "mobile"]);
      rows = parsed.rows;
    }

    // Verify user
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { id: true, isActive: true },
    });
    if (!user || !user.isActive) {
      const res = NextResponse.json(
        { error: "SESSION_USER_NOT_FOUND", message: "Your session is no longer valid. Please sign in again." },
        { status: 401 },
      );
      clearAuthCookie(res);
      return res;
    }

    // Get existing customers for duplicate detection
    const existingCustomers = await prisma.customer.findMany({
      select: { id: true, mobile: true, normalizedMobile: true },
    });
    const existingSet = new Set<string>();
    for (const c of existingCustomers) {
      if (c.mobile) existingSet.add(c.mobile);
      if (c.normalizedMobile) existingSet.add(c.normalizedMobile);
    }

    const results = {
      created: 0,
      skipped: 0,
      failed: 0,
      errors: [] as { row: number; error: string }[],
    };

    const seenMobiles = new Set<string>();
    const CHUNK_SIZE = 50;

    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);

      for (let j = 0; j < chunk.length; j++) {
        const row = chunk[j];
        const rowNumber = i + j + 2;

        try {
          const name = getCellValue(row, ["Name", "Full Name", "Customer Name"]).trim();
          const mobile = getCellValue(row, ["Mobile", "Phone"]).trim();
          const alternateMobile = getCellValue(row, ["Alternate Mobile", "Alt Mobile"]).trim();
          const email = getCellValue(row, ["Email", "Email Address"]).trim();
          const city = getCellValue(row, ["City", "Town"]).trim();
          const state = getCellValue(row, ["State"]).trim();
          const address = getCellValue(row, ["Address", "Full Address"]).trim();
          const creditLimitRaw = getCellValue(row, ["Credit Limit", "Limit"]).trim();
          const openingBalanceRaw = getCellValue(row, ["Opening Balance", "Balance", "Dues"]).trim();

          if (!name || !mobile) {
            results.skipped++;
            results.errors.push({ row: rowNumber, error: "Name and Mobile are required" });
            continue;
          }

          const normalizedMobile = normalizeMobile(mobile);
          if (!normalizedMobile || !isValidIndianMobile(mobile)) {
            results.skipped++;
            results.errors.push({ row: rowNumber, error: `Invalid Indian mobile number: ${mobile}` });
            continue;
          }

          // Check duplicate in file
          if (seenMobiles.has(normalizedMobile)) {
            results.skipped++;
            results.errors.push({ row: rowNumber, error: `Duplicate mobile "${mobile}" within the same file` });
            continue;
          }
          seenMobiles.add(normalizedMobile);

          // Parse amounts
          const parsedCreditLimit = creditLimitRaw ? parseCreditLimit(creditLimitRaw) : null;
          const creditLimit = (parsedCreditLimit?.isValid && parsedCreditLimit.value !== null) ? parsedCreditLimit.value : 0;

          const parsedBalance = openingBalanceRaw ? parseSignedAmount(openingBalanceRaw) : null;
          const openingBalance = (parsedBalance?.isValid && parsedBalance.value !== null) ? parsedBalance.value : 0;

          // Create customer in its own db operation
          try {
            // Check duplicate in DB
            const existing = await prisma.customer.findFirst({
              where: {
                OR: [
                  { mobile },
                  { normalizedMobile },
                ],
              },
              select: { id: true },
            });

            if (existing) {
              results.skipped++;
              results.errors.push({ row: rowNumber, error: `Mobile "${mobile}" already exists` });
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

            await prisma.customer.create({
              data: {
                customerCode,
                fullName: name,
                mobile,
                normalizedMobile,
                alternateMobile: alternateMobile || null,
                email: email || null,
                city: city || null,
                state: state || null,
                address: address || null,
                creditLimit,
                openingBalance,
                currentBalance: openingBalance,
                isActive: true,
              },
            });

            results.created++;

            // Audit log (non-fatal)
            try {
              await prisma.auditLog.create({
                data: {
                  userId: auth.userId,
                  action: "CREATE",
                  entityType: "Customer",
                  entityId: customerCode,
                  newData: { source: "CSV_IMPORT", name, mobile, customerCode },
                },
              });
            } catch { /* non-critical */ }
          } catch (err) {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
              results.skipped++;
              results.errors.push({ row: rowNumber, error: `Duplicate mobile "${mobile}"` });
            } else {
              throw err;
            }
          }
        } catch (err) {
          results.failed++;
          results.errors.push({
            row: rowNumber,
            error: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }
    }

    return NextResponse.json(results, { status: 200 });
  } catch (err) {
    console.error("[POST /api/customers/import]", err);
    return NextResponse.json(
      { error: "Server error during bulk import" },
      { status: 500 },
    );
  }
}