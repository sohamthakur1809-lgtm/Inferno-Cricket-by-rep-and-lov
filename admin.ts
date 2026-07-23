// Support both ADMIN_ID (single) and ADMIN_IDS (comma-separated list).
const ADMIN_IDS = [
  ...(process.env.ADMIN_IDS ?? "").split(","),
  ...(process.env.ADMIN_ID ?? "").split(","),
]
  .map((s) => s.trim())
  .filter(Boolean);

export function isAdmin(userId: string | number): boolean {
  return ADMIN_IDS.includes(String(userId));
}

export function getAdminIds(): string[] {
  return [...ADMIN_IDS];
}
