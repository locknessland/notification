/**
 * @fileoverview The log channel — writes a **bounded summary** through
 * `@lockness/logger` (security S3).
 *
 * By default it logs `{ notification type, notifiable id, channels }` only —
 * never the rendered payload. A notification may supply a `toLog()` shape;
 * user-derived strings are passed through `safeForLog` (log-injection control).
 *
 * @module @lockness/notification/channels/log
 */

import { safeForLog } from '@lockness/contract'
import type { Channel } from '../channel.ts'
import type { Notification } from '../notification.ts'
import type { Notifiable } from '../notifiable.ts'
import { readBuilder } from './builder.ts'

/**
 * The minimal logger shape the channel depends on — a structural mirror of
 * `@lockness/logger`'s `Logger` (A-F2). Kept to the two methods used.
 */
export interface LoggerLike {
    /** Log at info level. */
    info(message: string, meta?: unknown): void
    /** Log at error level. */
    error(message: string, meta?: unknown): void
}

/**
 * Logs a bounded summary of each notification.
 *
 * @example
 * ```ts
 * manager.register(new LogChannel(logger))
 * ```
 */
export class LogChannel implements Channel {
    readonly name = 'log'
    private cachedLogger?: LoggerLike

    /**
     * @param provider - The backing logger, or a factory that resolves it (so
     *   production can soft-load `@lockness/logger` on first use, keeping a
     *   log-only app from loading anything else). A test passes a fake directly.
     */
    constructor(
        private readonly provider:
            | LoggerLike
            | (() => Promise<LoggerLike>),
    ) {}

    /** Resolve (and cache) the backing logger. */
    private async logger(): Promise<LoggerLike> {
        if (typeof this.provider === 'function') {
            this.cachedLogger ??= await this.provider()
            return this.cachedLogger
        }
        return this.provider
    }

    /**
     * Log the bounded summary for a notification.
     *
     * @param notification - The notification being delivered.
     * @param notifiable - The recipient.
     * @param route - The recipient's `log` route — used as the summary's
     *   notifiable id.
     */
    async send(
        notification: Notification,
        notifiable: Notifiable,
        route: unknown,
    ): Promise<void> {
        const channels = notification.via(notifiable)
        const type = notification.notificationClass()
        // The opt-in shape is bounded too: it is logged under `detail`, not
        // spread into the summary, so a `toLog()` cannot smuggle the payload in.
        const detail = readBuilder<unknown>(notification, 'toLog', notifiable)

        const logger = await this.logger()
        logger.info(
            `notification ${safeForLog(type)} → [${channels.join(', ')}] for ${
                safeForLog(String(route))
            }`,
            { type, notifiableId: route, channels, detail },
        )
    }
}
