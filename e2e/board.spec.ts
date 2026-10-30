import { readFileSync } from 'node:fs'

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
  const parts = page.getByTestId('board-parts')
  await expect(parts.getByText('Mega Kangaskhan ex Active').first()).toBeVisible()
  await expect(parts.getByText('3 or more benched').first()).toBeVisible()

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

test('shows how many turns a board takes, in its own tab', async ({ page }) => {
  await stubCardArt(page)
  await page.goto('./')
  await page.getByRole('button', { name: 'Load example' }).click()
  await page.getByRole('tab', { name: 'Turns to build' }).click()

  // The board is shared with the Turn 1 tab.
  await page.getByRole('button', { name: 'Pick Mega Kangaskhan ex' }).click()
  await page.getByRole('button', { name: 'Place in Active spot' }).click()
  await page.getByLabel('Minimum benched Pokémon').fill('2')

  // A run in flight shows how far it has got.
  await expect(page.getByTestId('simulation-progress').getByRole('progressbar')).toBeVisible()

  const median = page.getByTestId('turns-median')
  await expect(median).toBeVisible({ timeout: 90_000 })
  await expect(median).toHaveText(/^\d\+?$/)
  await expect(page.getByTestId('turns-mean')).toHaveText(/^(\d\.\d|—)$/)
  await expect(page.getByTestId('turns-first')).toBeVisible()
  await expect(page.getByTestId('turns-second')).toBeVisible()
  await expect(page.getByTestId('turns-distribution').getByText('Turn 6')).toBeVisible()
  // Each part's own pace is listed.
  await expect(page.getByTestId('turns-parts').getByText('2 or more benched')).toBeVisible()
  // And how luck moves it.
  await expect(page.getByTestId('turns-luck').getByText('Typical game')).toBeVisible()
  // Example games, each played out with a replay.
  const examples = page.getByTestId('turns-examples')
  await expect(examples.getByRole('button', { name: /^Turn \d · going (first|second)$/ }).first()).toBeVisible()
  await expect(examples.getByTestId('replay')).toBeVisible()

  // Switching tabs keeps the board.
  await page.getByRole('tab', { name: 'Turn 1 board' }).click()
  await expect(page.getByRole('button', { name: 'Remove Mega Kangaskhan ex' })).toBeVisible()
})

test('keeps a Special Energy as itself, not "any" Energy', async ({ page }) => {
  await stubCardArt(page)
  await page.goto('./')
  const list = readFileSync('tests/fixtures/alakazam.txt', 'utf8')
  await page.getByRole('textbox').first().fill(list)
  await page.getByRole('tab', { name: 'Turn 1 board' }).click()
  await page.getByRole('button', { name: 'Pick Abra' }).click()
  await page.getByRole('button', { name: 'Place in Active spot' }).click()
  await page.getByRole('button', { name: 'Pick Mist Energy' }).click()
  await page.getByRole('button', { name: 'Attach to Abra' }).click()

  await expect(page.getByRole('button', { name: 'Remove one Mist Energy from Abra' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: /Remove one Any Energy/ })).toHaveCount(0)
})

test('says how often the prizes make the board impossible', async ({ page }) => {
  await openBoard(page)
  // A single copy: about one game in ten has it prized.
  await page.getByRole('button', { name: 'Pick Fezandipiti ex' }).click()
  await page.getByRole('button', { name: 'Place in Bench' }).click()
  const note = page.getByTestId('prize-note')
  await expect(note).toBeVisible({ timeout: 60_000 })
  await expect(note).toContainText('Fezandipiti ex')
  await expect(note).toContainText('could never be built')
})

test('builds a board with a Tool on it', async ({ page }) => {
  await stubCardArt(page)
  await page.goto('./')
  await page.getByRole('textbox').first().fill(readFileSync('tests/fixtures/festival-lead.txt', 'utf8'))
  await page.getByRole('tab', { name: 'Turn 1 board' }).click()
  await page.getByRole('button', { name: 'Pick Grookey' }).click()
  await page.getByRole('button', { name: 'Place in Active spot' }).click()
  await page.getByRole('button', { name: 'Pick Air Balloon' }).click()
  await page.getByRole('button', { name: 'Attach to Grookey' }).click()

  // The Tool is part of the board, and some games build it.
  await expect(
    page.getByTestId('board-parts').getByText('Air Balloon on the Active').first(),
  ).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('playtest-probability')).not.toHaveText('0.0%')
})

