// app/api/_lib/sheetNames.js

export function sheetNames() {
  return {
    KPI_SHEET_NAME: process.env.KPI_SHEET_NAME || "KPI",
    CONFIG_KPI_SHEET_NAME: process.env.CONFIG_KPI_SHEET_NAME || "CONFIG_KPI",
  };
}