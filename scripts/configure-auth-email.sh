#!/usr/bin/env bash
#
# Point the linked Supabase project's auth emails at Resend, turn every email
# confirmation into a typed code, and apply the account-security settings the
# app depends on.
#
# Why a script rather than a walk through the dashboard: these settings have to
# agree with each other and with the client, and they live on different pages.
# `mailer_secure_email_change_enabled` decides whether one code is sent or two,
# and the change-email screen has to ask for exactly that many — a mismatch
# looks like "the code is broken" rather than like a setting.
#
# It also carries the three settings that are *only* enforced if they are here.
# supabase/config.toml configures `supabase start` and nothing else (see the
# SCOPE note in that file), so anything the linked project needs has to be in
# this payload or it is not in effect:
#
#   password_min_length ................ src/lib/password.ts promises 12; GoTrue
#                                        defaults to 6, and the client check is
#                                        bypassable by posting to /auth/v1/signup
#   security_update_password_require_reauthentication
#   mailer_secure_email_change_enabled . together, these are what stop a stolen
#                                        access token from changing the account
#                                        email and then the password. Both are
#                                        enforced server-side; the current-
#                                        password prompts in the app are UX in
#                                        front of them, not a substitute.
#
# Run this after any change to those, and read the output — it reports what the
# server actually holds, not what was sent.
#
# Why not `supabase config push`: that writes the whole [auth] section, which
# includes `site_url`. This PATCHes only the keys named below, so anything not
# listed here — Site URL, redirect allowlist, providers — is left exactly as it
# is. See the SCOPE note in supabase/config.toml.
#
# Usage:
#   export SUPABASE_ACCESS_TOKEN=sbp_...   # https://supabase.com/dashboard/account/tokens
#   ./scripts/configure-auth-email.sh
#
# RESEND_API_KEY and BUDGETIT_MAIL_FROM are read from .env.local.

set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT_REF="$(cat supabase/.temp/project-ref 2>/dev/null || true)"

# shellcheck disable=SC1091
[ -f .env.local ] && { set -a; . ./.env.local; set +a; }

fail() { echo "error: $1" >&2; exit 1; }

[ -n "${SUPABASE_ACCESS_TOKEN:-}" ] || fail "SUPABASE_ACCESS_TOKEN is not set. Create one at https://supabase.com/dashboard/account/tokens"
[ -n "$PROJECT_REF" ] || fail "No linked project. Run 'supabase link' first."
[ -n "${RESEND_API_KEY:-}" ] || fail "RESEND_API_KEY is not in .env.local"
[ -n "${BUDGETIT_MAIL_FROM:-}" ] || fail "BUDGETIT_MAIL_FROM is not in .env.local"

echo "Configuring project $PROJECT_REF to send as $BUDGETIT_MAIL_FROM…"

# The code goes in the subject as well as the body. A confirmation code is read
# off a notification banner far more often than it is read in an opened email,
# and a subject line that only says "Confirm your email" makes that impossible.
#
# With `mailer_secure_email_change_enabled` on, GoTrue renders this template
# twice and sends it to both addresses — one code for the address being left,
# one for the address being moved to. `{{ .Token }}` resolves to the code that
# belongs to whichever address the copy is being sent to.
#
# Naming both addresses in the body is what makes two near-identical emails
# tellable apart in an inbox. Without it the user has two 8-digit codes, no way
# to know which is which, and a 50% chance of typing them in the wrong order —
# which is exactly the friction that made this setting tempting to turn off.
read -r -d '' EMAIL_CHANGE_TEMPLATE <<'HTML' || true
<h2>Confirm your email change</h2>

<p>budgetit is moving from {{ .Email }} to {{ .NewEmail }}.</p>

<p>This code confirms the change from <strong>this</strong> inbox. The app asks
for both — one from each address — and tells you which it wants.</p>

<p style="font-size:30px;font-weight:700;letter-spacing:8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">{{ .Token }}</p>

<p>The code expires in an hour. If you didn't ask to change your email address, you can safely ignore this — nothing has changed yet.</p>
HTML

