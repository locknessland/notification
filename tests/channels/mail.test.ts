/**
 * @fileoverview Tests for the mail channel + the SMS/Slack stubs.
 *
 * The mail channel builds a message through the soft-loaded mail builder using
 * the notifiable's resolved address as the recipient. Proven with a fake mail
 * builder. The mirror-vs-real note (A-F2): the fake mirrors the builder methods
 * the adapter calls — a real-API drift surfaces here.
 *
 * @module @lockness/notification/tests/channels/mail
 */

import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert'
import {
    type MailBuilder,
    MailChannel,
    type MailContent,
} from '../../channels/mail.ts'
import { SlackChannel, SmsChannel } from '../../channels/stubs.ts'
import { Notification } from '../../notification.ts'
import type { Notifiable } from '../../notifiable.ts'

/** A fake mail builder mirroring the methods the adapter calls (A-F2 mirror). */
class FakeMail implements MailBuilder {
    to_: string | undefined
    subject_: string | undefined
    html_: string | undefined
    text_: string | undefined
    sent = false
    to(address: string): this {
        this.to_ = address
        return this
    }
    subject(s: string): this {
        this.subject_ = s
        return this
    }
    html(h: string): this {
        this.html_ = h
        return this
    }
    text(t: string): this {
        this.text_ = t
        return this
    }
    send(): Promise<void> {
        this.sent = true
        return Promise.resolve()
    }
}

class Welcome extends Notification {
    override via(): string[] {
        return ['mail']
    }
    toMail(): MailContent {
        return { subject: 'Welcome', html: '<h1>Hi</h1>' }
    }
}

const user: Notifiable = { routeNotificationFor: () => 'alice@example.com' }

Deno.test('the mail channel builds a message addressed to the resolved route', async () => {
    const built: FakeMail[] = []
    const channel = new MailChannel(() => {
        const m = new FakeMail()
        built.push(m)
        return m
    })

    await channel.send(new Welcome(), user, 'alice@example.com')

    assertEquals(built.length, 1)
    assertEquals(built[0].to_, 'alice@example.com')
    assertEquals(built[0].subject_, 'Welcome')
    assertEquals(built[0].html_, '<h1>Hi</h1>')
    assert(built[0].sent)
})

Deno.test('a mail notification with no toMail() builder fails clearly', async () => {
    class NoBuilder extends Notification {
        override via(): string[] {
            return ['mail']
        }
    }
    const channel = new MailChannel(() => new FakeMail())
    await assertRejects(
        () => channel.send(new NoBuilder(), user, 'x@y.z'),
        Error,
        'toMail',
    )
})

Deno.test('a text-only mail notification uses text(), not html()', async () => {
    class TextOnly extends Notification {
        override via(): string[] {
            return ['mail']
        }
        toMail(): MailContent {
            return { subject: 'S', text: 'plain body' }
        }
    }
    const built: FakeMail[] = []
    const channel = new MailChannel(() => {
        const m = new FakeMail()
        built.push(m)
        return m
    })
    await channel.send(new TextOnly(), user, 'x@y.z')
    assertEquals(built[0].text_, 'plain body')
    assertEquals(built[0].html_, undefined)
})

Deno.test('the SMS and Slack stubs throw a typed "configure a provider" error', () => {
    const n = new Welcome()
    assertThrows(
        () => new SmsChannel().send(n, user, '+3312'),
        Error,
        'provider',
    )
    assertThrows(
        () => new SlackChannel().send(n, user, '#general'),
        Error,
        'provider',
    )
})
