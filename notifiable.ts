/**
 * @fileoverview The `Notifiable` contract — a recipient that resolves its own
 * per-channel address.
 *
 * A channel never reads `user.email` directly; it asks the notifiable through
 * {@link Notifiable.routeNotificationFor}. This keeps "where a notification is
 * delivered" a decision of the recipient, not of the channel.
 *
 * @module @lockness/notification/notifiable
 */

/**
 * A recipient of notifications.
 *
 * The one required method resolves the recipient's address for a given channel
 * — an email for `mail`, a phone number for `sms`, a per-user SSE channel id for
 * `broadcast`. Returning `null` means "this recipient has no address for that
 * channel", and the channel is skipped (not an error).
 *
 * @example
 * ```ts
 * class User implements Notifiable {
 *     constructor(readonly id: number, readonly email: string) {}
 *     routeNotificationFor(channel: string): unknown | null {
 *         if (channel === 'mail') return this.email
 *         if (channel === 'broadcast') return `notifications:user:${this.id}`
 *         return null
 *     }
 * }
 * ```
 */
export interface Notifiable {
    /**
     * Resolve this recipient's address for a channel.
     *
     * @param channel - The channel name (e.g. `'mail'`, `'broadcast'`).
     * @returns The channel-specific route, or `null` to skip this channel.
     */
    routeNotificationFor(channel: string): unknown | null
}

/**
 * A {@link Notifiable} that can be the target of a **queued** notification.
 *
 * Queued delivery serialises identifiers only — the notifiable is rehydrated by
 * its id inside the job's `handle()` (never serialised whole, since a live
 * object with methods cannot be JSON-encoded). A notifiable therefore needs a
 * stable identifier to be enqueueable.
 *
 * @example
 * ```ts
 * class User implements QueueableNotifiable {
 *     constructor(readonly id: number) {}
 *     routeNotificationFor(channel: string): unknown | null { ... }
 *     notifiableId(): string | number { return this.id }
 * }
 * ```
 */
export interface QueueableNotifiable extends Notifiable {
    /**
     * A stable identifier used to rehydrate this recipient in a queued job.
     *
     * @returns The recipient's persistent id.
     */
    notifiableId(): string | number
}

/**
 * Narrow a {@link Notifiable} to a {@link QueueableNotifiable}.
 *
 * @param notifiable - The recipient to test.
 * @returns `true` when the recipient exposes a `notifiableId()` method.
 */
export function isQueueable(
    notifiable: Notifiable,
): notifiable is QueueableNotifiable {
    return typeof (notifiable as QueueableNotifiable).notifiableId ===
        'function'
}
