export function sheetNames() {
  return {
    KPI_SHEET_NAME: process.env.KPI_SHEET_NAME || "KPI",
    CONFIG_KPI_SHEET_NAME: process.env.CONFIG_KPI_SHEET_NAME || "CONFIG_KPI",
    MAIL_LOG_SHEET_NAME: process.env.MAIL_LOG_SHEET_NAME || "MAIL_LOG",
  };
}