#!/usr/bin/env bash
#
# Point the linked Supabase project's auth emails at Resend, and turn the email
# change confirmation into a typed code.
#
# Why a script rather than a walk through the dashboard: these four settings
# have to agree with each other and with the client, and three of them are on
# different pages. `mailer_secure_email_change_enabled` sends two codes instead
# of one when it is wrong, and the app's change-email screen only asks for one —
# a mismatch that looks like "the code is broken" rather than like a setting.
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
read -r -d '' EMAIL_CHANGE_TEMPLATE <<'HTML' || true
<h2>Confirm your new email address</h2>

<p>Enter this code in the budgetit app to finish moving your account to {{ .NewEmail }}:</p>

<p style="font-size:30px;font-weight:700;letter-spacing:8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">{{ .Token }}</p>

<p>The code expires in an hour. If you didn't ask to change your email address, you can safely ignore this — nothing has changed yet.</p>
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
  '{
    smtp_host: "smtp.resend.com",
    smtp_port: "587",
    smtp_user: "resend",
    smtp_pass: $pass,
    smtp_admin_email: $from,
    smtp_sender_name: "budgetit",

    # One code, sent to the new address only. The account password is already
    # required by changeEmail() in src/data/auth.tsx, which is what this leans
    # on — see the note in supabase/config.toml before turning it back on.
    mailer_secure_email_change_enabled: false,

    mailer_subjects_email_change: "{{ .Token }} is your budgetit confirmation code",
    mailer_templates_email_change_content: $template,

    mailer_subjects_recovery: "{{ .Token }} is your budgetit reset code",
    mailer_templates_recovery_content: $recovery,

    # EMAIL_CODE_LENGTH in src/data/auth.tsx has to equal this, and the input
    # caps typing at that many characters — so a project left on 6 silently
    # truncates an 8-digit code, and one moved to 10 makes the last two
    # untypeable. Pinning it here rather than trusting the project default is
    # what keeps the two from drifting apart unnoticed.
    mailer_otp_length: 8
  }')"

# Sent separately, and second, on purpose. Supabase only permits this above 2
# once custom SMTP is configured, so bundled into the call that configures SMTP
# it can be validated against the project's *previous* state and rejected — the
# whole request with it, including the SMTP settings that were fine.
RATE_BODY='{ "rate_limit_email_sent": 30 }'

patch_config "SMTP, code templates, single-code email change, 8-digit codes" "$SMTP_BODY"
patch_config "Email rate limit (30/hour)" "$RATE_BODY" || true

echo
echo "Read back from the server:"
curl -sS "$URL" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -o "$RESPONSE"
jq '{
  smtp_host, smtp_port, smtp_user, smtp_admin_email, smtp_sender_name,
  mailer_secure_email_change_enabled,
  mailer_subjects_email_change,
  mailer_subjects_recovery,
  mailer_otp_length,
  rate_limit_email_sent
}' "$RESPONSE"

# The templates are long, so the readback above only names their subjects.
# Checking that each one carries {{ .Token }} and not {{ .ConfirmationURL }} is
# the part that actually decides whether the code flows work.
for field in mailer_templates_email_change_content mailer_templates_recovery_content; do
  if jq -e --arg f "$field" '.[$f] // "" | contains("{{ .Token }}")' "$RESPONSE" >/dev/null; then
    echo "  $field — sends a code"
  else
    echo "  $field — NOT a code template; the app's typed-code screen will not work" >&2
  fi
done