test('reports partial success once a part is less than essential', async ({ page }) => {
  await openBoard(page)
  await page.getByRole('button', { name: 'Pick Mega Kangaskhan ex' }).click()
  await page.getByRole('button', { name: 'Place in Active spot' }).click()
  await page.getByRole('button', { name: 'Pick Fezandipiti ex' }).click()
  await page.getByRole('button', { name: 'Place in Bench' }).click()

  // Tapping a card on the board opens its priorities.
  await page.getByRole('button', { name: 'Set priority for Fezandipiti ex' }).click()
  const popover = page.getByTestId('priority-popover')
  await popover
    .getByRole('group', { name: 'Priority of Fezandipiti ex benched' })
    .getByRole('button', { name: 'Nice to have' })
    .click()
  await popover.getByRole('button', { name: 'Done' }).click()
  await expect(popover).toHaveCount(0)
  // The card says so.
  await expect(
    page.getByRole('button', { name: 'Set priority for Fezandipiti ex' }).getByText('Nice to have'),
  ).toBeVisible()

  const partial = page.getByTestId('partial-success')
  await expect(partial).toBeVisible({ timeout: 60_000 })
  await expect(partial.getByText('Essential parts')).toBeVisible()
  await expect(partial.getByText('Whole board')).toBeVisible()
})

test('places an evolved Pokémon in the Active Spot without errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await stubCardArt(page)
  await page.goto('./')
  await page.getByRole('textbox').first().fill(readFileSync('tests/fixtures/dragapult-munkidori.txt', 'utf8'))
  for (const tab of ['Turn 1 board', 'Turns to build']) {
    await page.getByRole('tab', { name: tab }).click()
    if ((await page.getByRole('button', { name: 'Remove Dragapult ex' }).count()) === 0) {
      await page.getByRole('button', { name: 'Pick Dragapult ex' }).click()
      await page.getByRole('button', { name: 'Place in Active spot' }).click()
    }
    await expect(page.getByRole('button', { name: 'Remove Dragapult ex' })).toBeVisible()
  }
  expect(errors).toEqual([])
})

test('marks an either/or alternative from the card popover', async ({ page }) => {
  await openBoard(page)
  await page.getByRole('button', { name: 'Pick Fezandipiti ex' }).click()
  await page.getByRole('button', { name: 'Place in Bench' }).click()
  await page.getByRole('button', { name: 'Set priority for Fezandipiti ex' }).click()
  await page
    .getByRole('group', { name: 'Either/or for Fezandipiti ex' })
    .getByRole('button', { name: 'Latias ex' })
    .click()
  await page.getByTestId('priority-popover').getByRole('button', { name: 'Done' }).click()
  // The card says so, and the board part reads as either/or.
  await expect(page.getByText('or Latias ex')).toBeVisible()
  await expect(
    page.getByTestId('board-parts').getByText('Fezandipiti ex or Latias ex benched'),
  ).toBeVisible({ timeout: 60_000 })
})

test('builds an either/or across zones by tapping', async ({ page }) => {
  await openBoard(page)
  await page.getByRole('button', { name: 'Pick Mega Kangaskhan ex' }).click()
  await page.getByRole('button', { name: 'Place in Active spot' }).click()
  await page.getByRole('button', { name: "Pick Ciphermaniac's Codebreaking" }).click()
  await page.getByRole('button', { name: 'Place in Still in hand' }).click()
  await page.getByRole('button', { name: 'Pick Area Zero Underdepths' }).click()
  await page.getByRole('button', { name: 'Place in Stadium' }).click()
  await page.getByRole('button', { name: 'Pick Glass Trumpet' }).click()
  await page.getByRole('button', { name: 'Place in Still in hand' }).click()

  const choices = page.getByTestId('choices')
  await choices.getByRole('button', { name: 'Either/or across zones' }).click()
  await page.getByRole('button', { name: "Set priority for Ciphermaniac's Codebreaking" }).click()
  await choices.getByRole('button', { name: 'Or…' }).click()
  await page.getByRole('button', { name: 'Set priority for Area Zero Underdepths' }).click()
  await page.getByRole('button', { name: 'Set priority for Glass Trumpet' }).click()
  await choices.getByRole('button', { name: 'Save' }).click()

  const label =
    "Ciphermaniac's Codebreaking still in hand, or Area Zero Underdepths in play and Glass Trumpet still in hand"
  await expect(choices.getByText(label)).toBeVisible()
  await expect(page.getByTestId('board-parts').getByText(label).first()).toBeVisible({ timeout: 60_000 })
})

