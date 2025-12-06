export const metadata = {
  title: "Assistant API Dashboard",
  description: "Monitoring system",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
