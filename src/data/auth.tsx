/**
 * Session state.
 *
 * Sits above {@link DataProvider} in the tree, because the repository cannot be
 * built without a user id to stamp on writes — every row is fenced off by RLS
 * keyed on `auth.uid()`, so a query issued before the session resolves comes
 * back empty rather than erroring, which is the more confusing failure.
 *
 * `initialising` exists to tell "not signed in" apart from "we haven't looked
 * yet". Reading the persisted session off disk takes a few milliseconds, and
 * without that distinction those milliseconds render the sign-in screen and
 * then yank it away — a flash on every single cold start.
 *
 * Password reset runs on emailed codes rather than emailed links. A link has to
 * carry the user back into the app through a custom URL scheme, which only
 * works if they open the mail on a device running a real build — not Expo Go,
 * not a desktop browser, not a different phone. A six-digit code they retype
 * has none of those constraints, and needs no redirect allowlist to go wrong.
 *
 * Changing an email address works the same way, and for an additional reason
 * beyond the ones above: a link has to land the user *somewhere*, which means
 * the app owes the world a hosted page whose only job is to say "you can go
 * back to the app now". A typed code owes nothing. It also keeps the two email
 * flows identical to use, which is worth more than it sounds — the screen, the
 * input component and the "that code is wrong or expired" copy are all already
 * built and already understood.
 *
 * Both changes re-authenticate first. Supabase does not require the current
 * password to set a new one — a valid session is enough — which means an
 * unlocked, unattended phone is a full account takeover: change the email,
 * change the password, and the original owner is locked out of their own
 * budgets. Asking for the password costs one round trip and closes that.
 */

import type { AuthError, Session, User } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { MIN_PASSWORD_LENGTH } from '@/lib/password';
import { supabase } from '@/lib/supabase';

/**
 * How many digits an emailed code has.
 *
 * Must match the project's `mailer_otp_length` (Authentication → Sign In /
 * Providers, or `auth.email.otp_length` in config.toml) — the input caps typing
 * at this many characters, so guessing low means a correct code gets silently
 * truncated and rejected. The linked project is set to 8, which is Supabase's
 * current default; older projects are often 6.
 *
 * One constant for every emailed code, not one per flow, because `otp_length`
 * is a single project-wide setting — password reset and email change cannot
 * disagree about it, and two constants would only ever be two places to update
 * when it moves.
 */
export const EMAIL_CODE_LENGTH = 8;

/**
 * What a screen gets back from an auth attempt.
 *
 * Errors are returned rather than thrown: every caller here is a form that
 * needs to put the message next to the fields and leave what the user typed
 * alone, and `try`/`catch` around each submit handler is more ceremony for the
 * same result.
 */
export interface AuthResult {
  error: string | null;
  /**
   * True when sign-up succeeded but the account still needs the confirmation
   * link clicked. Supabase returns a user with no session in that case, which
   * is otherwise indistinguishable from success and leaves the form sitting
   * there looking broken.
   */
  needsEmailConfirmation?: boolean;
}

/**
 * What the sign-up form collects beyond the credentials.
 *
 * Carried into `options.data`, which Supabase lands in `raw_user_meta_data`,
 * where the `handle_new_user` trigger reads it once to build the profile row.
 * That one-way trip is the whole contract: user metadata is writable by the
 * user's own token, so nothing reads these back from there afterwards — the
 * `profiles` table is the record from the moment the account exists.
 */
