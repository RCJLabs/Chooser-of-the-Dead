import { type CaseSpec, type Destination, dailySeed, stampsFor, startShift } from '@cots/engine';
import { loadDailyContent } from '@cots/testkit';
import { expect, type Page, type Request, test } from '@playwright/test';
import { ShiftRecordSchema } from '../../apps/telemetry/src/schema';

/*
 * The alpha's feedback loop: "Report this soul", feedback links, the Daily
 * checksum guard and opt-in telemetry, against the built web demo.
 */

const DATE = new Date('2027-01-10T12:00:00Z'); // Daily #41
const N = 41;
test.use({ timezoneId: 'UTC' });

const content = loadDailyContent();
const { state, ctx } = startShift(content, { mode: 'daily', seed: dailySeed(N), day: 5, dailyNumber: N });
const stamps = stampsFor(ctx);
const ISSUES = 'https://github.com/RCJLabs/Chooser-of-the-Dead/issues/new';

const drawer = async (page: Page) => (await page.locator('.shift--drawer').count()) > 0;

async function stampAndSend(page: Page, dest: Destination) {
  if (await drawer(page)) await page.getByTestId('judge').click();
  await page.locator(`[data-dest="${dest}"]`).click();
  await page.getByTestId('send').click();
}

async function openDaily(page: Page) {
  await page.clock.setFixedTime(DATE);
  await page.goto('./');
  await page.getByTestId('play-daily').click();
  await page.getByTestId('begin').click();
}

test('a disputed citation becomes a report that rebuilds the soul', async ({ page }) => {
  await openDaily(page);
  const c = state.cases[0] as CaseSpec;
  const wrong = stamps.find((d) => d !== c.expect.dest) as Destination;
  await stampAndSend(page, wrong);
  await page.getByTestId('citation-report').click();

  const report = JSON.parse(await page.getByTestId('report-text').inputValue());
  expect(report).toMatchObject({
    v: 1,
    build: { target: 'web-demo', g: content.genVersion },
    mode: 'daily',
    n: N,
    seed: dailySeed(N),
    day: 5,
    soul: 0,
    case: c.id,
    guard: 'ok',
    verdict: { stamped: wrong, expected: c.expect.dest, rule: c.expect.rule },
  });
  expect(report.actions.at(-1)).toMatchObject({ t: 'send' });
  expect(report.device.layout).toMatch(/desk|drawer/);

  // The GitHub form link carries the same report in its `report` field.
  const href = (await page.getByTestId('report-open').getAttribute('href')) ?? '';
  const url = new URL(href);
  expect(`${url.origin}${url.pathname}`).toBe(ISSUES);
  expect(url.searchParams.get('template')).toBe('soul-report.yml');
  expect(url.searchParams.get('title')).toBe(`Soul report: Daily #${N}, soul 1`);
  expect(JSON.parse(url.searchParams.get('report') ?? '{}')).toEqual(report);

  await page.getByTestId('report-close').click();
  await page.getByTestId('citation-close').click();
  await expect(page.getByTestId('soul-count')).toHaveText('Soul 2 of 8');
});

test('feedback links carry the build, and a finished Daily records a passing guard', async ({ page }) => {
  await openDaily(page);
  for (const c of state.cases) await stampAndSend(page, c.expect.dest);
  await expect(page.getByTestId('score')).toHaveText('8 of 8 judged rightly');

  // Any row can be reported after the shift, too.
  await page.getByTestId('report-soul').nth(3).click();
  expect(JSON.parse(await page.getByTestId('report-text').inputValue())).toMatchObject({
    soul: 3,
    verdict: { stamped: state.cases[3]?.expect.dest },
  });
  await page.getByTestId('report-close').click();

  const feedback = new URL((await page.getByTestId('summary-feedback').getAttribute('href')) ?? '');
  expect(feedback.searchParams.get('template')).toBe('playtest.yml');
  expect(feedback.searchParams.get('build')).toMatch(
    /^web-demo [0-9a-f]{8} · (desk|drawer) · art woodcut · \d+x\d+ · Mozilla/,
  );

  const record = await page.evaluate(() => JSON.parse(localStorage.getItem('cots.daily') ?? '{}'));
  expect(record.results[String(N)]).toMatchObject({ n: N, correct: 8, total: 8, guard: 'ok' });

  // No telemetry endpoint in this build: nothing asks, nothing to tick.
  await expect(page.getByTestId('telemetry-ask')).toHaveCount(0);
  await page.getByTestId('home').click();
  await expect(page.getByTestId('link-feedback')).toBeVisible();
  await expect(page.getByTestId('link-privacy')).toHaveCount(0);
});

test.describe('opt-in telemetry', () => {
  const posts: Request[] = [];
  test.beforeEach(async ({ page }) => {
    posts.length = 0;
    await page.addInitScript(() => {
      (globalThis as { cotsConfig?: object }).cotsConfig = { telemetry: 'http://localhost:4173/__telemetry/' };
    });
    await page.route('**/__telemetry/**', async (route) => {
      posts.push(route.request());
      await route.fulfill({ status: 204 });
    });
  });

  test('sends nothing until the player says yes, then one valid record per shift', async ({ page }) => {
    await openDaily(page);
    for (const c of state.cases) await stampAndSend(page, c.expect.dest);
    await expect(page.getByTestId('telemetry-ask')).toBeVisible();
    expect(posts).toHaveLength(0);
    await page.getByTestId('telemetry-yes').click();
    await expect(page.getByTestId('telemetry-ask')).toHaveCount(0);

    // A practice shift, now opted in.
    await page.getByTestId('home').click();
    await page.getByTestId('practice-1').click();
    await page.getByTestId('begin').click();
    for (let i = 0; i < 20 && (await page.getByTestId('soul-count').count()) > 0; i++) {
      await stampAndSend(page, 'HEL');
      const close = page.getByTestId('citation-close');
      if (await close.isVisible()) await close.click();
    }
    await expect(page.getByTestId('score')).toBeVisible();
    await expect.poll(() => posts.length).toBe(1);

    const post = posts[0] as Request;
    expect(post.url()).toBe('http://localhost:4173/__telemetry/v1/shift');
    expect(post.method()).toBe('POST');
    const parsed = ShiftRecordSchema.safeParse(JSON.parse(post.postData() ?? ''));
    expect(parsed.success ? 'valid' : JSON.stringify(parsed.error.issues)).toBe('valid');
    expect(parsed.data).toMatchObject({ mode: 'practice', day: 1, build: { target: 'web-demo' } });
    expect(parsed.data?.souls.length).toBeGreaterThan(0);
  });

  test('can be switched on and off in Settings', async ({ page }) => {
    await page.goto('./');
    await page.locator('.card--settings summary').click();
    const box = page.getByTestId('setting-telemetry');
    await expect(box).not.toBeChecked();
    await box.check();
    await page.reload();
    await page.locator('.card--settings summary').click();
    await expect(page.getByTestId('setting-telemetry')).toBeChecked();
    await expect(page.getByTestId('link-privacy')).toBeVisible();
  });
});
