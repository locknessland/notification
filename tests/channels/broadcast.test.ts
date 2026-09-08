/**
 * @fileoverview Tests for the broadcast channel — security S1 / SC-006.
 *
 * The channel pushes to the notifiable's **own** connection via
 * `send(clientId, …)`, never a shared `broadcast()`. Proven with a fake
 * broadcaster: a notification to A never reaches B.
 *
 * @module @lockness/notification/tests/channels/broadcast
 */

import { assert, assertEquals, assertRejects } from '@std/assert'
import {
    BroadcastChannel,
    type BroadcasterLike,
} from '../../channels/broadcast.ts'
import { ChannelManager } from '../../manager.ts'
import { Notification } from '../../notification.ts'
import type { Notifiable } from '../../notifiable.ts'

class RecordingBroadcaster implements BroadcasterLike {
    readonly sent: Array<{ clientId: string; event: string; data: unknown }> =
        []
    send(clientId: string, event: string, data: unknown): boolean {
        this.sent.push({ clientId, event, data })
        return true
    }
}

class Ping extends Notification {
    override via(): string[] {
        return ['broadcast']
    }
    toBroadcast(): { event: string; data: unknown } {
        return { event: 'invoice.paid', data: { amount: 10 } }
    }
}

const userA: Notifiable = { routeNotificationFor: () => 'client-A' }
const userB: Notifiable = { routeNotificationFor: () => 'client-B' }

Deno.test('SC-006: a broadcast reaches only the target notifiable', async () => {
    const bc = new RecordingBroadcaster()
    const channel = new BroadcastChannel(bc)

    // Deliver A's notification. B is connected but is NOT a target of it.
    await channel.send(new Ping(), userA, 'client-A')

    assertEquals(bc.sent.length, 1)
    assertEquals(bc.sent[0].clientId, 'client-A')
    assertEquals(bc.sent[0].event, 'invoice.paid')
    // B's connection never received A's notification.
    assert(!bc.sent.some((s) => s.clientId === 'client-B'))

    // A separate delivery to B reaches only B — the two never cross.
    await channel.send(new Ping(), userB, 'client-B')
    const forB = bc.sent.filter((s) => s.clientId === 'client-B')
    assertEquals(forB.length, 1)
})

Deno.test("SC-006 (routed): the manager resolves A's own client id — B is never reached", async () => {
    // This drives the full path: the manager calls routeNotificationFor, so the
    // per-notifiable client id is resolved by the notifiable, not passed in.
    const bc = new RecordingBroadcaster()
    const manager = new ChannelManager()
    manager.register(new BroadcastChannel(bc))

    await manager.send(userA, new Ping())
    await manager.send(userB, new Ping())

    assertEquals(bc.sent.map((s) => s.clientId), ['client-A', 'client-B'])
    // Each delivery reached exactly one client — no fan to the other.
    assertEquals(bc.sent.filter((s) => s.clientId === 'client-A').length, 1)
    assertEquals(bc.sent.filter((s) => s.clientId === 'client-B').length, 1)
})

Deno.test('a broadcast notification with no toBroadcast() builder fails clearly', async () => {
    class NoBuilder extends Notification {
        override via(): string[] {
            return ['broadcast']
        }
    }
    const channel = new BroadcastChannel(new RecordingBroadcaster())
    await assertRejects(
        () => Promise.resolve(channel.send(new NoBuilder(), userA, 'client-A')),
        Error,
        'toBroadcast',
    )
})

Deno.test('the broadcaster port exposes send(clientId,…) — never a shared broadcast()', () => {
    const bc = new RecordingBroadcaster()
    // The port the channel depends on is a per-client send, structurally: a
    // fan-to-all `broadcast()` is deliberately not part of BroadcasterLike, so a
    // channel cannot accidentally reach every client (S1).
    assertEquals(typeof bc.send, 'function')
    assert(!('broadcast' in bc))
})
