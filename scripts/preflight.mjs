#!/usr/bin/env node
/**
 * Continuous end-to-end pre-flight check.
 *
 * Runs every gate in order, prints a checklist, and exits non-zero on the first
 * failure. CI runs this exact command before deploying, so a green local run and
 * a green deploy mean the same thing.
 *
 *   npm run preflight            full run, including the browser smoke test
 *   npm run preflight -- --fast  skips the build and browser stages (inner loop)
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FAST = process.argv.includes('--fast')
const CARDS_JSON = resolve(ROOT, 'src/data/cards.json')

const run = (command) => {
  const result = spawnSync(command, { cwd: ROOT, shell: true, stdio: 'inherit' })
  if (result.error) return { ok: false, detail: result.error.message }
  return { ok: result.status === 0, detail: `exit code ${result.status}` }
}

/** Dependencies are installed and the lockfile is committed. */
function checkDeps() {
  if (!existsSync(resolve(ROOT, 'node_modules'))) {
    return { ok: false, detail: 'node_modules missing — run `npm install`' }
  }
  if (!existsSync(resolve(ROOT, 'package-lock.json'))) {
    return { ok: false, detail: 'package-lock.json missing' }
  }
  return { ok: true, detail: 'node_modules and lockfile present' }
}

/**
 * The committed card database must be exactly what the generator produces from
 * the CSV. Guards against a hand-edited or stale data asset shipping.
 */
function checkDataSync() {
  if (!existsSync(CARDS_JSON)) {
    return { ok: false, detail: 'src/data/cards.json missing — run `npm run build:cards`' }
  }
  const before = readFileSync(CARDS_JSON)
  const generated = spawnSync('node scripts/build-card-db.mjs', {
    cwd: ROOT,
    shell: true,
    encoding: 'utf8',
  })
  if (generated.status !== 0) {
    process.stderr.write(generated.stderr ?? '')
    return { ok: false, detail: 'generator failed' }
  }
  const after = readFileSync(CARDS_JSON)
  if (!before.equals(after)) {
    return {
      ok: false,
      detail:
        'cards.json was stale and has been regenerated in place — review and commit the change',
    }
  }
  return { ok: true, detail: 'cards.json reproduces from the CSV byte-for-byte' }
}

const STAGES = [
  { name: 'Dependencies', fast: true, run: checkDeps },
  { name: 'Card data in sync', fast: true, run: checkDataSync },
  { name: 'Typecheck', fast: true, run: () => run('npm run typecheck') },
  { name: 'Lint', fast: true, run: () => run('npm run lint') },
  { name: 'Unit tests', fast: true, run: () => run('npm test') },
  // Builds with the real GitHub Pages base, then serves and drives that exact
  // build — so absolute-path breakage is caught here, not in production.
  { name: 'Production build', fast: false, run: () => run('npm run build:pages') },
  { name: 'Browser smoke', fast: false, run: () => run('npm run e2e') },
]

const results = []
let failed = null

for (const stage of STAGES) {
  if (FAST && !stage.fast) {
    results.push({ name: stage.name, status: 'skipped', detail: '--fast' })
    continue
  }

  process.stdout.write(`\n──── ${stage.name} ────\n`)
  const started = Date.now()
  const outcome = stage.run()
  const ms = Date.now() - started

  results.push({
    name: stage.name,
    status: outcome.ok ? 'pass' : 'fail',
    detail: outcome.detail,
    ms,
  })

  if (!outcome.ok) {
    failed = stage.name
    break
  }
}

const MARK = { pass: '✓', fail: '✗', skipped: '·' }
process.stdout.write('\n\nPre-flight checklist\n')
process.stdout.write('────────────────────\n')
for (const stage of STAGES) {
  const result = results.find((r) => r.name === stage.name)
  if (!result) {
    process.stdout.write(`  · ${stage.name.padEnd(22)} not reached\n`)
    continue
  }
  const timing = result.ms === undefined ? '' : `${(result.ms / 1000).toFixed(1)}s`
  process.stdout.write(
    `  ${MARK[result.status]} ${result.name.padEnd(22)} ${timing.padStart(6)}  ${result.detail ?? ''}\n`,
  )
}

if (failed) {
  process.stdout.write(`\nFAILED at: ${failed}\n`)
  process.exit(1)
}

process.stdout.write(
  FAST ? '\nPASS (fast run — build and browser stages skipped)\n' : '\nPASS — all stages green\n',
)
