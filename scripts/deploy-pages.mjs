#!/usr/bin/env node
/**
 * Publishes the built site to the `gh-pages` branch: `npm run deploy`.
 *
 * This exists because publishing through GitHub Actions needs a token with the
 * `workflow` scope, and pushing a plain branch does not. The workflow in
 * `.github/workflows-disabled/` is the better long-term answer — it gates every
 * deploy on the full pre-flight — and this script is how the site stays live
 * until that scope is granted.
 *
 * Run `npm run preflight` first: nothing here checks the build, by design, so
 * that a deploy is never silently gated on a different set of checks than the
 * one CI will use.
 */

import { execFileSync, execSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, cpSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = resolve(ROOT, 'dist')
const BRANCH = 'gh-pages'

const run = (command, args, cwd = ROOT) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim()

const runLoud = (command, args, cwd = ROOT) =>
  execFileSync(command, args, { cwd, stdio: 'inherit' })

console.log('deploy: building…')
// npm is a shell script on Windows (npm.cmd) and cannot be spawned directly,
// so this one call goes through the shell as a single command string.
execSync('npm run build:pages', { cwd: ROOT, stdio: 'inherit' })

if (!existsSync(join(DIST, 'index.html'))) {
  throw new Error('dist/index.html is missing — the build did not produce a site')
}

// Without this, GitHub Pages runs the output through Jekyll, which drops any
// file or folder whose name starts with an underscore.
writeFileSync(join(DIST, '.nojekyll'), '')

const remote = run('git', ['remote', 'get-url', 'origin'])
// Reuse this repo's identity, so the deploy is attributed like every commit.
const name = run('git', ['config', 'user.name'])
const email = run('git', ['config', 'user.email'])
const sha = run('git', ['rev-parse', '--short', 'HEAD'])

// A throwaway repo holding only the built site, so `gh-pages` carries no
// source history and never tangles with `main`.
const staging = mkdtempSync(join(tmpdir(), 'ideal-start-pages-'))
try {
  cpSync(DIST, staging, { recursive: true })

  const git = (...args) => run('git', args, staging)
  git('init', '-q', '-b', BRANCH)
  git('config', 'user.name', name)
  git('config', 'user.email', email)
  // The parent repo's credential helper does not reach a fresh repo.
  git('config', 'credential.https://github.com.helper', '')
  git('config', '--add', 'credential.https://github.com.helper', '!gh auth git-credential')
  git('add', '-A')
  git('commit', '-q', '-m', `Deploy ${sha}`)

  console.log(`deploy: pushing ${BRANCH} to ${remote}…`)
  runLoud('git', ['push', '--force', remote, `${BRANCH}:${BRANCH}`], staging)
  console.log(`deploy: published build of ${sha}`)
} finally {
  rmSync(staging, { recursive: true, force: true })
}
