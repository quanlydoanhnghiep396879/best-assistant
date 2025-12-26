// encode-key.js
const fs = require('fs');
const path = require('path');

// ĐÚNG TÊN FILE JSON CỦA EM Ở ĐÂY
const jsonPath = path.join(__dirname, 'kpi-automation-api-992868f0e023.json');

console.log('Đang đọc file:', jsonPath);

// Đọc JSON
const json = fs.readFileSync(jsonPath, 'utf8');

// Mã hoá base64
const base64 = Buffer.from(json, 'utf8').toString('base64');

// In ra chuỗi base64
console.log(base64);
