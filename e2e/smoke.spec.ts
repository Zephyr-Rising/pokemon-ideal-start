import { expect, test } from '@playwright/test'

/**
 * Smoke test against the production build served on the real GitHub Pages
 * subpath. Beyond checking the app works, the asset/console assertions catch
 * absolute-path breakage — the failure mode that otherwise only shows up once
 * the site is deployed.
 */
test('loads the example deck and reports the odds', async ({ page }) => {
  const consoleErrors: string[] = []
  const failedRequests: string[] = []

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  page.on('requestfailed', (request) => {
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
  await expect(
    conditions.getByRole('textbox', { name: 'Requirement name' }).first(),
  ).toHaveValue('Main starter')

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

test('clearing the decklist returns to the empty state', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Ideal Start', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Load example' }).click()
  await expect(page.getByTestId('headline-probability')).toBeVisible()

  await page.getByRole('button', { name: 'Clear' }).click()
  await expect(page.getByTestId('headline-probability')).toBeHidden()
  await expect(page.getByText('60/60 cards')).toBeHidden()
})
