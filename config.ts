/**
 * @fileoverview `configureNotifications` — the single config home for
 * app-supplied notification settings.
 *
 * The database channel cannot ship a table (no schema fits every app), so the
 * app supplies its persistence target here; queued delivery needs a dispatcher
 * the app wires from `@lockness/queue`. Both live in one place rather than being
 * decided per-channel (decision table §5).
 *
 * @module @lockness/notification/config
 */

import { defaultManager, type QueueDispatcher } from './manager.ts'
import type { Notifiable } from './notifiable.ts'

/**
 * A minimal structural view of a Drizzle table used as the notifications
 * persistence target. Kept loose (not pinned to a dialect-specific type) so the
 * database channel stays dialect-agnostic (architecture A-F3).
 *
 * The app's table **must** carry a column for the notifiable's identity (the
 * owner) so a later "list my notifications" read can scope by owner (security
 * S2). This is documented rather than type-enforced — a Drizzle table's column
 * set is not statically known here.
 *
 * Typed `unknown`, not `any`: the only use site (`db.insert(table)`) already
 * takes `unknown`, so nothing is lost and hard rule #3 is honoured.
 */
export type NotificationsTable = unknown

/** App-supplied notification settings. */
export interface NotificationConfig {
    /**
     * The Drizzle table the database channel writes to. Must include the
     * notifiable-owner column (security S2). Required to use the database
     * channel; unset otherwise.
     */
    databaseTable?: NotificationsTable
    /**
     * The dispatcher enqueuing queued notifications (wired from
     * `@lockness/queue`). When set, it is installed on the default manager.
     */
    queueDispatcher?: QueueDispatcher
    /**
     * Rehydrate a notifiable by its id — used by the queue worker to reconstruct
     * the recipient of a queued notification (the job stores only the id).
     */
    resolveNotifiable?: (
        id: string | number,
    ) => Promise<Notifiable> | Notifiable
}

let current: NotificationConfig = {}

/**
 * Configure the notification system. Merges into the current config; a queue
 * dispatcher is also installed on the default manager.
 *
 * @param config - The settings to apply.
 *
 * @example
 * ```ts
 * configureNotifications({
 *     databaseTable: notificationsTable,
 *     queueDispatcher: (job) => queue.dispatch('notifications', job),
 * })
 * ```
 */
export function configureNotifications(config: NotificationConfig): void {
    current = { ...current, ...config }
    if (config.queueDispatcher) {
        defaultManager.setQueueDispatcher(config.queueDispatcher)
    }
}

/**
 * Read the current notification config (used by the database channel to resolve
 * its persistence target).
 *
 * @returns The current config.
 */
export function getNotificationConfig(): Readonly<NotificationConfig> {
    return current
}

/**
 * Reset the config to empty — test-only, so one test's `configureNotifications`
 * does not leak into the next.
 */
export function resetNotificationConfig(): void {
    current = {}
}
