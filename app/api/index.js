// api/sheet.js
export default async function handler(req, res) {
  return res.status(200).json({
    status: "success",
    message: "Google Sheet API đang hoạt động!"
  });
}