# Signup confirmation. Needed the moment `mailer_autoconfirm` goes false: the
# stock template mails `{{ .ConfirmationURL }}`, which points at Site URL —
# localhost on a fresh project, and a page this app does not host on any other.
# sign-in.tsx asks for a typed code instead, so the mail has to carry one.
read -r -d '' CONFIRMATION_TEMPLATE <<'HTML' || true
<h2>Confirm your email address</h2>

<p>Enter this code in the budgetit app to finish creating your account:</p>

<p style="font-size:30px;font-weight:700;letter-spacing:8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">{{ .Token }}</p>

<p>The code expires in an hour. If you didn't sign up for budgetit, you can safely ignore this — the account stays unconfirmed and unusable.</p>
HTML

# The reset flow is codes too, and this template is the only thing that makes it
# so. `resetPasswordForEmail` in src/data/auth.tsx sends whatever the Reset
# Password template says; Supabase ships that template with
# `{{ .ConfirmationURL }}`, which mails a *link* — while reset-password.tsx sits
# there asking for digits. Nothing in the client can detect that mismatch, so it
# reads as "the code from the email doesn't work".
#
# Kept here rather than only in the dashboard so the two templates below are the
# copy of record: a re-link, a restored project or a second environment would
# otherwise come back with the stock link template and no sign anything moved.
read -r -d '' RECOVERY_TEMPLATE <<'HTML' || true
<h2>Reset your password</h2>

<p>Enter this code in the budgetit app to choose a new password:</p>

<p style="font-size:30px;font-weight:700;letter-spacing:8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">{{ .Token }}</p>

<p>The code expires in an hour. If you didn't ask to reset your password, you can safely ignore this email.</p>
HTML

URL="https://api.supabase.com/v1/projects/$PROJECT_REF/config/auth"
RESPONSE="$(mktemp)"
trap 'rm -f "$RESPONSE"' EXIT

# A 400 from this endpoint carries the reason in the body, and the reason is
# usually a single field. Printing it is the difference between one more run and
# an afternoon of bisecting the payload by hand — the first version of this
# script threw the body away and reported the *error* object as if it were the
# settings, which showed up as every field being null.
patch_config() {
  local label="$1" body="$2" code
  code="$(curl -sS -X PATCH "$URL" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$body" -o "$RESPONSE" -w '%{http_code}')"

  if [ "$code" -ge 200 ] && [ "$code" -lt 300 ]; then
    echo "  $label — ok"
    return 0
  fi

  echo "  $label — FAILED (HTTP $code)" >&2
  jq . "$RESPONSE" 2>/dev/null || cat "$RESPONSE"
  echo >&2
  return 1
}

# jq builds the bodies so the template's quotes and newlines are escaped
# properly. Hand-rolled JSON would break the first time the copy gained an
# apostrophe.
SMTP_BODY="$(jq -n \
  --arg from "$BUDGETIT_MAIL_FROM" \
  --arg pass "$RESEND_API_KEY" \
  --arg template "$EMAIL_CHANGE_TEMPLATE" \
  --arg recovery "$RECOVERY_TEMPLATE" \
  --arg confirmation "$CONFIRMATION_TEMPLATE" \
  '{
    smtp_host: "smtp.resend.com",
    smtp_port: "587",
    smtp_user: "resend",
    smtp_pass: $pass,
    smtp_admin_email: $from,
    smtp_sender_name: "budgetit",

    # Two codes, one to each address. This is the server-side half of "a stolen
    # session cannot move the account" — the current-password prompt in
    # account/email.tsx runs in the app and anyone sending the request directly
    # skips it. account/email.tsx walks the two codes as two labelled steps.
    mailer_secure_email_change_enabled: true,

    mailer_subjects_email_change: "{{ .Token }} is your budgetit confirmation code",
    mailer_templates_email_change_content: $template,

    mailer_subjects_recovery: "{{ .Token }} is your budgetit reset code",
    mailer_templates_recovery_content: $recovery,

    # Accounts must prove they own the address. sign-in.tsx already handles the
    # session-less signUp response as a typed-code step.
    mailer_autoconfirm: false,
    mailer_subjects_confirmation: "{{ .Token }} is your budgetit confirmation code",
    mailer_templates_confirmation_content: $confirmation,

    # EMAIL_CODE_LENGTH in src/data/auth.tsx has to equal this, and the input
    # caps typing at that many characters — so a project left on 6 silently
    # truncates an 8-digit code, and one moved to 10 makes the last two
    # untypeable. Pinning it here rather than trusting the project default is
    # what keeps the two from drifting apart unnoticed.
    mailer_otp_length: 8
  }')"

