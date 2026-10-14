export interface PasswordRule {
  id: string;
  label: string;
  test: (pw: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  { id: 'length', label: 'At least 8 characters', test: (pw) => pw.length >= 8 },
  { id: 'upper', label: 'One uppercase letter', test: (pw) => /[A-Z]/.test(pw) },
  { id: 'lower', label: 'One lowercase letter', test: (pw) => /[a-z]/.test(pw) },
  { id: 'number', label: 'One number', test: (pw) => /[0-9]/.test(pw) },
  { id: 'special', label: 'One special character (!@#$%^&*…)', test: (pw) => /[^A-Za-z0-9\s]/.test(pw) },
];

export function passedRuleCount(pw: string): number {
  return PASSWORD_RULES.filter((r) => r.test(pw)).length;
}

export function isPasswordValid(pw: string): boolean {
  return passedRuleCount(pw) === PASSWORD_RULES.length;
}
