/**
 * @fileoverview Tests for the log channel — security S3.
 *
 * The log channel logs a **bounded summary** (type + notifiable id + channels),
 * never the rendered payload, and passes user-derived strings through
 * `safeForLog`. Proven with a fake logger — no `@lockness/logger` required.
 *
 * @module @lockness/notification/tests/channels/log
 */

import { assert, assertEquals } from '@std/assert'
import { LogChannel, type LoggerLike } from '../../channels/log.ts'
import { Notification } from '../../notification.ts'
import type { Notifiable } from '../../notifiable.ts'

class RecordingLogger implements LoggerLike {
    readonly calls: Array<{ message: string; meta?: unknown }> = []
    info(message: string, meta?: unknown): void {
        this.calls.push({ message, meta })
    }
    error(message: string, meta?: unknown): void {
        this.calls.push({ message, meta })
    }
}

class SecretInvoice extends Notification {
    override via(): string[] {
        return ['log', 'mail']
    }
    // Rendered content the log channel must NOT emit:
    toMail(): string {
        return 'card ending 4242, balance $9000'
    }
}

const user: Notifiable = { routeNotificationFor: () => 42 }

Deno.test('S3: the log channel logs a bounded summary, not the payload', async () => {
    const logger = new RecordingLogger()
    await new LogChannel(logger).send(new SecretInvoice(), user, 42)

    assertEquals(logger.calls.length, 1)
    const { message, meta } = logger.calls[0]
    // The summary carries type + notifiable id + channels…
    assert(message.includes('SecretInvoice'))
    assertEquals((meta as { notifiableId: unknown }).notifiableId, 42)
    assertEquals((meta as { channels: string[] }).channels, ['log', 'mail'])
    // …and never the rendered mail content.
    const dumped = message + JSON.stringify(meta)
    assert(!dumped.includes('4242'))
    assert(!dumped.includes('9000'))
})

Deno.test('S3: a newline-bearing notifiable id is passed through safeForLog', async () => {
    const logger = new RecordingLogger()
    const forged = 'u1\n[ERROR] forged log line'
    const spoofer: Notifiable = { routeNotificationFor: () => forged }
    await new LogChannel(logger).send(new SecretInvoice(), spoofer, forged)

    const { message } = logger.calls[0]
    // safeForLog strips/escapes the control character so the forged line cannot
    // start its own record.
    assert(!message.includes('\n[ERROR] forged'))
})
