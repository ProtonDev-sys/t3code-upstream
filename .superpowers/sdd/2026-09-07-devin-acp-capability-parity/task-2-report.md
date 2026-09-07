# Task 2 report: sanitized ACP optional-content capture

## Result

Implemented test-only ACP capture in `DevinAcpCliProbe.test.ts` and added
`DevinOptionalContentFixtures.test.ts`. The installed Devin CLI emitted no
resource link, embedded resource, elicitation, or child-agent update during
the captured real ACP turn. The reviewable result is therefore:

```json
{ "status": "unsupported", "reason": "not-emitted-by-installed-devin-cli" }
```

No production logging, adapter behavior, MCP declaration, or other provider
was changed.

## Capture behavior

- Capture is opt-in with `T3_DEVIN_ACP_CAPTURE=1` and is wired only into the
  direct live Devin ACP probe.
- Only incoming decoded `session/update` and `session/elicitation` metadata is
  retained in memory.
- Stored fields are limited to method, bounded update/content type names, and
  a classification. Prompt text, authorization/session credentials, paths,
  environment values, blobs, IDs, and arbitrary payload fields are discarded.
- Each record is capped at 512 UTF-8 bytes and the in-memory capture is capped
  at 32 records.
- Optional fixture output is emitted only when capture is explicitly enabled
  or the live probe fails. Ordinary text and unrelated unsupported startup
  updates are not written as optional fixtures.

## Live evidence

Command:

```text
$env:T3_DEVIN_ACP_PROBE='1'; $env:T3_DEVIN_LIVE_TURN='1'; $env:T3_DEVIN_ACP_CAPTURE='1'; vp test run apps/server/src/provider/acp/DevinAcpCliProbe.test.ts -t "finishes a real Devin turn"
```

Result: exit 0; 1 test passed, 7 skipped. The sanitized capture observed only
`config_option_update`, `current_mode_update`, `available_commands_update`,
`session_info_update`, `usage_update`, and ordinary text chunks. No optional
classification was observed, so the emitted optional result was the explicit
unsupported object above.

The strict MCP smoke was also run once with capture enabled:

```text
$env:T3_DEVIN_ACP_PROBE='1'; $env:T3_DEVIN_MCP_SMOKE='1'; $env:T3_DEVIN_ACP_CAPTURE='1'; vp test run apps/server/src/provider/acp/DevinAcpCliProbe.test.ts
```

It failed at the pre-existing strict assertion
`expect(requests).toHaveLength(1)`: actual length was 0. This preserves the
Task 1 finding that the real Devin turn does not consume `t3-code`; no
workaround or weakened marker was added.

## Focused verification

```text
vp test run apps/server/src/provider/acp/DevinOptionalContentFixtures.test.ts apps/server/src/provider/acp/DevinAcpCliProbe.test.ts
```

Result: exit 0; 2 test files passed, 6 tests passed, 5 opt-in tests skipped.

Additional verification:

- `vp fmt --check` on both changed test files: passed.
- `git diff --check`: passed.
- The sanitizer tests prove sensitive values are absent, records are bounded,
  the in-memory capture is bounded, and known ACP content shapes classify
  deterministically.

## Scope and preserved state

Only the two requested ACP test files were changed for implementation. Existing
untracked user files were left untouched, including
`devin-upstream-port-conversation.md`, `docs/superpowers/plans/`, and the
unrelated discovery design file.
