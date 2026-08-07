/** Shared password rules for signup, join, login UI, and password change. */

export const MIN_PASSWORD_LENGTH = 8;

export const PASSWORD_TOO_SHORT_MSG = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;

export function isPasswordLongEnough(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH;
}
