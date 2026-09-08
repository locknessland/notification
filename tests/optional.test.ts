/**
 * @fileoverview Tests for the soft-load seam (`tryImport`) — SC-002.
 *
 * The seam is the single place a channel's backing package is loaded on demand.
 * A test injects a fake importer so no real backing package is required; a
 * missing package yields the fixed install template (FR-004a), never a raw
 * module-resolution stack.
 *
 * @module @lockness/notification/tests/optional
 */

import { assert, assertEquals, assertRejects } from '@std/assert'
import { ChannelPackageMissingError, tryImport } from '../optional.ts'

Deno.test('tryImport resolves an injected fake module', async () => {
    const fake = { send: () => {} }
    const mod = await tryImport<typeof fake>(
        '@lockness/mail',
        'mail',
        () => Promise.resolve(fake),
    )
    assertEquals(mod, fake)
})

Deno.test('a missing backing package yields the fixed install template (FR-004a)', async () => {
    const err = await assertRejects(
        () =>
            tryImport('@lockness/mail', 'mail', () => {
                // Deno raises a TypeError with this shape for an unresolvable
                // workspace/import-map specifier.
                throw new TypeError(
                    'Relative import path "@lockness/mail" not prefixed — not in import map',
                )
            }),
        ChannelPackageMissingError,
    )
    assertEquals(
        err.message,
        'install @lockness/mail for the mail channel',
    )
    assert(err.packageName === '@lockness/mail')
    assert(err.channel === 'mail')
})

Deno.test('an unexpected import error is re-thrown, not masked as "not installed"', async () => {
    await assertRejects(
        () =>
            tryImport('@lockness/mail', 'mail', () => {
                throw new Error('connection refused')
            }),
        Error,
        'connection refused',
    )
})
