import KpiDashboardClient from "./KpiDashboardClient";

export default function KPIPage({ searchParams }) {
  const sp = searchParams || {};

  // URL query bạn dùng: ?date=23/12/2025&status=all&q=c1&auto=1
  const initialQuery = {
    date: typeof sp.date === "string" ? sp.date : "",
    status: typeof sp.status === "string" ? sp.status : "all",
    q: typeof sp.q === "string" ? sp.q : "",
    auto: typeof sp.auto === "string" ? sp.auto : "1",
    line: typeof sp.line === "string" ? sp.line : "all", // filter cho bảng lũy tiến
    hour: typeof sp.hour === "string" ? sp.hour : "AUTO", // mốc giờ (AUTO = lấy mốc cuối)
  };

  return <KpiDashboardClient initialQuery={initialQuery} />;
}