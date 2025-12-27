import KpiDashboardClient from "./KpiDashboardClient";

export default function KpiPage() {
  return (
    <main className="p-4">
      <h1 className="text-xl font-bold">KPI Dashboard</h1>
      <p>Chọn ngày để xem tình trạng từng chuyền.</p>
      <KpiDashboardClient />
    </main>
  );
}
