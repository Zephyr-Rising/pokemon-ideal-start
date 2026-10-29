import { expect, test, type Page } from '@playwright/test'

const CARD_IMAGE_HOST = 'assets.tcgdex.net'
const STUB_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

async function stubCardArt(page: Page) {
  await page.route(`**://${CARD_IMAGE_HOST}/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: STUB_PNG }),
  )
}

async function openBoard(page: Page) {
  await stubCardArt(page)
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Ideal Start', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Load example' }).click()
  await page.getByRole('tab', { name: 'Turn 1 board' }).click()
}

test('builds a board by tapping, and plays it out', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await openBoard(page)

  // Nothing to compute until the board has something on it.
  await expect(page.getByText('Put something on the board above')).toBeVisible()

  // Tap-to-place: pick a card, then pick a zone. This path has to work, because
  // dragging is unavailable on touch and by keyboard.
  await page.getByRole('button', { name: 'Pick Mega Kangaskhan ex' }).click()
  await page.getByRole('button', { name: 'Place in Active spot' }).click()
  await expect(page.getByRole('button', { name: 'Remove Mega Kangaskhan ex' })).toBeVisible()

  await page.getByLabel('Minimum benched Pokémon').fill('3')

  const headline = page.getByTestId('playtest-probability')
  await expect(headline).toBeVisible({ timeout: 60_000 })
  await expect(headline).toHaveText(/^\d{1,3}\.\d%$/)

  // The result must carry its uncertainty, never present itself as exact.
  await expect(page.getByText(/at 95% confidence/)).toBeVisible()

  // Both parts of the board are reported separately.
  await expect(page.getByText('Mega Kangaskhan ex Active')).toBeVisible()
  await expect(page.getByText('3 or more benched')).toBeVisible()

  expect(consoleErrors).toEqual([])
})

test('a harder board is never more likely than an easier one', async ({ page }) => {
  await openBoard(page)

  await page.getByLabel('Minimum benched Pokémon').fill('2')
  const headline = page.getByTestId('playtest-probability')
  await expect(headline).toBeVisible({ timeout: 60_000 })
  const easy = Number.parseFloat((await headline.textContent())!.replace('%', ''))

  await page.getByLabel('Minimum benched Pokémon').fill('5')
  await expect
    .poll(async () => Number.parseFloat((await headline.textContent())!.replace('%', '')), {
      timeout: 60_000,
    })
    .toBeLessThanOrEqual(easy)
})

test('says which cards it cannot play', async ({ page }) => {
  await openBoard(page)
  await page.getByLabel('Minimum benched Pokémon').fill('2')
  await expect(page.getByTestId('playtest-probability')).toBeVisible({ timeout: 60_000 })

  const details = page.locator('details').filter({ hasText: 'treated as doing nothing' })
  await expect(details).toBeVisible()
  await details.locator('summary').click()
  // Boss's Orders only moves the opponent's Pokémon, so it genuinely does
  // nothing to your own board. The card database spells it with a curly
  // apostrophe, so match either.
  await expect(details).toContainText(/Boss.s Orders/)
})

test('keeps the opening-hand tab working alongside it', async ({ page }) => {
  await openBoard(page)
  await page.getByRole('tab', { name: 'Opening hand' }).click()
  await expect(page.getByTestId('headline-probability')).toBeVisible()
  await expect(page.getByText('no simulation, no sampling error')).toBeVisible()
})
