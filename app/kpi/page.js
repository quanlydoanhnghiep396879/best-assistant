// app/kpi/page.js
import KpiDashboardClient from "./KpiDashboardClient";

export const dynamic = "force-dynamic"; // tránh cache khi đổi query / auto refresh

export default function KPIPage({ searchParams }) {
  const initialQuery = {
    date: searchParams?.date ?? "",
    status: searchParams?.status ?? "all", // all | ok | fail
    q: searchParams?.q ?? "",
    auto: searchParams?.auto ?? "1", // "1" bật, "0" tắt
    line: searchParams?.line ?? "all",
    hour: searchParams?.hour ?? "", // ví dụ "16:30"
  };

  return <KpiDashboardClient initialQuery={initialQuery} />;
}