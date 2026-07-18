import { getOverdueData } from '@/lib/overdue';
import OverduePage from './OverduePage';

export const dynamic = 'force-dynamic';

export default async function OverdueCustomersPage() {
  const data = await getOverdueData({ page: 1, limit: 100 });
  return <OverduePage initialData={JSON.parse(JSON.stringify(data))} />;
}
