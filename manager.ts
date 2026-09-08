/**
 * @fileoverview `ChannelManager` — resolves channel names to drivers and
 * dispatches a notification's fan-out, plus the single-homed queued-job
 * serialization contract.
 *
 * This is the one place that: iterates a notification's `via()`, isolates each
 * channel's failure, decides queued-vs-inline, and builds the identifiers-only
 * queued job. A second dispatch loop anywhere else duplicates this home
 * (decision table §5).
 *
 * @module @lockness/notification/manager
 */

import type { Channel } from './channel.ts'
import type { Notification } from './notification.ts'
import { isQueueable, type Notifiable } from './notifiable.ts'

/**
 * Raised when a notification's `via()` names a channel the manager does not
 * know. The message names the registered set so the miss is actionable.
 */
export class UnknownChannelError extends Error {
    /**
     * @param channel - The unknown channel name.
     * @param registered - The channel names currently registered.
     */
    constructor(channel: string, registered: readonly string[]) {
        super(
            `unknown notification channel "${channel}"; registered channels: ${
                registered.length ? registered.join(', ') : '(none)'
            }`,
        )
        this.name = 'UnknownChannelError'
    }
}

/**
 * Raised when a notification opts into queued delivery but no queue dispatcher
 * is configured.
 */
export class QueueNotConfiguredError extends Error {
    /**
     * @param notificationClass - The notification that asked to be queued.
     */
    constructor(notificationClass: string) {
        super(
            `notification "${notificationClass}" set queue=true but no queue dispatcher is configured; ` +
                'pass configureNotifications({ queueDispatcher }), wired from @lockness/queue',
        )
        this.name = 'QueueNotConfiguredError'
    }
}

/**
 * The serialised form of a queued notification — **identifiers only**.
 *
 * Never carries rendered per-channel content: the job rehydrates the notifiable
 * and notification from these identifiers and re-renders inside `handle()`
 * (security S5 / architecture A-F1).
 */
export interface QueuedNotificationJob {
    /** The recipient's stable id (see `QueueableNotifiable.notifiableId`). */
    readonly notifiableId: string | number
    /** The notification class registry key (see `Notification.notificationClass`). */
    readonly notificationClass: string
    /** The notification's constructor payload (see `Notification.toQueue`). */
    readonly constructorPayload: unknown
}

/**
 * A dispatcher that enqueues one {@link QueuedNotificationJob}. Wired to
 * `@lockness/queue` by the app (or the queue channel child); a test injects a
 * fake.
 *
 * @param job - The identifiers-only job to enqueue.
 */
export type QueueDispatcher = (
    job: QueuedNotificationJob,
) => void | Promise<void>

/** A single channel's delivery failure, isolated from the rest of the fan-out. */
export interface DeliveryFailure {
    /** The channel that failed. */
    readonly channel: string
    /** The error it raised. */
    readonly error: unknown
}

/** The outcome of a fan-out: what delivered, what was skipped, what failed. */
export interface DeliveryReport {
    /** Channels that delivered successfully. */
    readonly delivered: string[]
    /** Channels skipped because the notifiable had no route for them. */
    readonly skipped: string[]
    /** Channels whose delivery threw (isolated — did not abort the others). */
    readonly failures: DeliveryFailure[]
    /** `true` when the notification was enqueued instead of delivered inline. */
    readonly queued?: boolean
}

/** Options for a {@link ChannelManager}. */
export interface ChannelManagerOptions {
    /** The dispatcher used for queued notifications; omit to deliver inline only. */
    readonly queueDispatcher?: QueueDispatcher
}

/**
 * Build the identifiers-only queued job for a notification — the single home of
 * the serialization contract.
 *
 * @param notifiable - The recipient (must be queueable).
 * @param notification - The notification being queued.
 * @returns The identifiers-only job.
 * @throws {Error} When the notifiable exposes no `notifiableId()`.
 */
function buildQueuedJob(
    notifiable: Notifiable,
    notification: Notification,
): QueuedNotificationJob {
    if (!isQueueable(notifiable)) {
        throw new Error(
            `cannot queue notification "${notification.notificationClass()}": ` +
                'the notifiable has no notifiableId() to rehydrate it by ' +
                '(implement QueueableNotifiable, or deliver it inline)',
        )
    }
    return {
        notifiableId: notifiable.notifiableId(),
        notificationClass: notification.notificationClass(),
        constructorPayload: notification.toQueue(),
    }
}

