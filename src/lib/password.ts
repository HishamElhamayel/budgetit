/**
 * What counts as an acceptable password, in one place.
 *
 * Three screens choose a password — sign-up, reset, and the in-app change — and
 * each of them used to carry its own copy of the minimum length. A policy split
 * across three files is a policy that drifts, so the rules live here and the
 * screens render whatever this returns.
 *
 * The policy is length plus a blocklist, not a character-class checklist. The
 * "one upper, one digit, one symbol" school of rule reliably produces
 * `Password1!` — it constrains the search space more than it constrains an
 * attacker, and NIST dropped composition requirements from SP 800-63B for
 * exactly that reason. Twelve characters with no composition rule leaves people
 * free to type a passphrase, which is both stronger and easier to remember.
 *
 * These checks run in the app to save a round trip and to say *which* rule is
 * unmet — the server is still the real gate. Supabase enforces the length
 * (`minimum_password_length` in supabase/config.toml, kept in step with the
 * constant below); the blocklist and the personal-information check are ours
 * alone and can be bypassed by anyone talking to the API directly. That is
 * acceptable: they are guardrails against a user picking something regrettable,
 * not defences against someone attacking their own account.
 */

/**
 * Twelve, and it must match `minimum_password_length` in supabase/config.toml.
 * If the two disagree, the app either rejects passwords the server would take
 * or promises passwords the server will refuse.
 */
export const MIN_PASSWORD_LENGTH = 12;

/** One requirement, and whether the candidate currently satisfies it. */
export type PasswordRule = {
  /** Stable across keystrokes so React can key the list on it. */
  id: string;
  /** Phrased as the thing that will be true once it passes. */
  label: string;
  met: boolean;
};

/**
 * What the app knows about the person, used to reject passwords built out of
 * it. All optional — the sign-up form has a name and an email, the reset screen
 * only has the email, and either may be blank while they're still typing.
 */
export type PasswordContext = {
  email?: string | null;
  name?: string | null;
  /**
   * The password being replaced, where there is one. Supabase rejects a
   * no-op change with `same_password`; catching it here turns a round trip and
   * a red error into a rule that never ticked.
   */
  currentPassword?: string | null;
};

/**
 * Bases that show up at the top of every leaked-password list. Short entries
 * like `qwerty` would be caught by the length rule on their own — they are here
 * because `checkPassword` strips the padding people add to reach a length
 * limit, which is what turns `Qwerty123456!` back into `qwerty`.
 *
 * A few hundred more entries wouldn't meaningfully change the outcome; this is
 * a nudge away from the obvious choices, not a breach corpus. Anything
 * approaching real coverage belongs behind an API (Supabase's leaked-password
 * protection, which checks Have I Been Pwned), not shipped in the bundle.
 */
const COMMON_BASES = new Set([
  'password',
  'passwort',
  'passord',
  'letmein',
  'welcome',
  'admin',
  'administrator',
  'qwerty',
  'qwertyuiop',
  'qwertz',
  'azerty',
  'asdf',
  'asdfgh',
  'asdfghjkl',
  'zxcvbn',
  'zxcvbnm',
  'iloveyou',
  'trustno',
  'sunshine',
  'princess',
  'superman',
  'batman',
  'pokemon',
  'starwars',
  'minecraft',
  'football',
  'baseball',
  'basketball',
  'liverpool',
  'barcelona',
  'chelsea',
  'arsenal',
  'monkey',
  'dragon',
  'shadow',
  'master',
  'michael',
  'jennifer',
  'jordan',
  'freedom',
  'whatever',
  'secret',
  'changeme',
  'default',
  'temporary',
  'computer',
  'internet',
  'samsung',
  'google',
  'facebook',
  'apple',
  'android',
  'summer',
  'winter',
  'spring',
  'autumn',
  'hello',
  'test',
  'testing',
  'user',
  'login',
  'money',
  'budget',
  'budgetit',
]);

/**
 * Substitutions people make when a site tells them the password is too weak.
 * Folding them back is what stops `P@ssw0rd!!` from reading as a novel string —
 * the substitutions are so uniform that a cracker applies them by default, so
 * they buy nothing and shouldn't be allowed to buy a passing grade either.
 */
const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '6': 'g',
  '7': 't',
  '8': 'b',
  '9': 'g',
  '@': 'a',
  $: 's',
  '!': 'i',
  '|': 'l',
  '+': 't',
};

/**
 * Reduce a password to the word someone was actually thinking of: lowercase,
 * leet folded back, and the padding they added to satisfy a length rule
 * stripped off both ends. `Sunshine2024!` and `!!sunshine!!` both come out as
 * `sunshine`.
 */
