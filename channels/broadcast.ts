/**
 * @fileoverview The broadcast channel — pushes to the notifiable's own
 * connection through `@lockness/sse` (security S1).
 *
 * The route from `routeNotificationFor('broadcast')` is a **per-notifiable**
 * client id. The channel calls `send(clientId, …)` — never a shared
 * `broadcast()` that would fan one user's notification to every connected
 * client. That is why {@link BroadcasterLike} exposes only a per-client send.
 *
 * @module @lockness/notification/channels/broadcast
 */

import type { Channel } from '../channel.ts'
import type { Notification } from '../notification.ts'
import type { Notifiable } from '../notifiable.ts'
import { readBuilder } from './builder.ts'

/**
 * The minimal broadcaster the channel depends on — a per-client send only.
 *
 * A fan-to-all `broadcast()` is deliberately **not** part of this port: the
 * channel structurally cannot reach every client, which is the S1 control
 * expressed in the type. `@lockness/sse`'s `SSEChannel.send` satisfies it.
 */
export interface BroadcasterLike {
    /**
     * Send an event to one client.
     *
     * @param clientId - The target client's id.
     * @param event - The event name.
     * @param data - The event payload.
     * @returns Whether a live connection received it.
     */
    send(clientId: string, event: string, data: unknown): boolean
}

/** The payload a notification's `toBroadcast()` returns. */
export interface BroadcastContent {
    /** The SSE event name. */
    event: string
    /** The event payload. */
    data: unknown
}

/**
 * Pushes a notification to the notifiable's own SSE connection.
 *
 * @example
 * ```ts
 * manager.register(new BroadcastChannel(sseChannel))
 * ```
 */
export class BroadcastChannel implements Channel {
    readonly name = 'broadcast'

    /**
     * @param broadcaster - The per-client sender (an app SSE channel in
     *   production; a fake in tests).
     */
    constructor(private readonly broadcaster: BroadcasterLike) {}

    /**
     * Push the notification to the recipient's client.
     *
     * @param notification - The notification being delivered.
     * @param notifiable - The recipient.
     * @param route - The recipient's broadcast client id.
     * @throws {Error} When the notification has no `toBroadcast()` builder.
     */
    // deno-lint-ignore require-await
    async send(
        notification: Notification,
        notifiable: Notifiable,
        route: unknown,
    ): Promise<void> {
        const content = readBuilder<BroadcastContent>(
            notification,
            'toBroadcast',
            notifiable,
        )
        if (!content) {
            throw new Error(
                `notification "${notification.notificationClass()}" uses the broadcast channel but has no toBroadcast() builder`,
            )
        }
        this.broadcaster.send(String(route), content.event, content.data)
    }
}
