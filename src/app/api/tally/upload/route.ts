import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { parseTallyXml, validateVouchers } from '@/lib/tally-xml-parser';

/**
 * POST /api/tally/upload
 *
 * Accepts a Tally XML file upload.
 * Parses the XML, validates vouchers, matches customers, and returns preview data.
 * Does NOT import anything — use /api/tally/import to import.
 *
 * Body: FormData with field 'file' containing the Tally XML
 * Alternative: JSON with { xml: string, sourceFileName?: string }
 */
export async function POST(req: NextRequest) {
  const { auth, error } = await requireAuth(req);
  if (error) return error;

  try {
    let xmlContent: string;
    let sourceFileName = 'tally-export.xml';

    // Check content type
    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      // Form data upload
      const formData = await req.formData();
      const file = formData.get('file');
      if (!file || !(file instanceof File)) {
        return NextResponse.json({ error: 'No file provided' }, { status: 400 });
      }
      sourceFileName = file.name || 'tally-export.xml';
      xmlContent = await file.text();
    } else {
      // JSON upload { xml, sourceFileName }
      const body = await req.json();
      xmlContent = body.xml;
      sourceFileName = body.sourceFileName || 'tally-export.xml';
    }

    if (!xmlContent || xmlContent.trim().length === 0) {
      return NextResponse.json({ error: 'Empty XML content' }, { status: 400 });
    }

    // Parse XML
    const vouchers = parseTallyXml(xmlContent, sourceFileName);

    if (vouchers.length === 0) {
      return NextResponse.json({
        error: 'No vouchers found in the XML. Please check the file format.',
        details: 'Ensure the XML contains valid Tally VOUCHER blocks with party ledger entries.',
      }, { status: 422 });
    }

    // Validate
    const { valid, invalid, summary } = validateVouchers(vouchers);

    // Get all customers for matching
    const allCustomers = await prisma.customer.findMany({
      select: { id: true, fullName: true, customerCode: true, mobile: true },
    });

    function normalizeName(name: string): string {
      return name.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
    }

    const nameIndex = new Map<string, typeof allCustomers[number]>();
    for (const c of allCustomers) {
      const key = normalizeName(c.fullName);
      if (!nameIndex.has(key)) nameIndex.set(key, c);
    }

    // Check for existing GUIDs
    const existingGuids = new Set<string>();
    const guids = vouchers.map(v => v.tallyGuid).filter(Boolean) as string[];
    if (guids.length > 0) {
      const existing = await prisma.tallyVoucher.findMany({
        where: { tallyGuid: { in: guids } },
        select: { tallyGuid: true },
      });
      for (const e of existing) {
        if (e.tallyGuid) existingGuids.add(e.tallyGuid);
      }
    }

    // Match customers and categorize
    const matchedCustomers: Array<{ customerName: string; customerId: string; customerCode: string; vouchers: number }> = [];
    const unmatchedCustomerNames: string[] = [];
    const duplicateVouchers: Array<{ customerName: string; voucherNumber?: string; voucherDate: string }> = [];
    const matchedMap = new Map<string, { customerId: string; customerCode: string; count: number }>();
    const unmatchedSet = new Set<string>();

    let duplicateCount = 0;

    for (const v of vouchers) {
      // Check GUID duplicate
      if (v.tallyGuid && existingGuids.has(v.tallyGuid)) {
        duplicateCount++;
        duplicateVouchers.push({ customerName: v.customerName, voucherNumber: v.voucherNumber, voucherDate: v.voucherDate });
        continue;
      }

      // Match customer
      const normalizedInput = normalizeName(v.customerName);
      let matchedCustomer = nameIndex.get(normalizedInput);

      // Partial match
      if (!matchedCustomer) {
        for (const [key, cust] of nameIndex) {
          if (key.includes(normalizedInput) || normalizedInput.includes(key)) {
            matchedCustomer = cust;
            break;
          }
        }
      }

      if (matchedCustomer) {
        const existing = matchedMap.get(matchedCustomer.id);
        if (existing) {
          existing.count++;
        } else {
          matchedMap.set(matchedCustomer.id, {
            customerId: matchedCustomer.id,
            customerCode: matchedCustomer.customerCode,
            count: 1,
          });
        }
      } else {
        unmatchedSet.add(v.customerName);
      }
    }

    // Prepare matched customer list
    for (const [customerId, data] of matchedMap) {
      const customer = allCustomers.find(c => c.id === customerId);
      matchedCustomers.push({
        customerName: customer?.fullName || customerId,
        customerId,
        customerCode: data.customerCode,
        vouchers: data.count,
      });
    }
    unmatchedCustomerNames.push(...unmatchedSet);

    // Compute per-customer expected closing balances
    interface CustomerClosing {
      customerId: string;
      customerName: string;
      openingBalance: number;
      totalDebit: number;
      totalCredit: number;
      expectedClosing: number;
    }

    const customerClosings: CustomerClosing[] = [];

    for (const v of valid) {
      const normalizedInput = normalizeName(v.customerName);
      let matchedCustomer = nameIndex.get(normalizedInput);
      if (!matchedCustomer) {
        for (const [, cust] of nameIndex) {
          if (normalizedInput.includes(cust.fullName.toLowerCase().replace(/[^a-z0-9]/g, ''))) {
            matchedCustomer = cust;
            break;
          }
        }
      }

      if (!matchedCustomer) continue;

      let closing = customerClosings.find(c => c.customerId === matchedCustomer.id);
      if (!closing) {
        const dbCustomer = await prisma.customer.findUnique({
          where: { id: matchedCustomer.id },
          select: { openingBalance: true },
        });
        const opening = dbCustomer ? Number(dbCustomer.openingBalance) : 0;
        closing = {
          customerId: matchedCustomer.id,
          customerName: matchedCustomer.fullName,
          openingBalance: opening,
          totalDebit: 0,
          totalCredit: 0,
          expectedClosing: opening,
        };
        customerClosings.push(closing);
      }

      closing.totalDebit += v.debit;
      closing.totalCredit += v.credit;
      closing.expectedClosing = closing.openingBalance + closing.totalDebit - closing.totalCredit;
    }

    return NextResponse.json({
      ok: invalid.length === 0,
      sourceFileName,
      totalVouchers: vouchers.length,
      summary,
      invalidCount: invalid.length,
      duplicateCount,
      matchedCustomers: matchedCustomers.sort((a, b) => a.customerName.localeCompare(b.customerName)),
      unmatchedCustomerNames: unmatchedCustomerNames.sort(),
      duplicateVouchers: duplicateVouchers.slice(0, 50),
      customerClosings: customerClosings.sort((a, b) => a.customerName.localeCompare(b.customerName)),
      sampleVouchers: valid.slice(0, 20),
      warnings: [
        ...(invalid.length > 0 ? [`${invalid.length} invalid vouchers found`] : []),
        ...(duplicateCount > 0 ? [`${duplicateCount} duplicate vouchers (already imported)`] : []),
        ...(unmatchedCustomerNames.length > 0 ? [`${unmatchedCustomerNames.length} unmatched customers — need manual mapping`] : []),
      ],
    });
  } catch (err) {
    console.error('[POST /api/tally/upload]', err);
    return NextResponse.json({
      error: 'Failed to parse Tally XML',
      details: err instanceof Error ? err.message : 'Unknown error',
    }, { status: 500 });
  }
}