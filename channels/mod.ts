/**
 * @fileoverview The built-in channels and their registration.
 *
 * `registerBuiltInChannels` wires the mail / database / log / broadcast channels
 * plus the SMS/Slack stubs onto a manager. Each backing package is soft-loaded
 * **on first use** through the `tryImport` seam — a log-only app loads neither
 * mail, sse, queue, nor drizzle (SC-002).
 *
 * @module @lockness/notification/channels
 */

import { container } from '@lockness/container'
import type { ChannelManager } from '../manager.ts'
import { getNotificationConfig } from '../config.ts'
import { type ModuleImporter, tryImport } from '../optional.ts'
import { LogChannel, type LoggerLike } from './log.ts'
import { type MailBuilder, MailChannel } from './mail.ts'
import { DatabaseChannel } from './database.ts'
import type { InsertableDb } from './database.ts'
import { BroadcastChannel, type BroadcasterLike } from './broadcast.ts'
import { SlackChannel, SmsChannel } from './stubs.ts'

export { LogChannel, type LoggerLike } from './log.ts'
export { type MailBuilder, MailChannel, type MailContent } from './mail.ts'
export {
    BroadcastChannel,
    type BroadcastContent,
    type BroadcasterLike,
} from './broadcast.ts'
export {
    DatabaseChannel,
    type DatabaseChannelDeps,
    type InsertableDb,
} from './database.ts'
export {
    ProviderNotConfiguredError,
    SlackChannel,
    SmsChannel,
} from './stubs.ts'

/** Options for {@link registerBuiltInChannels}. */
export interface BuiltInChannelOptions {
    /**
     * The per-client broadcaster (an app SSE channel). The broadcast channel is
     * registered only when this is supplied — the framework cannot invent the
     * app's live connections.
     */
    broadcaster?: BroadcasterLike
    /**
     * Override the module importer used to soft-load each channel's backing
     * package. Defaults to dynamic `import`; a test injects a fake to assert
     * which backing packages a given fan-out actually loads (SC-002).
     */
    importer?: ModuleImporter
}

/** The soft-loaded `@lockness/logger` shape used by the log channel. */
interface LoggerModule {
    Logger: new () => LoggerLike
}

/** The soft-loaded `@lockness/mail` shape used by the mail channel. */
interface MailModule {
    mail(): MailBuilder
}

/** The soft-loaded `@lockness/drizzle` shape used by the database channel. */
interface DrizzleModule {
    Database: new () => { db: InsertableDb }
}

/**
 * Register the built-in channels on a manager.
 *
 * The stubs are always registered; the mail/log/database channels resolve their
 * backing package lazily on first use; the broadcast channel is registered only
 * when a broadcaster is supplied.
 *
 * @param manager - The manager to register on.
 * @param options - Optional wiring (e.g. the broadcaster).
 *
 * @example
 * ```ts
 * registerBuiltInChannels(defaultManager, { broadcaster: sseChannel })
 * ```
 */
export function registerBuiltInChannels(
    manager: ChannelManager,
    options: BuiltInChannelOptions = {},
): void {
    const importer = options.importer

    // Log — soft-loads @lockness/logger on first log, and only then.
    manager.register(
        new LogChannel(async () => {
            const mod = await tryImport<LoggerModule>(
                '@lockness/logger',
                'log',
                importer,
            )
            return new mod.Logger()
        }),
    )

    // Mail — soft-loads @lockness/mail on first mail.
    manager.register(
        new MailChannel(async () => {
            const mod = await tryImport<MailModule>(
                '@lockness/mail',
                'mail',
                importer,
            )
            return mod.mail()
        }),
    )

    // Database — soft-loads @lockness/drizzle on first db write; the table comes
    // from configureNotifications, the Database token from the loaded module.
    manager.register(
        new DatabaseChannel({
            resolveDb: async () => {
                const mod = await tryImport<DrizzleModule>(
                    '@lockness/drizzle',
                    'database',
                    importer,
                )
                return container.get<{ db: InsertableDb }>(mod.Database).db
            },
            resolveTable: () => getNotificationConfig().databaseTable,
        }),
    )

    // Broadcast — only when the app supplies its live SSE channel.
    if (options.broadcaster) {
        manager.register(new BroadcastChannel(options.broadcaster))
    }

    // Stubs — always present so `via()` can name them; they throw until wired.
    manager.register(new SmsChannel())
    manager.register(new SlackChannel())
}
