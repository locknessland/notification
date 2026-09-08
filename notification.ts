/**
 * @fileoverview The `Notification` abstract base — what to send and to which
 * channels.
 *
 * A concrete notification declares its channels in {@link Notification.via} and
 * builds each channel's payload in an optional per-channel hook (`toMail`,
 * `toDatabase`, …) that the channel calls at delivery time. It may opt into
 * queued delivery by setting {@link Notification.queue}.
 *
 * @module @lockness/notification/notification
 */

import type { Notifiable } from './notifiable.ts'

/**
 * Base class for a notification.
 *
 * The only required member is {@link via}. Per-channel payload builders are
 * optional and looked up by each channel (e.g. the mail channel calls
 * `toMail(notifiable)` if present) — they are not declared on the base so that
 * a notification only implements the channels it actually uses.
 *
 * @example
 * ```ts
 * class InvoicePaid extends Notification {
 *     constructor(private readonly invoiceId: number) { super() }
 *     via(): string[] { return ['mail', 'database'] }
 *     toMail(user: User) { return new MailMessage(...) }
 *     toDatabase() { return { type: 'invoice_paid', invoiceId: this.invoiceId } }
 * }
 * ```
 */
export abstract class Notification {
    /**
     * When truthy, this notification is delivered through the queue rather than
     * inline: the manager enqueues **one** job whose `handle()` runs the whole
     * {@link via} fan-out. Requires a configured queue dispatcher and a
     * queueable notifiable.
     */
    readonly queue?: boolean

    /**
     * The channels this notification is delivered on for a given recipient.
     *
     * @param notifiable - The recipient (a notification may vary its channels
     *   by recipient — e.g. only `mail` for a user who opted out of SMS).
     * @returns The ordered list of channel names.
     */
    abstract via(notifiable: Notifiable): string[]

    /**
     * The class name used to rehydrate this notification in a queued job.
     *
     * Defaults to the constructor name; override only if the class is renamed
     * or minified and a stable registry key is needed.
     *
     * @returns The registry key for this notification class.
     */
    notificationClass(): string {
        return this.constructor.name
    }

    /**
     * The constructor payload persisted in a queued job — **identifiers only**,
     * never rendered per-channel content (which would put PII at rest in the
     * queue store and forever in the DLQ). The queued job rehydrates the
     * notification with this payload and re-renders inside `handle()`.
     *
     * Defaults to `undefined` (a no-argument notification). Override to return
     * the constructor arguments needed to reconstruct the notification.
     *
     * @returns The JSON-serialisable constructor payload, or `undefined`.
     */
    toQueue(): unknown {
        return undefined
    }
}
