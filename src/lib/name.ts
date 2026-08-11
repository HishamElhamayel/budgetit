/**
 * Turning a stored name into something to call someone.
 *
 * The profile holds one free-text field, so this has to guess which part of it
 * is the given name, and "the first word" is a guess that is wrong for every
 * culture that puts the family name first. It is used deliberately shallowly
 * for that reason: a greeting and a notification title, both of which read fine
 * if the guess lands on the wrong word, and neither of which is an address, an
 * invoice, or anything else where getting a name wrong actually costs
 * something. Nothing here should grow into name *parsing*.
 */

/** The word to greet someone by, or null if there isn't one. */
export function greetingName(fullName: string | null | undefined): string | null {
  const first = fullName?.trim().split(/\s+/)[0];
  return first ? first : null;
}

/** "Good morning" and friends, from the device's own clock. */
export function timeOfDayGreeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}
