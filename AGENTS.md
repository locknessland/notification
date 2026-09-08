# `@lockness/notification` — agent brief

Multi-channel notification delivery. One `Notification` class declares its
channels (`via()`) and per-channel payloads; a `Notifiable` resolves its own
per-channel address; the `ChannelManager` fans out over the channels. Each
channel's backing package is **soft-loaded on demand** — a log-only app pulls
none of mail/queue/sse/drizzle.

## Invariants

- **The dependency contract below is binding.** Importing anything outside it
  fails `deno task deps:analyze`.
- **No static / `import type` / literal-dynamic import of a backing package.**
  Every backing package (`@lockness/mail`, `queue`, `logger`, `sse`, `drizzle`)
  loads through the one `tryImport(name, channel)` in `optional.ts`, with a
  **variable** specifier — the only spelling `deps:analyze` treats as `soft`. A
  literal `import('@lockness/mail')` hardens the edge and fails the gate.
- **One channel's failure never aborts the fan-out.** `ChannelManager.send`
  isolates each channel and reports failures; a null route skips only that
  channel.
- **Broadcast is scoped to the notifiable's own connection.** The broadcast
  channel uses a per-notifiable channel/clientId from
  `routeNotificationFor('broadcast')` and `channel.send(clientId, …)` — never
  `SSEChannel.broadcast()` on a shared channel (cross-user disclosure, S1).
- **The log channel logs a bounded summary, not the payload.** Type + notifiable
  id + channels by default; user-derived strings via `safeForLog` (S3).
- **Queued delivery serialises identifiers only.** One job carrying
  `{ notifiableId, notificationClass, constructorPayload }` — never rendered
  per-channel content (PII at rest / DLQ, S5). The contract lives once in
  `manager.ts`.
- **The database channel ships no table.** The app supplies it via
  `configureNotifications({ databaseTable })`; the row must carry the notifiable
  owner column (S2). The `Database` token comes from the soft-loaded drizzle
  module, typed dialect-agnostically (A-F3).
- **No `any` in exported signatures** (dynamically-loaded modules typed by
  minimal structural interfaces); JSDoc on every export; no direct `hono`
  import.

## Dependency contract

<!-- generated:deps -->

| Direction                                      | Packages                                    |
| :--------------------------------------------- | :------------------------------------------ |
| Imports (static)                               | `container`, `contract`                     |
| Imports (soft, via `tryImportOptionalPackage`) | `drizzle`, `logger`, `mail`, `queue`, `sse` |
| Imported by                                    | —                                           |
| **Must never import**                          | nothing — no package depends on this one    |

Enforced by `deno task deps:analyze` against `deps.policy.jsonc`. A soft edge is
deliberately **not** declared in this package's `deno.json`: the consuming
application installs it, or the feature stays off.

<!-- /generated:deps -->

## Public surface

<!-- generated:surface -->

| Kind      | Exports                                                                                                                                                                                                                                                                                                                                                            |
| :-------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| class     | `BroadcastChannel`, `ChannelManager`, `ChannelPackageMissingError`, `DatabaseChannel`, `LogChannel`, `MailChannel`, `Notification`, `ProviderNotConfiguredError`, `QueueNotConfiguredError`, `QueuedDeliveryError`, `SlackChannel`, `SmsChannel`, `UnknownChannelError`                                                                                            |
| function  | `configureNotifications`, `createFile`, `getNotificationConfig`, `getNotificationFactory`, `handleMakeNotification`, `handleNotificationJob`, `isQueueable`, `notificationNaming`, `notify`, `processStub`, `registerBuiltInChannels`, `registerNotification`, `registerNotificationCommands`, `resetNotificationConfig`, `resetNotificationRegistry`, `tryImport` |
| interface | `BroadcastContent`, `BroadcasterLike`, `BuiltInChannelOptions`, `Channel`, `ChannelManagerOptions`, `Cli`, `DatabaseChannelDeps`, `DeliveryFailure`, `DeliveryReport`, `HandleJobOptions`, `InsertableDb`, `LoggerLike`, `MailBuilder`, `MailContent`, `Notifiable`, `NotificationConfig`, `QueueableNotifiable`, `QueuedNotificationJob`                          |
| typeAlias | `ModuleImporter`, `NotificationFactory`, `NotificationsTable`, `QueueDispatcher`                                                                                                                                                                                                                                                                                   |
| variable  | `defaultManager`                                                                                                                                                                                                                                                                                                                                                   |

Anything not listed is internal and free to change.

<!-- /generated:surface -->

## Where to work

| Task                                             | File                                                                            |
| :----------------------------------------------- | :------------------------------------------------------------------------------ |
| The abstraction (base / contract / dispatch)     | `notification.ts`, `notifiable.ts`, `manager.ts`                                |
| The soft-load seam                               | `optional.ts` (one `tryImport`; hoist to `contract` on a 3rd soft-loader)       |
| App-supplied config (db table, queue dispatcher) | `config.ts`                                                                     |
| The built-in channels                            | `channels/` (mail/database/log/broadcast + SMS/Slack stubs)                     |
| `make:notification` scaffold                     | `cli_commands.ts` + `stubs/` (scaffold logic → `generators/` on a 2nd `make:*`) |

## Pitfalls

- A backing package's payload shape is **mirrored** locally with no compile-time
  link (the priced cost of all-soft, A-F2). A backing-package shape change is
  invisible here and surfaces at runtime in the adapter cast — a mirror-vs-real
  assertion in the channel test flags drift.
- Nothing imports `notification` (it is a pure sink), so it cannot close a cycle
  — keep it that way.

## Tests

<!-- generated:tests -->

9 test files for 16 source files:

- `packages/notification/tests/channels/broadcast.test.ts`
- `packages/notification/tests/channels/database.test.ts`
- `packages/notification/tests/channels/log.test.ts`
- `packages/notification/tests/channels/mail.test.ts`
- `packages/notification/tests/cli_commands.test.ts`
- `packages/notification/tests/manager.test.ts`
- `packages/notification/tests/optional.test.ts`
- `packages/notification/tests/queued.test.ts`
- `packages/notification/tests/wiring.test.ts`

<!-- /generated:tests -->

## Before you call it done

<!-- generated:gate -->

The framework-wide gate, from the repository root:

```bash
deno fmt && deno lint && deno check && deno task test
deno task deps:analyze     # cycles, declaration drift, tier policy
deno task agents:brief     # refresh this file's generated blocks
```

Then, specific to this package: run its 9 test files directly —

```bash
deno test -A packages/notification/
```

<!-- /generated:gate -->

---

_Framework-wide rules live in the root [AGENTS.md](../../AGENTS.md). The
dependency contract, public surface, tests and closing gate are generated by
`deno task agents:brief` from the code itself — fix the code, not those blocks.
Everything else is hand-written and preserved._
