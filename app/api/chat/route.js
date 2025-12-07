export async function GET() {
  return new Response(
    JSON.stringify({
      status: "success",
      message: "Chat API đang hoạt động!"
    }),
    { status: 200 }
  );
}