test('asks for a number of cards in hand', async ({ page }) => {
  await openBoard(page)
  await page.getByRole('button', { name: 'Pick Mega Kangaskhan ex' }).click()
  await page.getByRole('button', { name: 'Place in Active spot' }).click()
  await page.getByLabel('Minimum cards in hand').fill('5')
  await expect(page.getByTestId('board-parts').getByText('5 or more cards in hand').first()).toBeVisible({
    timeout: 60_000,
  })

  // It has a priority too, beside the number, like the bench count.
  await page.getByRole('button', { name: 'Priority of 5 or more cards in hand' }).click()
  await page
    .getByRole('group', { name: 'Choose the priority of 5 or more cards in hand' })
    .getByRole('button', { name: 'Nice to have' })
    .click()
  await expect(page.getByRole('button', { name: 'Priority of 5 or more cards in hand' })).toHaveText(
    'Nice to have',
  )
  await expect(page.getByTestId('partial-success')).toBeVisible({ timeout: 60_000 })
})

test('a board change mid-run starts the new run straight away', async ({ page }) => {
  test.setTimeout(120_000)
  await stubCardArt(page)
  await page.goto('./')
  await page.getByRole('textbox').first().fill(readFileSync('tests/fixtures/dragapult-munkidori.txt', 'utf8'))
  await page.getByRole('tab', { name: 'Turns to build' }).click()
  await page.getByRole('button', { name: 'Pick Dragapult ex' }).click()
  await page.getByRole('button', { name: 'Place in Active spot' }).click()
  const progress = page.getByTestId('simulation-progress')
  await expect(progress.getByText(/games\/s/)).toBeVisible({ timeout: 30_000 })

  // Change the board while that run is still going.
  await page.getByRole('button', { name: 'Pick Munkidori' }).click()
  await page.getByRole('button', { name: 'Place in Bench' }).click()
  // The new run starts from zero, then shows games completing within seconds,
  // rather than sitting at zero until the old run finishes in the background.
  await expect(progress.getByText(/200 games… 0 done/)).toBeVisible({ timeout: 5_000 })
  await expect(progress.getByText(/200 games… [1-9]\d* done/)).toBeVisible({ timeout: 10_000 })
})

test('sets the priority of one Energy on a Pokémon', async ({ page }) => {
  await openBoard(page)
  await page.getByRole('button', { name: 'Pick Teal Mask Ogerpon ex' }).click()
  await page.getByRole('button', { name: 'Place in Active spot' }).click()
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Pick Grass Energy' }).click()
    await page.getByRole('button', { name: 'Attach to Teal Mask Ogerpon ex' }).click()
  }
  await page.getByRole('button', { name: 'Set priority for Teal Mask Ogerpon ex' }).click()
  await page
    .getByTestId('priority-popover')
    .getByRole('group', { name: 'Priority of Grass Energy 2' })
    .getByRole('button', { name: 'Nice to have' })
    .click()
  await page.getByTestId('priority-popover').getByRole('button', { name: 'Done' }).click()

  // One Energy is essential, both together are only nice to have.
  const parts = page.getByTestId('board-parts')
  await expect(parts.getByText('Grass Energy on the Active').first()).toBeVisible({ timeout: 60_000 })
  await expect(parts.getByText('2 Grass Energy on the Active').first()).toBeVisible()
  await expect(page.getByTestId('partial-success')).toBeVisible()
})

test('shows when each priority level comes together', async ({ page }) => {
  await stubCardArt(page)
  await page.goto('./')
  await page.getByRole('button', { name: 'Load example' }).click()
  await page.getByRole('tab', { name: 'Turns to build' }).click()
  await page.getByRole('button', { name: 'Pick Mega Kangaskhan ex' }).click()
  await page.getByRole('button', { name: 'Place in Active spot' }).click()
  await page.getByRole('button', { name: 'Pick Fezandipiti ex' }).click()
  await page.getByRole('button', { name: 'Place in Bench' }).click()
  await page.getByRole('button', { name: 'Set priority for Fezandipiti ex' }).click()
  await page
    .getByRole('group', { name: 'Priority of Fezandipiti ex benched' })
    .getByRole('button', { name: 'Nice to have' })
    .click()
  await page.getByTestId('priority-popover').getByRole('button', { name: 'Done' }).click()

  const card = page.getByTestId('turns-distribution-card')
  const toggle = card.getByRole('group', { name: 'Priority level shown' })
  await expect(toggle).toBeVisible({ timeout: 90_000 })
  // The whole board by default; then the essential parts on their own.
  await expect(toggle.getByRole('button', { name: 'Whole board' })).toHaveAttribute('aria-pressed', 'true')
  await toggle.getByRole('button', { name: 'Essential parts' }).click()
  await expect(toggle.getByRole('button', { name: 'Essential parts' })).toHaveAttribute('aria-pressed', 'true')
  await expect(card.getByText('How often essential parts first come together')).toBeVisible()
})
