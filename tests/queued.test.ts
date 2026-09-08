/**
 * @fileoverview Tests for queued delivery — SC-004 (the round-trip).
 *
 * The enqueue side (identifiers-only job) is proven in `manager.test.ts`. Here
 * a queued notification goes through a **fake queue**: one job is enqueued, and
 * `handleNotificationJob` rehydrates the notifiable + notification and
 * re-renders the fan-out — with no rendered content ever crossing the queue.
 *
 * @module @lockness/notification/tests/queued
 */

import { assert, assertEquals } from '@std/assert'
import { ChannelManager, type QueuedNotificationJob } from '../manager.ts'
import { Notification } from '../notification.ts'
import type { Channel } from '../channel.ts'
import type { Notifiable, QueueableNotifiable } from '../notifiable.ts'
import {
    handleNotificationJob,
    QueuedDeliveryError,
    registerNotification,
    resetNotificationRegistry,
} from '../queued.ts'

class RecordingChannel implements Channel {
    readonly deliveries: string[] = []
    readonly name = 'mail'
    // deno-lint-ignore require-await
    async send(
        notification: Notification,
        _n: Notifiable,
        route: unknown,
    ): Promise<void> {
        // Render happens HERE, at delivery — never in the queued job.
        const content = (notification as InvoicePaid).toMail()
        this.deliveries.push(`${content.subject} → ${route}`)
    }
}

class InvoicePaid extends Notification {
    override readonly queue = true
    constructor(readonly invoiceId: number) {
        super()
    }
    override via(): string[] {
        return ['mail']
    }
    override toQueue(): unknown {
        return { invoiceId: this.invoiceId }
    }
    toMail(): { subject: string } {
        return { subject: `Invoice #${this.invoiceId}` }
    }
}

class User implements QueueableNotifiable {
    constructor(readonly id: number, readonly email: string) {}
    routeNotificationFor(): unknown | null {
        return this.email
    }
    notifiableId(): string | number {
        return this.id
    }
}

Deno.test('SC-004: a queued notification enqueues one job, then re-renders on handle', async () => {
    resetNotificationRegistry()
    const jobs: QueuedNotificationJob[] = []
    const channel = new RecordingChannel()
    const manager = new ChannelManager({
        queueDispatcher: (job) => {
            jobs.push(job)
        },
    })
    manager.register(channel)

    // App boot: register how to rebuild the notification + resolve the user.
    const users = new Map([[42, new User(42, 'alice@example.com')]])
    registerNotification(
        'InvoicePaid',
        (p) => new InvoicePaid((p as { invoiceId: number }).invoiceId),
    )

    // 1) Enqueue — nothing delivered inline.
    const report = await manager.send(users.get(42)!, new InvoicePaid(7))
    assertEquals(report.queued, true)
    assertEquals(channel.deliveries.length, 0) // not sent inline
    assertEquals(jobs.length, 1)

    // 2) The worker runs the job later — rehydrate + re-render + deliver.
    await handleNotificationJob(jobs[0], {
        manager,
        resolveNotifiable: (id) => users.get(id as number)!,
    })

    assertEquals(channel.deliveries, ['Invoice #7 → alice@example.com'])
    resetNotificationRegistry()
})

Deno.test('a queued delivery whose channel fails throws QueuedDeliveryError (not a silent success)', async () => {
    resetNotificationRegistry()
    const failing: Channel = {
        name: 'mail',
        send: () => {
            throw new Error('smtp down')
        },
    }
    const manager = new ChannelManager()
    manager.register(failing)
    registerNotification(
        'InvoicePaid',
        (p) => new InvoicePaid((p as { invoiceId: number }).invoiceId),
    )

    let err: unknown
    try {
        await handleNotificationJob(
            {
                notifiableId: 1,
                notificationClass: 'InvoicePaid',
                constructorPayload: { invoiceId: 1 },
            },
            {
                manager,
                resolveNotifiable: () => new User(1, 'a@b.c'),
            },
        )
    } catch (e) {
        err = e
    }
    assert(err instanceof QueuedDeliveryError)
    assertEquals((err as QueuedDeliveryError).failures[0].channel, 'mail')
    resetNotificationRegistry()
})

Deno.test('handleNotificationJob fails clearly for an unregistered notification', async () => {
    resetNotificationRegistry()
    const manager = new ChannelManager()
    let threw = false
    try {
        await handleNotificationJob(
            {
                notifiableId: 1,
                notificationClass: 'Unknown',
                constructorPayload: null,
            },
            {
                manager,
                resolveNotifiable: () => ({ routeNotificationFor: () => null }),
            },
        )
    } catch (e) {
        threw = true
        assert((e as Error).message.includes('not registered'))
    }
    assert(threw)
})
