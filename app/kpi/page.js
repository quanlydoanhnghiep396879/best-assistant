import KpiDashboardClient from "./KpiDashboardClient";

export default function KPIPage({ searchParams }) {
  const sp = searchParams || {};

  // giữ query trên URL (nếu có)
  const date = sp.date || ""; // dd/mm/yyyy (nếu bạn dùng) hoặc rỗng
  const status = sp.status || "all";
  const q = sp.q || "";
  const auto = sp.auto || "1";
  const line = sp.line || "all"; // dùng cho bảng lũy tiến
  const hour = sp.hour || "";     // mốc giờ (vd "16:30")

  return (
    <KpiDashboardClient
      initialQuery={{ date, status, q, auto, line, hour }}
    />
  );
}