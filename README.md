# AgentCtx

Open standard for local AI code context — graph schema, `.agentctx/` directory format, and the repo scanner that builds them.

**[Niryn](https://niryn.app)** is a commercial product that implements AgentCtx (desktop app, context packs, MCP integration). This repository is the auditable open core: what reads your repo and how the graph is stored.

## Packages

| Package | Description |
|---------|-------------|
| [`@niryn/agentctx-spec`](packages/agentctx-spec) | Types, Zod schemas, constants for `.agentctx/` |
| [`@niryn/scanner`](packages/scanner) | Parses repos → SQLite graph + JSON exports |

## Quick start

```bash
pnpm install
pnpm build
node -e "import('@niryn/scanner').then(m => m.scanProject(process.cwd()))" .
```

Or use the CLI from the private [Niryn](https://github.com/Salta1414/niryn) product repo (`niryn scan`).

## `.agentctx/` layout

```
.agentctx/
  config.json           # project config
  context.db            # SQLite graph (source of truth)
  current-context.md    # human-readable summary
  maps/symbols.json     # stable symbol refs for agents
  packs/latest.json     # last context pack (when generated)
```

Graph tables: `projects`, `files`, `symbols`, `features`, `relations`, `tests`, `dependencies`, `context_refs`, `recent_changes`.

## License

MIT — see [LICENSE](LICENSE).
