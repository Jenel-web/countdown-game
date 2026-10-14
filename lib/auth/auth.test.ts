import { describe, it, expect } from 'vitest';
import {
  validateUsername,
  usernameToEmail,
  loginIdentifierToEmail,
} from './username';
import { isPasswordValid, passedRuleCount, PASSWORD_RULES } from './password';

describe('username', () => {
  it('accepts valid usernames', () => {
    for (const n of ['abc', 'Jenel_29', 'a'.repeat(20)]) {
      expect(validateUsername(n)).toBeNull();
    }
  });

  it('rejects invalid usernames', () => {
    for (const n of ['ab', 'a'.repeat(21), 'has space', 'a@b.com', 'no-dash', '']) {
      expect(validateUsername(n)).not.toBeNull();
    }
  });

  it('maps usernames to a lowercase synthetic email', () => {
    expect(usernameToEmail('  Jenel_29 ')).toBe('jenel_29@players.countdown.app');
  });

  it('login keeps real emails and converts usernames', () => {
    expect(loginIdentifierToEmail('me@gmail.com')).toBe('me@gmail.com');
    expect(loginIdentifierToEmail('Jenel')).toBe('jenel@players.countdown.app');
  });
});

describe('password rules', () => {
  it('accepts a password meeting every rule', () => {
    expect(isPasswordValid('Abcdef1!')).toBe(true);
    expect(passedRuleCount('Abcdef1!')).toBe(PASSWORD_RULES.length);
  });

  it.each([
    ['Abc1!', 'too short'],
    ['abcdefg1!', 'no uppercase'],
    ['ABCDEFG1!', 'no lowercase'],
    ['Abcdefgh!', 'no number'],
    ['Abcdefg12', 'no special'],
    ['', 'empty'],
  ])('rejects %s (%s)', (pw) => {
    expect(isPasswordValid(pw)).toBe(false);
  });
});
