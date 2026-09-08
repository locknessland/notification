/**
 * @fileoverview The mail channel — sends through `@lockness/mail`.
 *
 * The notifiable's resolved route is the recipient address; the notification's
 * `toMail()` supplies the subject and body. The channel drives the soft-loaded
 * mail builder. {@link MailBuilder} mirrors the builder methods the adapter
 * calls (A-F2): a real-API drift surfaces in the mail channel test.
 *
 * @module @lockness/notification/channels/mail
 */

import type { Channel } from '../channel.ts'
import type { Notification } from '../notification.ts'
import type { Notifiable } from '../notifiable.ts'
import { readBuilder } from './builder.ts'

/** The payload a notification's `toMail()` returns. */
export interface MailContent {
    /** The subject line. */
    subject: string
    /** The HTML body (preferred when both are present). */
    html?: string
    /** The plain-text body. */
    text?: string
}

/**
 * The minimal fluent mail builder the channel drives — a structural mirror of
 * `@lockness/mail`'s `Mail` (A-F2). Kept to the methods the adapter calls.
 */
export interface MailBuilder {
    /** Set the recipient. */
    to(address: string): this
    /** Set the subject. */
    subject(subject: string): this
    /** Set the HTML body. */
    html(content: string): this
    /** Set the plain-text body. */
    text(content: string): this
    /** Send the message. */
    send(): Promise<unknown>
}

/**
 * Sends a notification as an email.
 *
 * @example
 * ```ts
 * manager.register(new MailChannel(() => mail()))
 * ```
 */
export class MailChannel implements Channel {
    readonly name = 'mail'

    /**
     * @param newMessage - Factory for a fresh mail builder. May be async so
     *   production can soft-load `@lockness/mail` on first use; a test passes a
     *   synchronous fake.
     */
    constructor(
        private readonly newMessage: () => MailBuilder | Promise<MailBuilder>,
    ) {}

    /**
     * Build and send the email.
     *
     * @param notification - The notification being delivered.
     * @param notifiable - The recipient.
     * @param route - The recipient's email address.
     * @throws {Error} When the notification has no `toMail()` builder.
     */
    async send(
        notification: Notification,
        notifiable: Notifiable,
        route: unknown,
    ): Promise<void> {
        const content = readBuilder<MailContent>(
            notification,
            'toMail',
            notifiable,
        )
        if (!content) {
            throw new Error(
                `notification "${notification.notificationClass()}" uses the mail channel but has no toMail() builder`,
            )
        }

        const message = (await this.newMessage())
            .to(String(route))
            .subject(content.subject)
        if (content.html !== undefined) message.html(content.html)
        else if (content.text !== undefined) message.text(content.text)

        await message.send()
    }
}
