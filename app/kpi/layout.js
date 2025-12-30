import "./kpi.css";

export const metadata = {
  title: "KPI Dashboard",
  description: "KPI Dashboard",
};

export default function KpiLayout({ children }) {
  return <div className="kpi-root">{children}</div>;
}