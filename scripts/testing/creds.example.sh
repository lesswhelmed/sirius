# Copy this file to `.creds.local` (gitignored) and fill in real values.
# Each script in this folder sources `.creds.local` via `_lib.sh`.
export TEST_EMAIL="you@example.com"
export TEST_PASSWORD="change-me"
export TEST_NAME="Test User"

# Second user, used only by scoping-audit.sh to prove cross-user data isolation.
# Bootstrap a second verified account (see bootstrap-user.sh) and fill these in.
export TEST_EMAIL_B="other@example.com"
export TEST_PASSWORD_B="change-me-too"

export BASE_URL="${BASE_URL:-http://localhost:3000}"
export TEST_SESSION="${TEST_SESSION:-sirius}"
