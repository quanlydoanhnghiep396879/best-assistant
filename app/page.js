import KpiDashboardClient from "./KpiDashboardClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Page() {
  return <KpiDashboardClient />;
}