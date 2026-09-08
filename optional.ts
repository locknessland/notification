/**
 * @fileoverview The soft-load seam — the **one** place a channel's backing
 * package is loaded on demand.
 *
 * Every channel's backing package (`@lockness/mail`, `@lockness/sse`, …) is
 * loaded here through {@link tryImport}, which imports through a **variable**
 * specifier so `deps:analyze` sees a `soft` edge (a static or literal-dynamic
 * import would harden it and fail the gate). A missing package is reported with
 * a fixed, operator-facing install message — never a raw module-resolution
 * stack (FR-004a, security S4).
 *
 * @module @lockness/notification/optional
 */

import { renderError } from '@lockness/contract'

/**
 * A module importer. The production default is dynamic `import`; a test injects
 * a fake so no real backing package is required.
 *
 * @param specifier - The bare package specifier to import.
 * @returns The imported module namespace.
 */
export type ModuleImporter = (specifier: string) => Promise<unknown>

/**
 * Raised when a channel's backing package is not installed.
 *
 * The message is a **fixed template** — `install <package> for the <channel>
 * channel` — with no interpolated resolver path. It is operator-facing and must
 * never be surfaced in an end-user HTTP response.
 */
export class ChannelPackageMissingError extends Error {
    /** The missing package's bare specifier. */
    readonly packageName: string
    /** The channel that needed it. */
    readonly channel: string

    /**
     * @param packageName - The missing package (e.g. `'@lockness/mail'`).
     * @param channel - The channel that needed it (e.g. `'mail'`).
     * @param cause - The underlying import error, rendered for operator logs.
     */
    constructor(packageName: string, channel: string, cause: unknown) {
        super(`install ${packageName} for the ${channel} channel`, { cause })
        this.name = 'ChannelPackageMissingError'
        this.packageName = packageName
        this.channel = channel
    }

    /**
     * The install message plus the rendered underlying cause — for operator
     * logs only (never an end-user response).
     *
     * @returns The message with the appended, rendered cause.
     */
    detail(): string {
        return `${this.message} — ${renderError(this.cause)}`
    }
}

/**
 * The signals Deno emits for an unresolvable specifier. Kept in one place — the
 * "not installed" vs "failed for another reason" decision must not drift.
 *
 * NOTE (A-F4): this heuristic mirrors core's `tryImportOptionalPackage`. On a
 * third soft-loader in the workspace, hoist it to `@lockness/contract` (a hard
 * dep of both) rather than growing a third copy.
 */
const NOT_FOUND_SIGNALS = [
    'Cannot resolve',
    'not a dependency',
    'not in import map',
    'Module not found',
] as const

/**
 * Load a channel's backing package on demand.
 *
 * The import goes through a variable specifier so the edge stays `soft`. A
 * genuine "not installed" error becomes a {@link ChannelPackageMissingError}
 * with the fixed install message; any other failure (a connection error, a
 * throwing top-level module) is re-thrown unchanged.
 *
 * @typeParam T - The expected module shape (a minimal structural interface).
 * @param packageName - The backing package's bare specifier.
 * @param channel - The channel needing it (for the install message).
 * @param importer - The importer; defaults to dynamic `import`.
 * @returns The imported module, typed as `T`.
 * @throws {ChannelPackageMissingError} When the package is not installed.
 * @throws {Error} When the import fails for any other reason.
 *
 * @example
 * ```ts
 * const mail = await tryImport<{ send(m: unknown): Promise<void> }>(
 *     '@lockness/mail',
 *     'mail',
 * )
 * ```
 */
export async function tryImport<T = unknown>(
    packageName: string,
    channel: string,
    importer: ModuleImporter = (specifier) => import(specifier),
): Promise<T> {
    try {
        return await importer(packageName) as T
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (NOT_FOUND_SIGNALS.some((signal) => message.includes(signal))) {
            throw new ChannelPackageMissingError(packageName, channel, error)
        }
        throw error
    }
}
