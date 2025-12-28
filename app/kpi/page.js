import "./kpi.css";
import KpiDashboardClient from "./KpiDashboardClient";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <div className="kpiPage">
      <KpiDashboardClient />
    </div>
  );
}