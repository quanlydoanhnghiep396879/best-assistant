export default function Home() {
  return (
    <div style={{ padding: 40 }}>
      <h1>Best Assistant Dashboard</h1>
      <p>API đã triển khai thành công!</p>

      <h2>Test API</h2>
      <ul>
        <li><a href="/api/sheet" target="_blank">Test /api/sheet</a></li>
        <li><a href="/api/chat" target="_blank">Test /api/chat</a></li>
        <li><a href="/api/check-kpi" target="_blank">Test /api/check-kpi</a></li>
        <li><a href="/api/input" target="_blank">Test /api/input</a></li>
      </ul>
    </div>
  );
}