export interface SignUpDetails {
  fullName: string;
  /** ISO 3166-1 alpha-2, or null if they skipped it. */
  countryCode: string | null;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  /**
   * The address a confirmed email change is waiting on, or null. Supabase keeps
   * `user.email` pointing at the old address until every confirmation link has
   * been clicked, so this is the only way to tell "nothing has happened" apart
   * from "something is in flight".
   */
  pendingEmail: string | null;
  /** True until the persisted session has been read. */
  initialising: boolean;
  /**
   * True from the moment a reset code is accepted until the new password is
   * saved. Verifying the code signs the user in for real, so without this flag
   * the root navigator would drop them straight into the app with nothing ever
   * asking for the password they came to change.
   */
  passwordRecovery: boolean;
  signIn(email: string, password: string): Promise<AuthResult>;
  signUp(email: string, password: string, details: SignUpDetails): Promise<AuthResult>;
  signOut(): Promise<void>;
  /** Start an email change: emails a code to the new address. */
  changeEmail(nextEmail: string, currentPassword: string): Promise<AuthResult>;
  /**
   * Finish an email change by trading the emailed code for the new address.
   *
   * Takes the address the code was sent to, because that is what the server
   * looks the token up against — and it is the *new* one, not the account's
   * current one.
   */
  verifyEmailChange(nextEmail: string, code: string): Promise<AuthResult>;
  changePassword(currentPassword: string, nextPassword: string): Promise<AuthResult>;
  /** Email a one-time code to whoever owns this address. */
  sendPasswordResetCode(email: string): Promise<AuthResult>;
  /** Trade the emailed code for a session. */
  verifyPasswordResetCode(email: string, code: string): Promise<AuthResult>;
  /** Save the new password and end the recovery state. */
  completePasswordReset(password: string): Promise<AuthResult>;
  /** Abandon a reset in progress and return to sign-in. */
  cancelPasswordReset(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initialising, setInitialising] = useState(true);
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  useEffect(() => {
    let active = true;

    // The cold-start read. `onAuthStateChange` below also fires an INITIAL_SESSION
    // event, but only after this resolves, so doing both is belt and braces
    // rather than duplication — whichever lands first clears `initialising`.
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setInitialising(false);
    });

    // Covers sign-in, sign-out, token refresh and the user being deleted
    // server-side. Every one of those has to move the app between the gated and
    // ungated halves of the navigator, so they all land in the same setState.
    const { data: subscription } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setInitialising(false);

      // Signing out has to drop the recovery state too, or an abandoned reset
      // would still be holding the navigator when the next user signs in.
      if (event === 'SIGNED_OUT') setPasswordRecovery(false);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      pendingEmail: session?.user.new_email ?? null,
      initialising,
      passwordRecovery,

      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        return { error: error ? describe(error) : null };
      },

      async signUp(email, password, details) {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            // Keys are snake_case because the trigger reads them straight out
            // of `raw_user_meta_data` by name; this is a database contract, not
            // a JS one. Empty values are sent as-is and collapsed to null in
            // SQL, so the shape of the object doesn't depend on what was typed.
            data: {
              full_name: details.fullName.trim(),
              country_code: details.countryCode ?? '',
            },
          },
        });
        if (error) return { error: describe(error) };

        // A user with no session means the project has email confirmation on
        // and the link hasn't been clicked yet. With confirmation off, the
        // session arrives here and `onAuthStateChange` navigates on its own.
        return { error: null, needsEmailConfirmation: data.session === null };
      },

      async signOut() {
        // `scope: 'local'` clears this device's stored session without waiting
        // on the network. A global sign-out that fails offline would otherwise
        // leave the user staring at a sign-out button that does nothing.
        await supabase.auth.signOut({ scope: 'local' });
      },

      async changeEmail(nextEmail, currentPassword) {
        const reauthError = await reauthenticate(session, currentPassword);
        if (reauthError) return { error: reauthError };

        const trimmed = nextEmail.trim();
        if (trimmed.toLowerCase() === session?.user.email?.toLowerCase()) {
          // Supabase accepts this and sends a confirmation for a change to the
          // address they already have, which is a confusing email to receive.
          return { error: 'That is already your email address.' };
        }

        const { error } = await supabase.auth.updateUser({ email: trimmed });
        if (error) {
          // This endpoint's job is to send a confirmation, so a server error
          // here is nearly always the send failing rather than the update.
          // Naming that is the difference between a user retrying pointlessly
          // and one who knows to look at the address they typed.
          if (error.status !== undefined && error.status >= 500) {
            return {
              error:
                'We could not send the confirmation email. Check the address and try again in a minute.',
            };
          }
          return { error: describe(error) };
        }

        // `updateUser` writes the returned user back into the stored session
        // and fires USER_UPDATED, so `pendingEmail` is already correct by the
        // time this resolves — the caller has nothing to thread back.
        return { error: null };
      },

      async verifyEmailChange(nextEmail, code) {
        const { error } = await supabase.auth.verifyOtp({
          // The address the code was mailed to, which is the new one. Passing
          // the account's current address here is the obvious mistake and
          // fails as "token not found", which reads like a wrong code.
          email: nextEmail.trim(),
          token: code.trim(),
          type: 'email_change',
        });
        if (error) return { error: describe(error) };

        // A successful verify returns a session carrying the updated user, and
        // supabase-js stores it — so `user.email` is the new address and
        // `pendingEmail` has gone back to null without anything else running.
        return { error: null };
      },

      async changePassword(currentPassword, nextPassword) {
        const reauthError = await reauthenticate(session, currentPassword);
        if (reauthError) return { error: reauthError };

        const { error } = await supabase.auth.updateUser({ password: nextPassword });
        return { error: error ? describe(error) : null };
      },

      async sendPasswordResetCode(email) {
        // The same call that would send a reset link. Which of the two the
        // recipient actually gets is decided by the email template: swap
        // `{{ .ConfirmationURL }}` for `{{ .Token }}` and it becomes a code.
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
        return { error: error ? describe(error) : null };
      },

      async verifyPasswordResetCode(email, code) {
        // Raised before the call, not after. A correct code signs the user in,
        // and if the navigator learned about that session before it learned
        // this was a recovery, it would render the tab bar for a frame.
        setPasswordRecovery(true);

        const { error } = await supabase.auth.verifyOtp({
          email: email.trim(),
          token: code.trim(),
          type: 'recovery',
        });

        if (error) {
          setPasswordRecovery(false);
          return { error: describe(error) };
        }
        return { error: null };
      },

      async completePasswordReset(password) {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) return { error: describe(error) };

        // Dropping the flag is what hands the user back to the app — the
        // recovery session they arrived on is a normal session now.
        setPasswordRecovery(false);
        return { error: null };
      },

      async cancelPasswordReset() {
        // A verified code grants full access to the account, so backing out has
        // to actually discard the session rather than just hide the form.
        setPasswordRecovery(false);
        await supabase.auth.signOut({ scope: 'local' });
      },
    }),
    [session, initialising, passwordRecovery]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

