export async function GET() {
  return new Response(
    JSON.stringify({
      status: "success",
      message: "Google Sheet API đang hoạt động!"
    }),
    { status: 200 }
  );
}
