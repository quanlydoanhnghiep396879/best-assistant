// app/kpi/page.js
import KpiDashboardClient from "./KpiDashboardClient";

export default function Page({ searchParams }) {
  const dateISO = searchParams?.date || "";
  return <KpiDashboardClient initialQuery={{ dateISO }} />;
}