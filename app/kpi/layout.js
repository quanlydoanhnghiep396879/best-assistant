// app/kpi/layout.js
import "./kpi.css";

export const metadata = {
  title: "Best Assistant",
  description: "KPI Dashboard",
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}