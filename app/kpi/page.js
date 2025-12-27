// app/kpi/page.js
import KpiDashboardClient from "./KpiDashboardClient";

export const dynamic = "force-dynamic";

export default function KpiPage() {
  return (
    <main className="p-6">
      <h1 className="text-3xl font-bold">KPI Dashboard</h1>
      <p className="text-gray-600 mt-1">Chọn ngày để xem so sánh lũy tiến theo giờ và hiệu suất ngày.</p>
      <KpiDashboardClient />
    </main>
  );
}
