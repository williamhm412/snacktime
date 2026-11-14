/** Days until expiration (0 = today, negative = already expired). */
export function daysUntil(expDate: string): number {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [y, m, d] = expDate.split("-").map(Number);
  return Math.round((new Date(y, m - 1, d).getTime() - today.getTime()) / 86_400_000);
}

/** Badge text + tone class for a food item's expiry. */
export function expiryBadge(expDate: string): { label: string; tone: "expired" | "soon" | "mid" | "fresh" } {
  const d = daysUntil(expDate);
  if (d < 0) return { label: d === -1 ? "Expired yesterday" : `Expired ${-d}d ago`, tone: "expired" };
  if (d === 0) return { label: "Expires today", tone: "soon" };
  if (d === 1) return { label: "1 day left", tone: "soon" };
  if (d <= 3) return { label: `${d} days left`, tone: "soon" };
  if (d <= 7) return { label: `${d} days left`, tone: "mid" };
  return { label: `${d} days left`, tone: "fresh" };
}

/** Format an exp date like "Nov 18" for display. */
export function formatExpDate(expDate: string): string {
  const [y, m, d] = expDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "added 2h ago"-style relative label. */
export function addedAgo(iso: string): string {
  const mins = (Date.now() - new Date(iso).getTime()) / 60_000;
  if (mins < 1) return "just now";
  if (mins < 60) return `${Math.floor(mins)}m ago`;
  const hrs = mins / 60;
  if (hrs < 24) return `${Math.floor(hrs)}h ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

/** Local date as YYYY-MM-DD (defaults to today), for date input values. */
export function localISODate(offsetDays = 0): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
