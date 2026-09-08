/**
 * @fileoverview The database channel — persists a notification row through the
 * app-supplied Drizzle table (security S2, architecture A-F3).
 *
 * The channel ships no table: the app supplies it via
 * `configureNotifications({ databaseTable })`. The `Database` handle comes from
 * the **soft-loaded** `@lockness/drizzle` module (never a static import that
 * would harden the edge), typed dialect-agnostically as a loose `{ insert }`.
 * The persisted row **must** carry the notifiable's identity as a mandatory
 * owner column so a later read scopes by owner.
 *
 * @module @lockness/notification/channels/database
 */

import type { Channel } from '../channel.ts'
import type { Notification } from '../notification.ts'
import type { Notifiable } from '../notifiable.ts'
import { readBuilder } from './builder.ts'

/**
 * A dialect-agnostic insert surface — the loose `{ insert }` from A-F3. Any
 * Drizzle dialect's handle satisfies it structurally; the channel never pins a
 * `PostgresJsDatabase` (or any one dialect).
 */
export interface InsertableDb {
    /**
     * Begin an insert into a table.
     *
     * @param table - The app-supplied Drizzle table.
     * @returns A builder whose `values(row)` persists the row.
     */
    insert(table: unknown): { values(row: Record<string, unknown>): unknown }
}

/** The seams the database channel resolves at delivery time. */
export interface DatabaseChannelDeps {
    /** Resolve the dialect-agnostic db handle (soft-loaded drizzle in production). */
    resolveDb(): Promise<InsertableDb>
    /** Resolve the app-configured notifications table, or `undefined` when unset. */
    resolveTable(): unknown | undefined
    /** The mandatory owner column name (default `notifiable_id`). */
    ownerColumn?: string
}

/**
 * Persists a notification as a row owned by the notifiable.
 *
 * @example
 * ```ts
 * manager.register(new DatabaseChannel({ resolveDb, resolveTable }))
 * ```
 */
export class DatabaseChannel implements Channel {
    readonly name = 'database'
    private readonly ownerColumn: string

    /**
     * @param deps - The db/table resolvers and the owner-column name.
     */
    constructor(private readonly deps: DatabaseChannelDeps) {
        this.ownerColumn = deps.ownerColumn ?? 'notifiable_id'
    }

    /**
     * Persist the notification row.
     *
     * @param notification - The notification being delivered.
     * @param notifiable - The recipient (its route is the owner value).
     * @param route - The recipient's database route — the owner-column value.
     * @throws {Error} When no notifications table is configured.
     */
    async send(
        notification: Notification,
        notifiable: Notifiable,
        route: unknown,
    ): Promise<void> {
        const table = this.deps.resolveTable()
        if (table === undefined || table === null) {
            throw new Error(
                'the database notification channel has no table; ' +
                    'supply one via configureNotifications({ databaseTable })',
            )
        }

        const payload = readBuilder<Record<string, unknown>>(
            notification,
            'toDatabase',
            notifiable,
        ) ?? {}

        // The owner column is mandatory (S2) and set by the channel, not the
        // app payload — so a `toDatabase()` cannot forge a different owner.
        const row: Record<string, unknown> = {
            ...payload,
            [this.ownerColumn]: route,
        }

        const db = await this.deps.resolveDb()
        await db.insert(table).values(row)
    }
}
