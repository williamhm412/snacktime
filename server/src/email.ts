import { writeFileSync } from "node:fs";
import { join } from "node:path";
import cron from "node-cron";
import { loadFoods, OUTBOX_DIR } from "./store.js";
import type { FoodItem } from "./types.js";

/** Days until expiration, based on calendar dates (0 = expires today, negative = expired). */
export function daysUntil(expDate: string, now = new Date()): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [y, m, d] = expDate.split("-").map(Number);
  const exp = new Date(y, m - 1, d);
  return Math.round((exp.getTime() - today.getTime()) / 86_400_000);
}

/** Items expiring within the next `days` days (includes already-expired ones). */
export function itemsExpiringSoon(days = 7): FoodItem[] {
  return loadFoods()
    .filter((f) => daysUntil(f.expDate) <= days)
    .sort((a, b) => a.expDate.localeCompare(b.expDate));
}

/**
 * DEV STUB for weekly email.
 * Builds the weekly digest and writes it to server/data/outbox/ as a text
 * file you can open and preview. Later, replace the writeFileSync call with
 * a real nodemailer send (SMTP credentials go in a .env file).
 */
export function sendWeeklyDigest(): { file: string; count: number } {
  const soon = itemsExpiringSoon(7);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = join(OUTBOX_DIR, `digest-${stamp}.txt`);

  const lines = [
    "Subject: SnackTime — food expiring in the next week",
    `Date: ${new Date().toString()}`,
    "(dev stub: this file stands in for a real email)",
    "".padEnd(52, "="),
    "",
  ];

  if (soon.length === 0) {
    lines.push("Nothing expires in the next 7 days. Nice work!");
  } else {
    for (const f of soon) {
      const d = daysUntil(f.expDate);
      const label =
        d < 0 ? `ALREADY EXPIRED (${-d}d ago)` : d === 0 ? "EXPIRES TODAY" : `expires in ${d} day${d === 1 ? "" : "s"}`;
      lines.push(`  • ${f.name} — ${f.expDate} (${label})`);
    }
  }
  lines.push("", "— The SnackTime", "");

  writeFileSync(file, lines.join("\n"), "utf8");
  console.log(`[email] weekly digest stub written → ${file} (${soon.length} item(s))`);
  return { file, count: soon.length };
}

/** Schedule the digest every Sunday at 9:00 AM (local time). */
export function scheduleWeeklyEmail(): void {
  cron.schedule("0 9 * * 0", () => sendWeeklyDigest());
  console.log("[email] weekly digest scheduled for Sundays 9:00 AM (dev stub → data/outbox/)");
}
