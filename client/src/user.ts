/* Who is using the app right now?
   Named profiles → choice saved in localStorage; pantry lives in the cloud
   under that name, so it follows the person to any device.
   Guest        → random id kept ONLY in sessionStorage; closing the tab loses
   it, and the cloud copy self-destructs after 12h (KV TTL). */

export type UserChoice = "william" | "ammon" | "mckay" | "dr-lignell" | "guest";

export const PEOPLE: { id: UserChoice; name: string; note?: string }[] = [
  { id: "william", name: "William" },
  { id: "ammon", name: "Ammon" },
  { id: "mckay", name: "McKay" },
  { id: "dr-lignell", name: "Dr. Lignell" },
  { id: "guest", name: "Guest", note: "temporary — erased when you close the page" },
];

const LS_KEY = "snacktime:user";
const SS_KEY = "snacktime:guestId";

export function displayName(choice: UserChoice): string {
  return PEOPLE.find((p) => p.id === choice)?.name ?? "Guest";
}

export function loadStoredChoice(): UserChoice | null {
  const v = localStorage.getItem(LS_KEY);
  if (v === "william" || v === "ammon" || v === "mckay" || v === "dr-lignell" || v === "guest") return v;
  return null;
}

export function saveChoice(choice: UserChoice): void {
  localStorage.setItem(LS_KEY, choice);
  if (choice === "guest" && !sessionStorage.getItem(SS_KEY)) {
    sessionStorage.setItem(SS_KEY, crypto.randomUUID()); // fresh throwaway session
  }
}

export function clearChoice(): void {
  localStorage.removeItem(LS_KEY);
}

/** Value sent in the X-Snacktime-User header on every API call. */
export function userHeaderValue(choice: UserChoice): string {
  if (choice !== "guest") return choice;
  let id = sessionStorage.getItem(SS_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(SS_KEY, id);
  }
  return `guest:${id}`;
}