# The account-security settings, sent separately from SMTP so that a rejection
# here — these are the fields most likely to be gated by plan or to have moved
# names — cannot take the mail configuration down with it.
#
# `password_min_length` must equal MIN_PASSWORD_LENGTH in src/lib/password.ts.
# `..._require_reauthentication` is what makes the current-password prompt in
# account/password.tsx mean anything to a caller who is not using the app;
# changePassword() handles both the nonce and no-nonce answers, so this can be
# flipped without a client release.
POLICY_BODY='{
  "password_min_length": 12,
  "password_required_characters": "",
  "security_update_password_require_reauthentication": true
}'

# Sent separately, and second, on purpose. Supabase only permits this above 2
# once custom SMTP is configured, so bundled into the call that configures SMTP
# it can be validated against the project's *previous* state and rejected — the
# whole request with it, including the SMTP settings that were fine.
RATE_BODY='{ "rate_limit_email_sent": 30 }'

patch_config "SMTP, code templates, dual-confirm email change, 8-digit codes" "$SMTP_BODY"
patch_config "Password policy and reauthentication" "$POLICY_BODY"
patch_config "Email rate limit (30/hour)" "$RATE_BODY" || true

echo
echo "Read back from the server:"
curl -sS "$URL" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -o "$RESPONSE"
jq '{
  smtp_host, smtp_port, smtp_user, smtp_admin_email, smtp_sender_name,
  mailer_secure_email_change_enabled,
  mailer_autoconfirm,
  mailer_subjects_email_change,
  mailer_subjects_recovery,
  mailer_subjects_confirmation,
  mailer_otp_length,
  password_min_length,
  security_update_password_require_reauthentication,
  rate_limit_email_sent
}' "$RESPONSE"

# The templates are long, so the readback above only names their subjects.
# Checking that each one carries {{ .Token }} and not {{ .ConfirmationURL }} is
# the part that actually decides whether the code flows work.
for field in \
  mailer_templates_email_change_content \
  mailer_templates_recovery_content \
  mailer_templates_confirmation_content
do
  if jq -e --arg f "$field" '.[$f] // "" | contains("{{ .Token }}")' "$RESPONSE" >/dev/null; then
    echo "  $field — sends a code"
  else
    echo "  $field — NOT a code template; the app's typed-code screen will not work" >&2
  fi
done

# The settings the app cannot detect for itself. A client running against a
# project with these off looks like it is enforcing them — every prompt still
# appears — while the server accepts requests that skip the prompts entirely.
# That is the failure this whole script exists to make visible.
echo
echo "Account security:"
check_flag() {
  local field="$1" want="$2" label="$3" got
  # `has` rather than `// "unset"`. jq's alternative operator treats `false` as
  # empty exactly like `null`, so `.mailer_autoconfirm // "unset"` reports a
  # correctly-disabled flag as missing — which is the one value this check most
  # needs to read, since two of the four settings below are meant to be false.
  got="$(jq -r --arg f "$field" 'if has($f) and .[$f] != null then .[$f] else "unset" end' "$RESPONSE")"
  if [ "$got" = "$want" ]; then
    echo "  $label — ok ($got)"
  else
    echo "  $label — WRONG (expected $want, got $got)" >&2
  fi
}
check_flag mailer_secure_email_change_enabled true \
  "Email change confirmed from both addresses"
check_flag security_update_password_require_reauthentication true \
  "Password change requires reauthentication"
check_flag mailer_autoconfirm false \
  "Signups must confirm their address"
check_flag password_min_length 12 \
  "Minimum password length (MIN_PASSWORD_LENGTH in src/lib/password.ts)"
