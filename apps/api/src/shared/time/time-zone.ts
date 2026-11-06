/** True for any IANA zone name the runtime knows (e.g. "Asia/Hebron", "UTC"). */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
}