/**
 * Resolves channels and dispatches notifications.
 *
 * @example
 * ```ts
 * const manager = new ChannelManager()
 * manager.register(mailChannel)
 * await manager.send(user, new InvoicePaid(7))
 * ```
 */
export class ChannelManager {
    private readonly channels = new Map<string, Channel>()
    private queueDispatcher?: QueueDispatcher

    /**
     * @param options - Manager options (e.g. a queue dispatcher).
     */
    constructor(options: ChannelManagerOptions = {}) {
        this.queueDispatcher = options.queueDispatcher
    }

    /**
     * Register a channel driver under its name (replacing any existing one).
     *
     * @param channel - The channel adapter to register.
     */
    register(channel: Channel): void {
        this.channels.set(channel.name, channel)
    }

    /**
     * Set (or replace) the queue dispatcher after construction — used when the
     * queue backing package is wired lazily.
     *
     * @param dispatcher - The dispatcher to use for queued notifications.
     */
    setQueueDispatcher(dispatcher: QueueDispatcher): void {
        this.queueDispatcher = dispatcher
    }

    /** The registered channel names, in insertion order. */
    registeredChannels(): string[] {
        return [...this.channels.keys()]
    }

    /**
     * Deliver a notification to a recipient.
     *
     * When the notification opts into queuing, enqueues one identifiers-only
     * job and returns early. Otherwise fans out over `via()`: each channel is
     * resolved (unknown → {@link UnknownChannelError}), the route resolved (null
     * → skipped), and delivered in isolation (one throw does not abort the rest).
     *
     * @param notifiable - The recipient.
     * @param notification - The notification to deliver.
     * @returns A report of what delivered, was skipped, failed, or was queued.
     * @throws {UnknownChannelError} When `via()` names an unregistered channel.
     * @throws {QueueNotConfiguredError} When queued but no dispatcher is set.
     */
    async send(
        notifiable: Notifiable,
        notification: Notification,
    ): Promise<DeliveryReport> {
        if (notification.queue) {
            if (!this.queueDispatcher) {
                throw new QueueNotConfiguredError(
                    notification.notificationClass(),
                )
            }
            await this.queueDispatcher(buildQueuedJob(notifiable, notification))
            return { delivered: [], skipped: [], failures: [], queued: true }
        }

        return await this.deliverInline(notifiable, notification)
    }

    /**
     * The inline fan-out — also the body a queued job's `handle()` runs after
     * rehydration. It never reads the notification's `queue` flag, so a queued
     * job delivers here directly without re-enqueuing.
     *
     * @param notifiable - The recipient.
     * @param notification - The notification to deliver.
     * @returns The delivery report.
     */
    async deliverInline(
        notifiable: Notifiable,
        notification: Notification,
    ): Promise<DeliveryReport> {
        const delivered: string[] = []
        const skipped: string[] = []
        const failures: DeliveryFailure[] = []

        for (const name of notification.via(notifiable)) {
            const channel = this.channels.get(name)
            if (!channel) {
                throw new UnknownChannelError(name, this.registeredChannels())
            }

            const route = notifiable.routeNotificationFor(name)
            if (route === null || route === undefined) {
                skipped.push(name)
                continue
            }

            try {
                await channel.send(notification, notifiable, route)
                delivered.push(name)
            } catch (error) {
                failures.push({ channel: name, error })
            }
        }

        return { delivered, skipped, failures }
    }
}

/**
 * The process-wide default manager used by {@link notify}. The built-in
 * channels register themselves on it (channels child); the app wires the queue
 * dispatcher through `configureNotifications`.
 */
export const defaultManager: ChannelManager = new ChannelManager()

/**
 * Deliver a notification to a recipient through the default manager.
 *
 * @param notifiable - The recipient.
 * @param notification - The notification to deliver.
 * @returns The delivery report.
 *
 * @example
 * ```ts
 * await notify(user, new InvoicePaid(7))
 * ```
 */
export function notify(
    notifiable: Notifiable,
    notification: Notification,
): Promise<DeliveryReport> {
    return defaultManager.send(notifiable, notification)
}
