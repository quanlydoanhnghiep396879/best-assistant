import KpiDashboardClient from "./KpiDashboardClient";

export const dynamic = "force-dynamic"; // cho chắc chắn luôn chạy động

function todayVN() {
  const now = new Date();
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(now);
}

function pick1(v, fallback = "") {
  if (Array.isArray(v)) return v[0] ?? fallback;
  return v ?? fallback;
}

export default function KPIPage({ searchParams }) {
  const initialQuery = {
    date: pick1(searchParams?.date, todayVN()), // "dd/mm/yyyy"
    status: pick1(searchParams?.status, "all"), // all | ok | bad
    q: pick1(searchParams?.q, ""),
    auto: pick1(searchParams?.auto, "1"), // 1 bật, 0 tắt
  };

  return (
    <div className="kpi-container">
      <div className="kpi-header">
        <div>
          <h1 className="kpi-title">KPI Dashboard</h1>
          <div className="kpi-subtitle">
            So sánh <b>Hiệu suất ngày</b> và <b>Lũy tiến theo giờ</b> theo dữ liệu Google Sheet
          </div>
        </div>
      </div>

      <KpiDashboardClient initialQuery={initialQuery} />
    </div>
  );
}