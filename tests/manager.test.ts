/**
 * @fileoverview Tests for `ChannelManager` + `notify` — SC-001.
 *
 * Fan-out, per-channel route resolution, null-route skip, and delivery
 * isolation (one channel's throw does not abort the others) are proven with
 * fake channels — no real backing package.
 *
 * @module @lockness/notification/tests/manager
 */

import { assert, assertEquals, assertRejects } from '@std/assert'
import {
    ChannelManager,
    type QueuedNotificationJob,
    QueueNotConfiguredError,
    UnknownChannelError,
} from '../manager.ts'
import { Notification } from '../notification.ts'
import type { Notifiable, QueueableNotifiable } from '../notifiable.ts'
import type { Channel } from '../channel.ts'

/** A fake channel that records every (notifiable, route) it was asked to send. */
class RecordingChannel implements Channel {
    readonly deliveries: Array<{ route: unknown; notification: Notification }> =
        []
    constructor(readonly name: string, private readonly onSend?: () => void) {}
    // deno-lint-ignore require-await
    async send(
        notification: Notification,
        _notifiable: Notifiable,
        route: unknown,
    ): Promise<void> {
        this.onSend?.()
        this.deliveries.push({ route, notification })
    }
}

/** A notifiable whose per-channel route comes from a fixed map. */
class FakeUser implements Notifiable {
    constructor(private readonly routes: Record<string, unknown>) {}
    routeNotificationFor(channel: string): unknown | null {
        return channel in this.routes ? this.routes[channel] : null
    }
}

class TwoChannel extends Notification {
    override via(): string[] {
        return ['mail', 'sms']
    }
}

Deno.test('SC-001: a notification with two channels delivers to both', async () => {
    const mail = new RecordingChannel('mail')
    const sms = new RecordingChannel('sms')
    const manager = new ChannelManager()
    manager.register(mail)
    manager.register(sms)

    const user = new FakeUser({ mail: 'a@b.c', sms: '+3312' })
    await manager.send(user, new TwoChannel())

    assertEquals(mail.deliveries.length, 1)
    assertEquals(mail.deliveries[0].route, 'a@b.c')
    assertEquals(sms.deliveries.length, 1)
    assertEquals(sms.deliveries[0].route, '+3312')
})

Deno.test('SC-001: a null route skips only that channel', async () => {
    const mail = new RecordingChannel('mail')
    const sms = new RecordingChannel('sms')
    const manager = new ChannelManager()
    manager.register(mail)
    manager.register(sms)

    const user = new FakeUser({ mail: 'a@b.c' }) // no sms route
    const result = await manager.send(user, new TwoChannel())

    assertEquals(mail.deliveries.length, 1)
    assertEquals(sms.deliveries.length, 0)
    assertEquals(result.skipped, ['sms'])
})

Deno.test('SC-001: one channel throwing still delivers the others (isolation)', async () => {
    const mail = new RecordingChannel('mail', () => {
        throw new Error('smtp down')
    })
    const sms = new RecordingChannel('sms')
    const manager = new ChannelManager()
    manager.register(mail)
    manager.register(sms)

    const user = new FakeUser({ mail: 'a@b.c', sms: '+3312' })
    const result = await manager.send(user, new TwoChannel())

    assertEquals(sms.deliveries.length, 1) // sms still delivered
    assertEquals(result.failures.length, 1)
    assertEquals(result.failures[0].channel, 'mail')
    assert(result.failures[0].error instanceof Error)
})

Deno.test('an unknown channel name fails clearly, naming the registered set', async () => {
    const manager = new ChannelManager()
    manager.register(new RecordingChannel('mail'))

    class BadChannel extends Notification {
        override via(): string[] {
            return ['carrier-pigeon']
        }
    }
    const user = new FakeUser({ 'carrier-pigeon': 'coop-3' })

    const err = await assertRejects(
        () => manager.send(user, new BadChannel()),
        UnknownChannelError,
    )
    assert(err.message.includes('carrier-pigeon'))
    assert(err.message.includes('mail')) // names the registered set
})

// A queued notification carries a constructor payload and renders per-channel
// content only at delivery time — the queued path must serialise NEITHER.
class QueuedInvoice extends Notification {
    override readonly queue = true
    constructor(private readonly invoiceId: number) {
        super()
    }
    override via(): string[] {
        return ['mail']
    }
    override toQueue(): unknown {
        return { invoiceId: this.invoiceId }
    }
    // Rendered content the queued job must NOT contain:
    toMail(): string {
        return `Invoice #${this.invoiceId} for alice@example.com`
    }
}

class KeyedUser implements QueueableNotifiable {
    constructor(private readonly id: number) {}
    routeNotificationFor(): unknown | null {
        return 'alice@example.com'
    }
    notifiableId(): string | number {
        return this.id
    }
}

Deno.test('SC-004: a queued notification dispatches one identifiers-only job', async () => {
    const jobs: QueuedNotificationJob[] = []
    const manager = new ChannelManager({
        queueDispatcher: (job) => {
            jobs.push(job)
        },
    })
    manager.register(new RecordingChannel('mail'))

    const report = await manager.send(new KeyedUser(42), new QueuedInvoice(7))

    assertEquals(report.queued, true)
    assertEquals(jobs.length, 1) // ONE job, not one-per-channel
    assertEquals(jobs[0], {
        notifiableId: 42,
        notificationClass: 'QueuedInvoice',
        constructorPayload: { invoiceId: 7 },
    })
    // No rendered channel content leaked into the job (S5 — no PII at rest).
    const serialised = JSON.stringify(jobs[0])
    assert(!serialised.includes('alice@example.com'))
    assert(!serialised.includes('Invoice #7'))
})

Deno.test('a queued notification with no dispatcher configured fails clearly', async () => {
    const manager = new ChannelManager() // no queueDispatcher
    manager.register(new RecordingChannel('mail'))
    await assertRejects(
        () => manager.send(new KeyedUser(1), new QueuedInvoice(1)),
        QueueNotConfiguredError,
    )
})

Deno.test('a queued notifiable with no notifiableId fails clearly', async () => {
    const manager = new ChannelManager({ queueDispatcher: () => {} })
    manager.register(new RecordingChannel('mail'))
    // FakeUser has no notifiableId() → cannot be enqueued.
    await assertRejects(
        () =>
            manager.send(new FakeUser({ mail: 'a@b.c' }), new QueuedInvoice(1)),
        Error,
        'notifiableId',
    )
})
