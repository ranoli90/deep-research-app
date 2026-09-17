# Search policy observation — 2026-09-17

Read-only public documentation lookup; no provider completion or paid search.

[Official plugin documentation](https://openrouter.ai/docs/guides/features/plugins/web-search) describes a single search before generation, selectable engines, result limits and engine-specific pricing. Leaving the engine unspecified can select native search or Exa. [Server-tool documentation](https://openrouter.ai/docs/guides/features/server-tools/web-search) describes a different model-directed mechanism. Their pricing descriptions differ; do not substitute one mechanism's allowance assumptions for the other.

This checkpoint changes only local transport handling. The existing request still leaves engine selection unspecified. Explicit processor disclosure, pinned route, enforceable cost ceiling, current authorized balance and a registered small live probe remain necessary before activating structured discovery. Documentation is not proof of actual behavior or permission to spend.

Subsequent implementation: public-discovery.v1 explicitly selects the Exa auto plugin and OpenAI provider, adds consent2026-09-17.1 and defaults off. Reservation28658microUSD uses the plugin page’s7000microUSD single-search fee plus model ceiling21658. This has not been validated against a paid invoice; tariff change/actual billing remain live gates. Legacy adapter policy remains separate.
