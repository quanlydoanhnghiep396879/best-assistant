import dynamic from "next/dynamic";

const KpiDashboardClient = dynamic(() => import("./KpiDashboardClient"), { ssr: false });

export default function Page() {
  return <KpiDashboardClient />;
}
