/** Staff / member roles for the admin panel. */

export const USER_ROLES = ["member", "moderator", "admin", "owner"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export function isUserRole(value: unknown): value is UserRole {
  return (
    typeof value === "string" &&
    (USER_ROLES as readonly string[]).includes(value)
  );
}

export function normalizeUserRole(value: unknown): UserRole {
  if (isUserRole(value)) return value;
  return "member";
}

/** Full Settings access (Server Owner or Admin). */
export function roleIsAdmin(role: UserRole | string | null | undefined): boolean {
  const r = normalizeUserRole(role);
  return r === "owner" || r === "admin";
}

/** Unique server founder / transfer target. */
export function roleIsOwner(role: UserRole | string | null | undefined): boolean {
  return normalizeUserRole(role) === "owner";
}

/** Owner, admin, or moderator — any staff surface. */
export function roleIsStaff(role: UserRole | string | null | undefined): boolean {
  const r = normalizeUserRole(role);
  return r === "owner" || r === "admin" || r === "moderator";
}

/** Whether role should set the legacy is_admin bit. */
export function roleHasAdminBit(role: UserRole | string | null | undefined): boolean {
  return roleIsAdmin(role);
}

export function roleLabel(role: UserRole | string | null | undefined): string {
  switch (normalizeUserRole(role)) {
    case "owner":
      return "Server Owner";
    case "admin":
      return "Admin";
    case "moderator":
      return "Moderator";
    default:
      return "Member";
  }
}
