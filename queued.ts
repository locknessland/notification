/**
 * @fileoverview Queued delivery — the notification registry and the job handler
 * that rehydrates + re-renders a queued notification (FR-007).
 *
 * The enqueue side (building the identifiers-only job) lives in `manager.ts`;
 * this module is the receive side. The job carries identifiers only, so the
 * worker must reconstruct the notification (from its registered factory) and the
 * notifiable (from the app's resolver) before re-rendering the fan-out.
 *
 * @module @lockness/notification/queued
 */

import type { Notification } from './notification.ts'
import type { Notifiable } from './notifiable.ts'
import { defaultManager } from './manager.ts'
import type {
    ChannelManager,
    DeliveryFailure,
    QueuedNotificationJob,
} from './manager.ts'
import { getNotificationConfig } from './config.ts'

/**
 * Raised by {@link handleNotificationJob} when one or more channels failed
 * during a queued delivery, so the failure reaches the queue (retry / DLQ)
 * instead of the job completing as a silent success.
 *
 * Delivery is at-least-once: a retry re-runs the whole fan-out, so a channel
 * that already succeeded may be delivered again. That is the queue's contract,
 * and it is preferable to a security-signal notification vanishing on a
 * transient error.
 */
export class QueuedDeliveryError extends Error {
    /** The per-channel failures from the fan-out. */
    readonly failures: DeliveryFailure[]

    /**
     * @param notificationClass - The notification whose delivery partly failed.
     * @param failures - The channels that failed and why.
     */
    constructor(notificationClass: string, failures: DeliveryFailure[]) {
        super(
            `queued notification "${notificationClass}" failed on channel(s): ${
                failures.map((f) => f.channel).join(', ')
            }`,
            { cause: failures[0]?.error },
        )
        this.name = 'QueuedDeliveryError'
        this.failures = failures
    }
}

/**
 * Reconstruct a notification from its queued constructor payload.
 *
 * @param payload - The value the notification's `toQueue()` returned.
 * @returns The reconstructed notification.
 */
export type NotificationFactory = (payload: unknown) => Notification

const registry = new Map<string, NotificationFactory>()

/**
 * Register a notification class for queued rehydration.
 *
 * A queued job stores only the class name; the worker looks the factory up here
 * to rebuild the notification.
 *
 * @param name - The class name (matches `Notification.notificationClass()`).
 * @param factory - Rebuilds the notification from its constructor payload.
 *
 * @example
 * ```ts
 * registerNotification('InvoicePaid', (p) => new InvoicePaid((p as { id: number }).id))
 * ```
 */
export function registerNotification(
    name: string,
    factory: NotificationFactory,
): void {
    registry.set(name, factory)
}

/**
 * Look up a registered notification factory.
 *
 * @param name - The class name.
 * @returns The factory, or `undefined` when unregistered.
 */
export function getNotificationFactory(
    name: string,
): NotificationFactory | undefined {
    return registry.get(name)
}

/** Clear the registry — test-only, so one test's registrations do not leak. */
export function resetNotificationRegistry(): void {
    registry.clear()
}

/** Options for {@link handleNotificationJob}. */
export interface HandleJobOptions {
    /** The manager to deliver through (defaults to the process default manager). */
    manager?: ChannelManager
    /** Resolve a notifiable by id (defaults to `configureNotifications`'s resolver). */
    resolveNotifiable?: (
        id: string | number,
    ) => Promise<Notifiable> | Notifiable
}

/**
 * Run a queued notification job: rehydrate the notifiable + notification from
 * the job's identifiers, then re-render and deliver the fan-out inline (never
 * re-enqueuing — `deliverInline` ignores the `queue` flag).
 *
 * @param job - The identifiers-only job.
 * @param options - Manager and notifiable-resolver overrides.
 * @returns Resolves when the fan-out completes.
 * @throws {Error} When the notification class is not registered, or no
 *   notifiable resolver is configured.
 *
 * @example
 * ```ts
 * // In the queue worker:
 * await handleNotificationJob(job)
 * ```
 */
export async function handleNotificationJob(
    job: QueuedNotificationJob,
    options: HandleJobOptions = {},
): Promise<void> {
    const factory = getNotificationFactory(job.notificationClass)
    if (!factory) {
        throw new Error(
            `queued notification "${job.notificationClass}" is not registered; ` +
                'call registerNotification(name, factory) at boot so the worker can rehydrate it',
        )
    }

    const resolve = options.resolveNotifiable ??
        getNotificationConfig().resolveNotifiable
    if (!resolve) {
        throw new Error(
            'cannot rehydrate a queued notification: no notifiable resolver configured; ' +
                'pass configureNotifications({ resolveNotifiable })',
        )
    }

    const notifiable = await resolve(job.notifiableId)
    const notification = factory(job.constructorPayload)
    const manager = options.manager ?? defaultManager
    const report = await manager.deliverInline(notifiable, notification)

    // A queued job that swallowed a delivery failure would complete as a
    // success — no retry, no DLQ, no signal. Surface it so the queue can act.
    if (report.failures.length > 0) {
        throw new QueuedDeliveryError(
            notification.notificationClass(),
            report.failures,
        )
    }
}
