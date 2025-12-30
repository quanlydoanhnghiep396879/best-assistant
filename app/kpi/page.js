import KpiDashboardClient from "./KpiDashboardClient";

function safeDate(d) {
  if (!d) return "";
  const s = String(d).trim();

  // yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // dd/mm/yyyy
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const dd = String(m[1]).padStart(2, "0");
    const mm = String(m[2]).padStart(2, "0");
    const yyyy = m[3];
    // dùng yyyy-mm-dd cho input type="date"
    return `${yyyy}-${mm}-${dd}`;
  }
  return "";
}

export default function KPIPage({ searchParams }) {
  const date = safeDate(searchParams?.date) || "";
  const status = (searchParams?.status || "all").toString();
  const q = (searchParams?.q || "").toString();
  const auto = (searchParams?.auto || "1").toString(); // 1/0

  return (
    <KpiDashboardClient
      initialQuery={{
        date,
        status,
        q,
        auto,
      }}
    />
  );
}