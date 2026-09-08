/**
 * @fileoverview CLI command registration for `@lockness/notification`.
 *
 * `registerNotificationCommands(cli)` adds `make:notification`. It follows the
 * package-command pattern (`loadPackageCommands` discovers a `register*Commands`
 * export named in `lockness.packages`) and uses a **local** stub reader — the
 * package does not depend on `@lockness/cli` (kept thin per A-F5/#260: scaffold
 * logic moves to a `generators/` module if a second `make:*` is ever added).
 *
 * @module @lockness/notification/cli_commands
 */

import { dirname, fromFileUrl, join } from '@std/path'

/** A CLI command handler. */
type CommandHandler = (args: string[]) => void | Promise<void>

/**
 * The minimal CLI surface used here — structural, so the package needs no
 * `@lockness/cli` import.
 */
export interface Cli {
    /**
     * Register a named command.
     *
     * @param name - The command name (e.g. `make:notification`).
     * @param handler - The command handler.
     * @param description - A one-line description.
     */
    register(name: string, handler: CommandHandler, description?: string): void
}

/** Resolved path to this package's stubs directory (local or JSR). */
const STUBS_PATH: string = import.meta.url.startsWith('file://')
    ? join(dirname(fromFileUrl(import.meta.url)), 'stubs')
    : new URL('./stubs', import.meta.url).href

/**
 * Read a stub and apply `{{ key }}` replacements.
 *
 * @param stubName - The stub file name without `.stub`.
 * @param replacements - Placeholder values.
 * @returns The rendered content.
 */
export async function processStub(
    stubName: string,
    replacements: Record<string, string>,
): Promise<string> {
    const stubPath = join(STUBS_PATH, `${stubName}.stub`)
    let content = await Deno.readTextFile(stubPath)
    for (const [key, value] of Object.entries(replacements)) {
        content = content.replaceAll(`{{${key}}}`, value)
    }
    return content
}

/**
 * Write a file, creating parent directories.
 *
 * @param filePath - Where to write.
 * @param content - What to write.
 */
export async function createFile(
    filePath: string,
    content: string,
): Promise<void> {
    await Deno.mkdir(dirname(filePath), { recursive: true })
    await Deno.writeTextFile(filePath, content)
}

/**
 * Derive the class + file names from a raw name.
 *
 * @param raw - The user-supplied name (e.g. `invoicePaid`, `InvoicePaid`).
 * @returns The PascalCase class name and snake-ish file name.
 */
export function notificationNaming(
    raw: string,
): { className: string; fileName: string } {
    const className = raw.charAt(0).toUpperCase() + raw.slice(1)
    const fileName = raw
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .toLowerCase()
    return { className, fileName }
}

/**
 * `make:notification` handler — scaffolds a `Notification` subclass under
 * `./app/notification`.
 *
 * @param args - CLI args; the first non-flag token is the notification name.
 * @returns The path written, or `undefined` when the name was missing.
 */
export async function handleMakeNotification(
    args: string[],
): Promise<string | undefined> {
    const name = args.find((a) => !a.startsWith('-'))
    if (!name) {
        console.error(
            '❌ Please provide a notification name (e.g. InvoicePaid)',
        )
        return undefined
    }
    // A scaffolder writes a file whose path derives from this name — reject a
    // name that could escape ./app/notification (path traversal), even though
    // this is a dev-time command.
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) {
        console.error(
            `❌ Invalid notification name "${name}" — use letters and digits only (e.g. InvoicePaid)`,
        )
        return undefined
    }

    const { className, fileName } = notificationNaming(name)
    const filePath = `./app/notification/${fileName}_notification.ts`

    const content = await processStub('notification', { className })
    await createFile(filePath, content)
    console.log(`✅ Notification created at ${filePath}`)
    return filePath
}

/**
 * Register the notification CLI commands.
 *
 * @param cli - The CLI instance to register on.
 *
 * @example
 * ```ts
 * import { registerNotificationCommands } from '@lockness/notification'
 * registerNotificationCommands(cli)
 * ```
 */
export function registerNotificationCommands(cli: Cli): void {
    cli.register(
        'make:notification',
        // The handler returns the written path for tests; the CLI discards it.
        async (args) => {
            await handleMakeNotification(args)
        },
        'Create a new notification class',
    )
}
