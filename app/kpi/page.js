// app/kpi/page.js
import KpiDashboardClient from './KpiDashboardClient';

export const dynamic = 'force-dynamic'; // cho chắc, tránh lỗi prerender

export default function KpiPage() {
  return (
    <main className="p-6">
      <h1 className="text-3xl font-bold mb-2">
        📊 KPI Dashboard
      </h1>
      <p className="text-sm text-gray-600 mb-4">
        Chọn ngày để xem tình trạng từng chuyền.
      </p>

      {/* Phần chính: chọn ngày + bảng chuyền */}
      <KpiDashboardClient />
    </main>
  );
}
