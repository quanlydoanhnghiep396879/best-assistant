import KpiDashboardClient from "./KpiDashboardClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function KPIPage({ searchParams }) {
  // searchParams có thể undefined trong vài trường hợp build -> fallback {}
  const sp = searchParams || {};

  const initialQuery = {
    date: sp.date || "",
    status: sp.status || "all",
    q: sp.q || "",
    auto: sp.auto || "1",
  };

  return <KpiDashboardClient initialQuery={initialQuery} />;
}