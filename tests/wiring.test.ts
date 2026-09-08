/**
 * @fileoverview Tests for the boot wiring — registerBuiltInChannels lazy
 * per-channel soft-load (the second half of SC-002), the configureNotifications
 * surface, and the notify()/defaultManager entry point.
 *
 * @module @lockness/notification/tests/wiring
 */

import { assert, assertEquals } from '@std/assert'
import { ChannelManager, notify } from '../manager.ts'
import { registerBuiltInChannels } from '../channels/mod.ts'
import {
    configureNotifications,
    getNotificationConfig,
    resetNotificationConfig,
} from '../config.ts'
import { Notification } from '../notification.ts'
import type { Notifiable, QueueableNotifiable } from '../notifiable.ts'
import type { QueuedNotificationJob } from '../manager.ts'
import type { ModuleImporter } from '../optional.ts'

class LogOnly extends Notification {
    override via(): string[] {
        return ['log']
    }
}

const user: Notifiable = { routeNotificationFor: () => 7 }

Deno.test('SC-002: a log-only fan-out soft-loads only @lockness/logger', async () => {
    const requested: string[] = []
    const importer: ModuleImporter = (specifier) => {
        requested.push(specifier)
        if (specifier === '@lockness/logger') {
            return Promise.resolve({
                Logger: class {
                    info() {}
                    error() {}
                },
            })
        }
        return Promise.reject(new Error(`unexpected import: ${specifier}`))
    }

    const manager = new ChannelManager()
    registerBuiltInChannels(manager, { importer })

    await manager.send(user, new LogOnly())

    // Neither mail, sse, queue, nor drizzle was loaded — only the used channel.
    assertEquals(requested, ['@lockness/logger'])
})

Deno.test('configureNotifications round-trips the config surface and resets', () => {
    resetNotificationConfig()
    const table = { __table: 'notifications' }
    const resolver = (id: string | number): Notifiable => ({
        routeNotificationFor: () => id,
    })

    configureNotifications({
        databaseTable: table,
        resolveNotifiable: resolver,
    })
    const cfg = getNotificationConfig()
    assertEquals(cfg.databaseTable, table)
    assertEquals(cfg.resolveNotifiable, resolver)

    resetNotificationConfig()
    assertEquals(getNotificationConfig().databaseTable, undefined)
})

class QueuedPing extends Notification {
    override readonly queue = true
    override via(): string[] {
        return ['log']
    }
}

class Keyed implements QueueableNotifiable {
    routeNotificationFor(): unknown | null {
        return 'r'
    }
    notifiableId(): string | number {
        return 99
    }
}

Deno.test('configureNotifications installs the queueDispatcher on the default manager (via notify)', async () => {
    const jobs: QueuedNotificationJob[] = []
    try {
        configureNotifications({
            queueDispatcher: (job) => void jobs.push(job),
        })
        // notify() uses defaultManager — a queued notification must enqueue.
        const report = await notify(new Keyed(), new QueuedPing())
        assertEquals(report.queued, true)
        assertEquals(jobs.length, 1)
        assertEquals(jobs[0].notifiableId, 99)
        assert(jobs[0].notificationClass === 'QueuedPing')
    } finally {
        resetNotificationConfig()
        // The default manager keeps its dispatcher for the process; harmless —
        // only queued notifications use it, and none run after this in the file.
    }
})
