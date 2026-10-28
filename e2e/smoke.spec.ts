import { expect, test, type Page } from '@playwright/test'

/**
 * Smoke test against the production build served on the real GitHub Pages
 * subpath. Beyond checking the app works, the asset/console assertions catch
 * absolute-path breakage — the failure mode that otherwise only shows up once
 * the site is deployed.
 */

const CARD_IMAGE_HOST = 'assets.tcgdex.net'

/** A 1x1 transparent PNG, enough for an <img> to load successfully. */
const STUB_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

/**
 * Card art is hotlinked from TCGdex. Both helpers keep the tests hermetic — no
 * test depends on a third party being reachable.
 *
 * `stubCardArt` serves a placeholder so images load cleanly, which is what the
 * strict "no console errors" assertion needs. `blockCardArt` fails them on
 * purpose, to prove the page is still usable when the art cannot load.
 */
async function stubCardArt(page: Page) {
  await page.route(`**://${CARD_IMAGE_HOST}/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: STUB_PNG }),
  )
}

async function blockCardArt(page: Page) {
  await page.route(`**://${CARD_IMAGE_HOST}/**`, (route) => route.abort())
}

test('loads the example deck and reports the odds', async ({ page }) => {
  const consoleErrors: string[] = []
  const failedRequests: string[] = []

  await stubCardArt(page)
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  page.on('requestfailed', (request) => {
    if (request.url().includes(CARD_IMAGE_HOST)) return
    failedRequests.push(`${request.url()} — ${request.failure()?.errorText ?? 'failed'}`)
  })

  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Ideal Start', level: 1 })).toBeVisible()

  // Nothing but the import section until a deck is present.
  await expect(page.getByTestId('headline-probability')).toBeHidden()

  await page.getByRole('button', { name: 'Load example' }).click()

  // --- Deck resolved: the printed section counts must come back exactly.
  await expect(page.getByText('60/60 cards')).toBeVisible()
  await expect(page.getByText('21 Pokémon')).toBeVisible()
  await expect(page.getByText('24 Trainer')).toBeVisible()
  await expect(page.getByText('15 Energy')).toBeVisible()
  await expect(page.getByText('21 Basics')).toBeVisible()
  await expect(page.getByText('unrecognised')).toBeHidden()

  // --- Conditions were seeded from the decklist.
  const conditions = page.locator('section', { hasText: 'What counts as an ideal start?' })
  await expect(conditions.getByRole('listitem')).not.toHaveCount(0)
  await expect(conditions.getByRole('textbox', { name: 'Requirement name' }).first()).toHaveValue(
    'Main starter',
  )

  // --- Headline odds.
  const headline = page.getByTestId('headline-probability')
  await expect(headline).toBeVisible()
  await expect(headline).toHaveText(/^\d{1,3}\.\d%$/)

  // 21 Basics in 60 gives a mulligan rate of C(39,7)/C(60,7) = 3.98%.
  await expect(page.getByText('Mulligan rate')).toBeVisible()
  await expect(page.locator('dd', { hasText: /^4\.0%$/ })).toBeVisible()

  // --- Sensitivity is populated and ranked.
  const rows = page.getByTestId('sensitivity-table').locator('tbody tr')
  await expect(rows).not.toHaveCount(0)
  await expect(rows.first()).toContainText('%')

  // --- Prize risk is populated.
  await expect(page.getByRole('heading', { name: /Prize-zone risk/ })).toBeVisible()
  await expect(page.getByText('By card')).toBeVisible()

  // --- Editing a requirement moves the number.
  const before = await headline.textContent()
  await conditions
    .getByRole('listitem')
    .first()
    .getByRole('spinbutton', { name: 'How many copies' })
    .fill('3')
  await expect(headline).not.toHaveText(before ?? '')

  expect(failedRequests, 'all assets must resolve on the Pages subpath').toEqual([])
  expect(consoleErrors, 'the page must load without console errors').toEqual([])
})

test('shows an example hand, and one that misses', async ({ page }) => {
  await blockCardArt(page)
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Ideal Start', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Load example' }).click()

  const sample = page.locator('section').filter({ hasText: 'What that looks like' }).last()
  await expect(sample.getByRole('heading', { name: /What that looks like/ })).toBeVisible()

  // Seven opening cards plus the turn-1 draw. Art is blocked, so the text
  // fallback is what renders — the hand must still be readable.
  await expect(sample.locator('figure')).toHaveCount(8)
  await expect(sample.getByText('turn-1 draw')).toBeVisible()

  // The hand that hits explains which route got there.
  await expect(sample.getByText('How this hand gets there')).toBeVisible()

  await sample.getByRole('button', { name: 'One that misses' }).click()
  await expect(sample.getByText('What this hand is missing')).toBeVisible()
  await expect(sample.locator('figure')).toHaveCount(8)

  // Drawing again keeps a valid hand on screen.
  await sample.getByRole('button', { name: 'Draw another' }).click()
  await expect(sample.locator('figure')).toHaveCount(8)
})

test('adjusts a card count from the deck list', async ({ page }) => {
  await stubCardArt(page)
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Ideal Start', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Load example' }).click()
  await expect(page.getByText('60/60 cards')).toBeVisible()

  const decklist = page.getByRole('textbox', { name: 'Paste a PTCG Live decklist export' })
  await expect(decklist).toHaveValue(/4 Mega Kangaskhan ex MEG 104/)

  await page.getByRole('button', { name: 'One more Mega Kangaskhan ex' }).click()
  await expect(decklist).toHaveValue(/5 Mega Kangaskhan ex MEG 104/)
  // The section header is kept in step, and the deck total follows.
  await expect(decklist).toHaveValue(/Pokémon: 22/)
  await expect(page.getByText('61/60 cards')).toBeVisible()

  await page.getByRole('button', { name: 'One fewer Mega Kangaskhan ex' }).click()
  await expect(decklist).toHaveValue(/4 Mega Kangaskhan ex MEG 104/)
  await expect(page.getByText('60/60 cards')).toBeVisible()
})

test('clearing the decklist returns to the empty state', async ({ page }) => {
  await stubCardArt(page)
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Ideal Start', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Load example' }).click()
  await expect(page.getByTestId('headline-probability')).toBeVisible()

  await page.getByRole('button', { name: 'Clear' }).click()
  await expect(page.getByTestId('headline-probability')).toBeHidden()
  await expect(page.getByText('60/60 cards')).toBeHidden()
})
