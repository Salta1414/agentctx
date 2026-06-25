# Claude Code Instructions

This project uses the AgentCtx standard (via Niryn).

Before editing code:
1. Read `.agentctx/current-context.md` (includes active decisions)
2. Use `POST localhost:47321/v1/context/pack` or MCP `get_context_pack`
3. Prefer the local graph API over broad repo search
4. Check `.agentctx/maps/symbols.json` for symbol locations
5. Check ref status — if `changed` or `outdated`, re-read source before editing
6. Capture chat decisions with MCP `record_decision` (e.g. provider or stack changes)

Fallback: read `.agentctx/packs/latest.json` if the local server is unavailable.
