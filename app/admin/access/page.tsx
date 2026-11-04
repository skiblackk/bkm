import AdminModuleWorkspace from '@/components/admin-module-workspace';
import { getDemoSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export default async function AccessAuditPage() { const session = await getDemoSession(); if (!session?.isAdmin) redirect('/'); return <AdminModuleWorkspace module="access" />; }
