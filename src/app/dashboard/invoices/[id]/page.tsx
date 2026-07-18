import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import InvoicePrintView from './InvoicePrintView';

export default async function InvoiceDetailPage({ params }: { params: { id: string } }) {
  const sale = await prisma.sale.findUnique({
    where: { id: params.id },
    include: {
      customer: {
        select: {
          id: true, customerCode: true, fullName: true, mobile: true,
          alternateMobile: true, address: true, city: true, state: true, pinCode: true,
        },
      },
      createdBy: { select: { fullName: true } },
      saleItems: {
        include: {
          product: { select: { id: true, name: true, sku: true, hsnCode: true } },
        },
      },
      payments: { orderBy: { paymentDate: 'desc' } },
    },
  });

  if (!sale) notFound();

  const settings = await prisma.shopSettings.findFirst();

  return <InvoicePrintView sale={JSON.parse(JSON.stringify(sale))} settings={JSON.parse(JSON.stringify(settings))} />;
}
