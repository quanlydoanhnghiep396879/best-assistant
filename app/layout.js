export const metadata = {
  title: "Best Assistant",
  description: "Dashboard for KPI assistant",
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