/**
 * Prove the person holding the phone is the person who owns the account.
 *
 * There is no dedicated endpoint for this — signing in again is how you check a
 * password. The side effect is a freshly minted session for the same user,
 * which is harmless: `onAuthStateChange` sees the same id, so nothing above
 * rebuilds, and the account gets a newer token out of it than it had.
 *
 * Returns the message to show, or null when the password checked out.
 */
async function reauthenticate(session: Session | null, password: string): Promise<string | null> {
  const email = session?.user.email;
  if (!email) {
    // Only reachable if the session went away between the screen rendering and
    // the button being pressed.
    return 'You are not signed in any more. Sign in again to make this change.';
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (!error) return null;

  // The email came from the session rather than from a field, so there is only
  // one half of this that can be wrong. `describe` would blame both.
  if (error.code === 'invalid_credentials') return 'That is not your current password.';
  return describe(error);
}

/**
 * Turn a Supabase auth error into something worth showing a person.
 *
 * Only the cases where the raw message is actively unhelpful are rewritten.
 * Everything else passes through — inventing friendly copy for errors we
 * haven't seen tends to hide the one detail that would have explained it.
 */
function describe(error: AuthError): string {
  // Handled ahead of the codes because a 5xx usually doesn't carry one. When
  // the body isn't the JSON shape auth-js expects, it falls back to
  // stringifying the response — and `error.message` becomes
  // `{"status":500,"statusText":"internal server error",...}`, which is what
  // put a blob of JSON in front of a user. Nothing in it is actionable by them.
  if (error.status !== undefined && error.status >= 500) {
    return 'Something went wrong on the server. Try again in a moment.';
  }

  switch (error.code) {
    case 'invalid_credentials':
      return 'That email and password combination is not right.';
    case 'email_not_confirmed':
      return 'Check your inbox and confirm your email address first.';
    case 'user_already_exists':
      return 'There is already an account with that email. Try signing in instead.';
    // The same collision, met from the other direction: changing an existing
    // account's address to one that is taken.
    case 'email_exists':
      return 'Another account is already using that email address.';
    case 'email_address_invalid':
      return 'That email address was rejected. Check it for typos.';
    // The app checks the same rules before submitting (src/lib/password.ts), so
    // reaching this means the two are out of step — most likely the server's
    // minimum_password_length moved without the constant following it.
    case 'weak_password':
      return `Pick a longer password — at least ${MIN_PASSWORD_LENGTH} characters.`;
    case 'same_password':
      return 'That is already your password. Choose a different one.';
    // Supabase returns this for a wrong code as well as a stale one, so the
    // wording has to cover both without guessing which happened.
    case 'otp_expired':
      return 'That code is wrong or has expired. Check the latest email, or send a new code.';
    case 'over_email_send_rate_limit':
      return 'Too many emails just went out. Wait a minute and try again.';
    case 'over_request_rate_limit':
      return 'Too many attempts. Wait a minute and try again.';
    default:
      return error.message;
  }
}
