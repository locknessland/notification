/**
 * @fileoverview The SMS and Slack channel **stubs**.
 *
 * Bundled provider credentials are out of scope (epic AC): these channels exist
 * so `via()` can name them, but throw a typed "configure a provider" error
 * until an app wires a real driver — never silently dropping a notification.
 *
 * @module @lockness/notification/channels/stubs
 */

import type { Channel } from '../channel.ts'
import type { Notification } from '../notification.ts'
import type { Notifiable } from '../notifiable.ts'

/**
 * Raised when a stub channel is used without a configured provider. Its message
 * is a fixed, operator-facing string — never surfaced to an end user.
 */
export class ProviderNotConfiguredError extends Error {
    /**
     * @param channel - The stub channel name (e.g. `'sms'`).
     */
    constructor(channel: string) {
        super(
            `the ${channel} notification channel is a stub: configure a provider before using it`,
        )
        this.name = 'ProviderNotConfiguredError'
    }
}

/**
 * A channel stub that always throws {@link ProviderNotConfiguredError}. Shared
 * by the SMS and Slack stubs so the behaviour is defined once.
 */
abstract class StubChannel implements Channel {
    abstract readonly name: string
    /**
     * Always throws — a stub has no provider.
     *
     * @throws {ProviderNotConfiguredError} Always.
     */
    send(
        _notification: Notification,
        _notifiable: Notifiable,
        _route: unknown,
    ): void {
        throw new ProviderNotConfiguredError(this.name)
    }
}

/** The SMS channel stub. */
export class SmsChannel extends StubChannel {
    readonly name = 'sms'
}

/** The Slack channel stub. */
export class SlackChannel extends StubChannel {
    readonly name = 'slack'
}
