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

  // Both parts of the board are reported separately. The names appear again in
  // the collapsed outcomes table, so the first match is the parts list.
  await expect(page.getByText('Mega Kangaskhan ex Active').first()).toBeVisible()
  await expect(page.getByText('3 or more benched').first()).toBeVisible()

  // The headline is the average of the two turn orders, which are shown too.
  await expect(page.getByTestId('going-first')).toHaveText(/^\d{1,3}\.\d%$/)
  await expect(page.getByTestId('going-second')).toHaveText(/^\d{1,3}\.\d%$/)

  // Both combination views open on request.
  await page.getByText('Every combination').click()
  // With two parts the only combination is both of them.
  await expect(page.getByTestId('combinations').getByText('All 2 parts')).toBeVisible()
  await page.getByText('Exact outcomes').click()
  await expect(page.getByTestId('outcomes').getByRole('table')).toBeVisible()

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

test('replays the line a move at a time, from the opening hand', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => consoleErrors.push(error.message))

  await openBoard(page)
  await page.getByRole('button', { name: 'Pick Mega Kangaskhan ex' }).click()
  await page.getByRole('button', { name: 'Place in Active spot' }).click()
  await page.getByLabel('Minimum benched Pokémon').fill('2')

  const replay = page.getByTestId('replay')
  await expect(replay).toBeVisible({ timeout: 60_000 })

  // It opens on the deal: a full hand of seven, nothing on the table yet.
  await expect(replay.getByText('Draw your opening hand')).toBeVisible()
  await expect(replay.getByText('Hand (7)')).toBeVisible()
  await expect(replay.getByText('Bench (0)')).toBeVisible()

  const scrubber = replay.getByRole('slider')
  await expect(scrubber).toHaveValue('0')
  const steps = Number(await scrubber.getAttribute('max'))
  expect(steps).toBeGreaterThan(0)

  // Stepping forward places the Active out of that hand.
  await replay.getByRole('button', { name: 'Next move' }).click()
  await expect(replay.getByText(/^Start with .+ in the Active Spot$/)).toBeVisible()
  await expect(replay.getByText('Hand (6)')).toBeVisible()

  // Back at the start the controls bound correctly rather than running off.
  await replay.getByRole('button', { name: 'Previous move' }).click()
  await expect(scrubber).toHaveValue('0')
  await expect(replay.getByRole('button', { name: 'Previous move' })).toBeDisabled()

  // Scrubbing to the end disables forward travel and offers a replay.
  await scrubber.fill(String(steps))
  await expect(replay.getByRole('button', { name: 'Next move' })).toBeDisabled()
  await expect(replay.getByRole('button', { name: 'Replay' })).toBeVisible()

  // Playing from the end rewinds first, rather than sitting still.
  await replay.getByRole('button', { name: 'Replay' }).click()
  await expect(scrubber).not.toHaveValue(String(steps))

  expect(consoleErrors).toEqual([])
})

test('shows a different route on request, rewound to its first move', async ({ page }) => {
  await openBoard(page)
  await page.getByRole('button', { name: 'Pick Mega Kangaskhan ex' }).click()
  await page.getByRole('button', { name: 'Place in Active spot' }).click()
  await page.getByLabel('Minimum benched Pokémon').fill('2')

  const line = page.getByTestId('example-line')
  await expect(line).toBeVisible({ timeout: 60_000 })

  const another = line.getByRole('button', { name: 'Another way' })
  // A deck this open reaches the board several ways, so the control should be
  // there; if a run genuinely found only one, there is nothing to switch to.
  if (!(await another.isVisible())) return

  const first = await line.locator('ol li').allInnerTexts()
  const scrubber = line.getByRole('slider')
  await scrubber.fill(await scrubber.getAttribute('max') ?? '0')
  await expect(scrubber).not.toHaveValue('0')

  await another.click()
  await expect(line.getByText(/route 2 of \d+/)).toBeVisible()
  // The new route starts from its own opening hand, not the old playhead.
  await expect(scrubber).toHaveValue('0')
  expect(await line.locator('ol li').allInnerTexts()).not.toEqual(first)
})

test('attaches Energy by tapping, tucked behind the Pokémon', async ({ page }) => {
  await openBoard(page)
  await page.getByRole('button', { name: 'Pick Teal Mask Ogerpon ex' }).click()
  await page.getByRole('button', { name: 'Place in Active spot' }).click()

  // A typed Energy and an "any type" one both attach, and each shows as its
  // own card behind the Pokémon that can be tapped to take it off again.
  await page.getByRole('button', { name: 'Pick Grass Energy' }).click()
  await page.getByRole('button', { name: 'Attach to Teal Mask Ogerpon ex' }).click()
  await page.getByRole('button', { name: 'Pick Grass Energy' }).click()
  await page.getByRole('button', { name: 'Attach to Teal Mask Ogerpon ex' }).click()
  const grass = page.getByRole('button', { name: 'Remove one Grass Energy from Teal Mask Ogerpon ex' })
  await expect(grass).toHaveCount(2)

  // Only the top edge peeks out from behind the Pokémon, so that is where a
  // tap has to land.
  await grass.first().click({ position: { x: 20, y: 4 } })
  await expect(grass).toHaveCount(1)

  await page.getByRole('button', { name: 'Pick Any Energy' }).click()
  await page.getByRole('button', { name: 'Attach to Teal Mask Ogerpon ex' }).click()
  // A mix stays a mix: the Grass keeps its type alongside the "any" one.
  await expect(grass).toHaveCount(1)
  await expect(
    page.getByRole('button', { name: 'Remove one Any Energy from Teal Mask Ogerpon ex' }),
  ).toHaveCount(1)
})
