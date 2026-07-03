#!/bin/bash
# Stop-hook loop ("loop mission"): while .claude/loop-mission.flag exists, every
# attempt to stop is blocked and the agent is re-fed the coordination mission
# (check agent-mail, coordinate with coworkers, keep shipping on main, spawn
# subagents with end-to-end specs). This is the hook equivalent of:
#   /loop check agent-mail ... stay focused on your mission ...
#
# Enable:  touch .claude/loop-mission.flag        (from the repo root)
# Disable: rm .claude/loop-mission.flag           (the agent is told it may do
#          this itself once the inbox is empty and no mission work remains)
# Cap:     50 iterations per session by default; override with a line
#          "max=N" inside the flag file. Per-session counters live in
#          .claude/.loop-mission-state/ (gitignored).
set -euo pipefail

input=$(cat)

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
flag="$root/.claude/loop-mission.flag"

# Loop not armed -> allow the stop.
[ -f "$flag" ] || exit 0

session_id=$(printf '%s' "$input" | jq -r '.session_id // "unknown"' | tr -cd 'a-zA-Z0-9_-')
[ -n "$session_id" ] || session_id="unknown"

state_dir="$root/.claude/.loop-mission-state"
mkdir -p "$state_dir"
count_file="$state_dir/$session_id.count"

count=0
[ -f "$count_file" ] && count=$(cat "$count_file" 2>/dev/null || echo 0)
case "$count" in *[!0-9]* | '') count=0 ;; esac
count=$((count + 1))
printf '%s' "$count" >"$count_file"

max=50
flag_max=$(grep -m1 -E '^max=[0-9]+$' "$flag" 2>/dev/null || true)
[ -n "$flag_max" ] && max="${flag_max#max=}"

if [ "$count" -gt "$max" ]; then
  jq -n --arg msg "loop-mission: reached max iterations ($max) for this session; allowing stop. Re-arm by deleting $count_file, or raise the cap with a 'max=N' line in .claude/loop-mission.flag." \
    '{systemMessage: $msg}'
  exit 0
fi

reason="LOOP MISSION — iteration $count/$max (this repo runs a multi-agent swarm; delete .claude/loop-mission.flag only when the mission is truly done, then stop):
1. Check your agent-mail inbox NOW (agent-mail MCP tools: fetch_inbox, reply_message, acknowledge_message). Cooperate and coordinate with coworkers before touching shared code.
2. Keep making real progress in the codebase. All work stays on the main branch — no side branches.
3. Do NOT tread on other coworkers: reserve files via agent-mail file reservations before editing, release them when done, and commit ONLY your own explicit paths (never 'git add -A').
4. Stay focused on your mission. For substantial work, spawn subagents with end-to-end specs covering planning -> execution -> review -> verification, and verify their results yourself before trusting them.
5. Only claim something worked after you actually verified it (run it, don't assume).
If your inbox is empty AND no mission work remains, delete .claude/loop-mission.flag and stop cleanly."

jq -n --arg r "$reason" '{decision: "block", reason: $r}'
exit 0
