/**
 * @fileoverview Tests for the database channel — security S2 / A-F3.
 *
 * The persisted row must carry the notifiable's identity as a mandatory owner
 * column (so a later "list my notifications" read scopes by owner). The channel
 * is dialect-agnostic (a loose `{ insert }`) and fails clearly when no table is
 * configured. Proven with a fake db — no `@lockness/drizzle` required.
 *
 * @module @lockness/notification/tests/channels/database
 */

import { assert, assertEquals, assertRejects } from '@std/assert'
import { DatabaseChannel, type InsertableDb } from '../../channels/database.ts'
import { Notification } from '../../notification.ts'
import type { Notifiable } from '../../notifiable.ts'

/** A fake dialect-agnostic db recording the last inserted (table, row). */
class FakeDb implements InsertableDb {
    table: unknown
    row: Record<string, unknown> | undefined
    insert(table: unknown) {
        this.table = table
        return {
            values: (row: Record<string, unknown>) => {
                this.row = row
                return Promise.resolve()
            },
        }
    }
}

const TABLE = { __table: 'notifications' }

class InvoicePaid extends Notification {
    override via(): string[] {
        return ['database']
    }
    toDatabase(): Record<string, unknown> {
        return { type: 'invoice_paid', invoiceId: 7 }
    }
}

const user: Notifiable = { routeNotificationFor: () => 'user-42' }

Deno.test('S2: the persisted row carries the notifiable owner as a mandatory column', async () => {
    const db = new FakeDb()
    const channel = new DatabaseChannel({
        resolveDb: () => Promise.resolve(db),
        resolveTable: () => TABLE,
        ownerColumn: 'notifiable_id',
    })

    await channel.send(new InvoicePaid(), user, 'user-42')

    assertEquals(db.table, TABLE)
    assertEquals(db.row?.notifiable_id, 'user-42') // owner column present
    assertEquals(db.row?.type, 'invoice_paid') // payload merged
    assert(db.row?.invoiceId === 7)
})

Deno.test('the database channel fails clearly when no table is configured', async () => {
    const db = new FakeDb()
    const channel = new DatabaseChannel({
        resolveDb: () => Promise.resolve(db),
        resolveTable: () => undefined, // not configured
        ownerColumn: 'notifiable_id',
    })

    await assertRejects(
        () => channel.send(new InvoicePaid(), user, 'user-42'),
        Error,
        'configureNotifications',
    )
})
