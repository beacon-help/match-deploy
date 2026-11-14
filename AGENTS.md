# AGENTS

## Ignored Files

- Never read, edit, print or copy files matched by `.agentsignore` (same syntax as `.gitignore`). They hold private values such as AWS account IDs.
- Running a command that loads them is fine, e.g. `make deploy-stack` reading `.env`. Do not echo their contents in output or messages.

## Git Commit Rules

- Author and committer are the repo's configured git user. Commit messages and PR descriptions carry no attribution or co-author lines.
- Keep commit messages concise: a short imperative subject line, body only when it adds something the diff doesn't.
- Commit or push only when the user asks.
