/**
 * @fileoverview Tests for `make:notification` — SC-003.
 *
 * The command scaffolds `./app/notification/<name>_notification.ts` and
 * registers under the package-command pattern. Runs in a temp cwd so no project
 * file is touched.
 *
 * @module @lockness/notification/tests/cli_commands
 */

import { assert, assertEquals } from '@std/assert'
import {
    type Cli,
    handleMakeNotification,
    notificationNaming,
    registerNotificationCommands,
} from '../cli_commands.ts'

Deno.test('notificationNaming derives PascalCase class + snake file name', () => {
    assertEquals(notificationNaming('invoicePaid'), {
        className: 'InvoicePaid',
        fileName: 'invoice_paid',
    })
    assertEquals(notificationNaming('Welcome'), {
        className: 'Welcome',
        fileName: 'welcome',
    })
})

Deno.test('SC-003: make:notification scaffolds the class file', async () => {
    const dir = await Deno.makeTempDir()
    const prevCwd = Deno.cwd()
    Deno.chdir(dir)
    try {
        const path = await handleMakeNotification(['InvoicePaid'])
        assertEquals(path, './app/notification/invoice_paid_notification.ts')

        const written = await Deno.readTextFile(
            `${dir}/app/notification/invoice_paid_notification.ts`,
        )
        assert(
            written.includes('export class InvoicePaid extends Notification'),
        )
        assert(written.includes("from '@lockness/notification'"))
    } finally {
        Deno.chdir(prevCwd)
        await Deno.remove(dir, { recursive: true })
    }
})

Deno.test('registerNotificationCommands registers make:notification', () => {
    const registered: string[] = []
    const cli: Cli = {
        register: (name) => {
            registered.push(name)
        },
    }
    registerNotificationCommands(cli)
    assert(registered.includes('make:notification'))
})

Deno.test('make:notification with no name does not write a file', async () => {
    const result = await handleMakeNotification([])
    assertEquals(result, undefined)
})
