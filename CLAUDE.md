# CLAUDE.md

Persistent instructions for Claude Code when working in this repository.

## Project overview

MealMind is a pantry management app built with Next.js, Supabase with
pgvector, Python agents using the Anthropic SDK, and TheMealDB via MCP
server. See README.md for full architecture.

## Branching convention

Every feature gets its own branch. Branch naming: `feature/[name]`,
`setup/[name]`, `docs/[name]`, `fix/[name]`. Every branch ends with a PR.
Never commit directly to main.

## Devlog

At the end of every PR — before the final commit — update DEVLOG.md with a
new entry. Cover: what was built, architectural decisions and why, bugs
found and fixed with full technical explanation. Write it for a technical
interviewer reading the public repo.

## Agent and model conventions

Haiku for all deterministic extraction tasks. Sonnet for all reasoning and
generation tasks. Document the reason for every model choice in code
comments.

## MCP conventions

MCP servers live in `mcp_servers/`. Use MCP for any external resource
shared across multiple agents or likely to change independently. Use
direct tool calls for one-off operations within a single agent.
