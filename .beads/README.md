# Beads (`br`) in this repo

This project tracks non-trivial multi-step work as **beads** using the `br` CLI
(beads_rust). The bead database lives in `.beads/` with issue prefix `ao`.

## Conventions

- One bead per coherent unit of work; link dependencies with `br dep add <issue> <depends-on>`.
- `br` **never runs git**. After changing beads, export and commit yourself:

```sh
br sync --flush-only          # write the DB out to .beads/issues.jsonl
git add .beads/ && git commit -m "chore(beads): update"
```

## Common commands

```sh
br ready                      # beads with no open blockers (start here)
br list                       # all beads
br show <id>                  # full bead detail
br update <id> --status in_progress
br close <id> --reason "Done"
br dep cycles                 # must stay empty
bv --robot-next               # pick the next bead to work (never run bare `bv`)
```

## Active epic

`ao-gpx` — Auto-Org + Analysis Categories via Gemini Embedding 2: auto-file
unscoped session-auth ingests under a Project (Focus Area) using a
domain-agnostic Analysis Category taxonomy and `gemini-embedding-2` multimodal
embeddings (`@google/genai`).
