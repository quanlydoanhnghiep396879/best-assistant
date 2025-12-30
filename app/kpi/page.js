import KpiDashboardClient from "./KpiDashboardClient";

export const dynamic = "force-dynamic";

export default function KPIPage({ searchParams }) {
  const date = String(searchParams?.date || "");
  const q = String(searchParams?.q || "");
  const status = String(searchParams?.status || "all");
  const auto = String(searchParams?.auto || "1");

  return (
    <KpiDashboardClient
      initialQuery={{ date, q, status, auto }}
    />
  );
}