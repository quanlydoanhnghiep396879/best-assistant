// app/kpi/page.js
import KpiDashboardClient from "./KpiDashboardClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function todayVN() {
  // trả về DD/MM/YYYY theo giờ VN
  const now = new Date();
  const parts = new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(now);
  const d = parts.find(p => p.type === "day")?.value || "01";
  const m = parts.find(p => p.type === "month")?.value || "01";
  const y = parts.find(p => p.type === "year")?.value || "2000";
  return `${d}/${m}/${y}`;
}

function safeDate(d) {
  // chỉ nhận dạng DD/MM/YYYY
  if (!d) return "";
  const s = String(d).trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  return "";
}

export default function KPIPage({ searchParams }) {
  const date = safeDate(searchParams?.date) || todayVN();
  const status = String(searchParams?.status || "all"); // all | dat | kdat
  const q = String(searchParams?.q || "");
  const auto = String(searchParams?.auto || "1") === "1";

  return (
    <KpiDashboardClient
      initialQuery={{ date, status, q, auto }}
    />
  );
}