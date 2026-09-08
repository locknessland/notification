/**
 * @fileoverview The `Channel` port — a delivery adapter for one channel name.
 *
 * The built-in channels (mail/database/log/broadcast) live in their own package
 * child and implement this port over a soft-loaded backing package. The manager
 * depends only on this structural port, never on a concrete channel.
 *
 * @module @lockness/notification/channel
 */

import type { Notification } from './notification.ts'
import type { Notifiable } from './notifiable.ts'

/**
 * A delivery adapter for a single channel.
 *
 * The manager resolves a channel by {@link Channel.name}, asks the notifiable
 * for its route, and — when the route is non-null — calls {@link Channel.send}.
 * A channel reads the notification's per-channel builder (e.g. `toMail`) itself.
 *
 * @example
 * ```ts
 * const logChannel: Channel = {
 *     name: 'log',
 *     send(notification, notifiable, route) { ... },
 * }
 * ```
 */
export interface Channel {
    /** The channel name matched against a notification's `via()` entries. */
    readonly name: string

    /**
     * Deliver a notification to one recipient over this channel.
     *
     * @param notification - The notification to deliver.
     * @param notifiable - The recipient.
     * @param route - The recipient's resolved route for this channel (non-null;
     *   the manager skips a channel whose route is null before calling `send`).
     * @returns Resolves when the channel has delivered (or rejects on failure —
     *   the manager isolates the failure and continues with the other channels).
     */
    send(
        notification: Notification,
        notifiable: Notifiable,
        route: unknown,
    ): void | Promise<void>
}
