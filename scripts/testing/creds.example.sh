# Copy this file to `.creds.local` (gitignored) and fill in real values.
# Each script in this folder sources `.creds.local` via `_lib.sh`.
export TEST_EMAIL="you@example.com"
export TEST_PASSWORD="change-me"
export TEST_NAME="Test User"

export BASE_URL="${BASE_URL:-http://localhost:3000}"
export TEST_SESSION="${TEST_SESSION:-sirius}"
