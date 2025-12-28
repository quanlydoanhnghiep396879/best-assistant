// app/kpi/page.js
import "./kpi.css";
import DashboardClient from "./DashboardClient";

export const dynamic = "force-dynamic";

export default function KPIPage() {
  return (
    <div className="kpiRoot">
      <DashboardClient />
    </div>
  );
}