function baseWord(password: string): string {
  // Padding comes off before the leet fold, not after. Folding first would turn
  // the `1234` on the end of `password1234` into letters and glue them to the
  // word, which is how the most common password on earth slips through.
  const trimmed = password.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, '');
  const folded = [...trimmed].map((character) => LEET[character] ?? character).join('');
  return folded.replace(/[^a-z]+/g, '');
}

/**
 * Whether the base is one of the blocked words — or that word typed more than
 * once, which is what people reach for the moment a length rule doubles.
 */
function isCommonBase(base: string): boolean {
  if (COMMON_BASES.has(base)) return true;

  for (let size = 1; size <= base.length / 2; size++) {
    if (base.length % size !== 0) continue;
    const unit = base.slice(0, size);
    if (unit.repeat(base.length / size) === base && COMMON_BASES.has(unit)) return true;
  }

  return false;
}

/** `aaaaaaaaaaaa` and friends — long, and worth nothing. */
function isSingleCharacter(password: string): boolean {
  return password.length > 0 && [...password].every((character) => character === password[0]);
}

/**
 * A straight run along the keyboard or the alphabet: `123456789012`,
 * `abcdefghijkl`, `qwertyuiopas`, and the same read backwards. Checked as a
 * substring test against the rows themselves rather than by walking character
 * codes, because `qwerty` is only "sequential" with respect to a keyboard.
 */
const SEQUENCES = [
  'abcdefghijklmnopqrstuvwxyz',
  // Twice through, because digits are the one row people wrap around: a
  // twelve-character run starting at 1 has to pass 0 and keep going.
  '01234567890123456789',
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm',
];

function isSequence(password: string): boolean {
  const lowered = password.toLowerCase();
  const reversed = [...lowered].reverse().join('');
  return SEQUENCES.some((row) => row.includes(lowered) || row.includes(reversed));
}

/**
 * The tokens from someone's own details that a password shouldn't be made of:
 * the name's words, and the local part of the email plus its domain label.
 * Short fragments are dropped — a two-letter surname would flag half the
 * dictionary, and `Ng` appearing inside a passphrase means nothing.
 */
function personalTokens({ email, name }: PasswordContext): string[] {
  const tokens: string[] = [];

  if (name) tokens.push(...name.toLowerCase().split(/[^a-z0-9]+/i));

  if (email) {
    const [local, domain] = email.toLowerCase().trim().split('@');
    if (local) tokens.push(...local.split(/[^a-z0-9]+/i));
    // Only the site's own label: `gmail` from `gmail.com`, not `com`, which is
    // too short to survive the filter below anyway.
    if (domain) tokens.push(domain.split('.')[0] ?? '');
  }

  return tokens.filter((token) => token.length >= 4);
}

/**
 * Evaluate a candidate against every rule, in the order they should be read.
 *
 * Always returns the same rules for the same context — including the ones
 * already satisfied — because the caller renders this as a checklist, and a
 * requirement that disappears once met is a requirement the user can't confirm
 * they met. Rules that don't apply (no email known yet, no password being
 * replaced) are left out entirely rather than shown as passing.
 */
export function checkPassword(password: string, context: PasswordContext = {}): PasswordRule[] {
  const base = baseWord(password);
  const tokens = personalTokens(context);
  const lowered = password.toLowerCase();

  const rules: PasswordRule[] = [
    {
      id: 'length',
      label: `At least ${MIN_PASSWORD_LENGTH} characters`,
      met: password.length >= MIN_PASSWORD_LENGTH,
    },
    {
      id: 'not-common',
      label: 'Not a common password or a keyboard run',
      // An empty box shouldn't show a tick. Every other rule fails on an empty
      // string by construction; this one has to say so explicitly, because
      // nothing about `''` is common or sequential.
      met:
        password.length > 0 &&
        !isCommonBase(base) &&
        !isSingleCharacter(password) &&
        !isSequence(password),
    },
  ];

  if (tokens.length > 0) {
    rules.push({
      id: 'not-personal',
      label: 'Not your name or email address',
      met: password.length > 0 && !tokens.some((token) => lowered.includes(token)),
    });
  }

  if (context.currentPassword) {
    rules.push({
      id: 'not-current',
      label: 'Different from your current password',
      met: password.length > 0 && password !== context.currentPassword,
    });
  }

  return rules;
}

/** True when every rule is satisfied — i.e. the password can be submitted. */
export function passwordAccepted(rules: readonly PasswordRule[]): boolean {
  return rules.every((rule) => rule.met);
}
