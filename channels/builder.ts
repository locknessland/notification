/**
 * @fileoverview Reads a notification's optional per-channel payload builder.
 *
 * A channel calls `readBuilder(notification, 'toMail', notifiable)`; the builder
 * hooks (`toMail`, `toDatabase`, …) are not declared on the base so a
 * notification implements only the channels it uses. This is the one place the
 * `unknown`→callable narrowing happens (hard rule #3).
 *
 * @module @lockness/notification/channels/builder
 */

import type { Notification } from '../notification.ts'
import type { Notifiable } from '../notifiable.ts'

/**
 * Invoke a notification's optional per-channel builder, if present.
 *
 * @typeParam T - The builder's return shape.
 * @param notification - The notification carrying the optional hook.
 * @param method - The hook name (e.g. `'toMail'`).
 * @param notifiable - Passed to the hook (a notification may vary its payload
 *   by recipient).
 * @returns The hook's result, or `undefined` when the notification has no such
 *   hook.
 */
export function readBuilder<T>(
    notification: Notification,
    method: string,
    notifiable: Notifiable,
): T | undefined {
    const hook = (notification as unknown as Record<string, unknown>)[method]
    if (typeof hook !== 'function') return undefined
    return (hook as (n: Notifiable) => T).call(notification, notifiable)
}
