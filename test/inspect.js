// Dump LinkedIn's current markup for the search page, a job page and the Easy Apply dialog. Never submits.
const fs = require('fs'); const path = require('path');
const { chromium } = require('playwright');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const dir = path.join(__dirname, 'debug'); fs.mkdirSync(dir, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dump = async (page, tag) => {
  await page.screenshot({ path: path.join(dir, tag + '.png') }).catch(() => {});
  fs.writeFileSync(path.join(dir, tag + '.html'), await page.content());
  console.log('saved', tag, page.url());
};
(async () => {
  const ctx = await chromium.launchPersistentContext(path.resolve(__dirname, config.paths.userDataDir), {
    channel: 'chrome', headless: false, viewport: { width: 1280, height: 900 }, args: ['--disable-blink-features=AutomationControlled'] });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('https://www.linkedin.com/jobs/search/?keywords=Java%20Developer&location=India&f_AL=true&f_TPR=r604800&f_E=2%2C3&sortBy=DD', { waitUntil: 'domcontentloaded' });
  await sleep(7000);
  await page.mouse.wheel(0, 1500); await sleep(1500);
  await dump(page, 'search');
  const info = await page.evaluate(() => {
    const out = { url: location.href, title: document.title };
    out.jobLinks = [...document.querySelectorAll('a[href*="/jobs/view/"], a[href*="currentJobId"]')].slice(0, 5).map(a => a.href);
    out.dataAttrs = {};
    for (const el of document.querySelectorAll('*')) for (const a of el.attributes) if (/^data-/.test(a.name) && /\d{8,}/.test(a.value)) out.dataAttrs[a.name] = (out.dataAttrs[a.name] || 0) + 1;
    out.testids = [...new Set([...document.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid')))];
    out.lists = [...document.querySelectorAll('ul, ol')].filter(u => u.children.length >= 5).map(u => ({ n: u.children.length, cls: u.className.slice(0, 60), first: (u.children[0].innerText || '').slice(0, 120).replace(/\n/g, ' | ') }));
    return out;
  });
  console.log(JSON.stringify(info, null, 1));
  const first = info.jobLinks[0];
  if (!first) { console.log('no job link found'); await ctx.close(); return; }
  const id = (first.match(/(?:\/jobs\/view\/|currentJobId=)(\d+)/) || [])[1];
  await page.goto(`https://www.linkedin.com/jobs/view/${id}/`, { waitUntil: 'domcontentloaded' });
  await sleep(6000);
  await dump(page, 'job');
  const btn = page.locator('button[aria-label*="Easy Apply"], button:has-text("Easy Apply")').first();
  console.log('easy apply buttons:', await page.locator('button[aria-label*="Easy Apply"]').count(), 'title:', await page.title());
  if (!(await btn.count())) { await ctx.close(); return; }
  await btn.click(); await sleep(4000);
  await dump(page, 'modal-step1');
  const d = page.locator('dialog[open], dialog, div[role="dialog"]').last();
  console.log('dialog count:', await d.count());
  console.log('dialog buttons:', await d.locator('button').evaluateAll(bs => bs.map(b => (b.getAttribute('aria-label') || b.innerText).trim().slice(0, 40))));
  console.log('dialog fields:', await d.locator('input, select, textarea').evaluateAll(es => es.map(e => `${e.tagName}:${e.type}:${e.getAttribute('aria-label') || e.id}`)));
  // try to reach step 2 to see question markup, then discard
  const next = d.locator('button:has-text("Next"), button:has-text("Review")').first();
  if (await next.count()) { await next.click(); await sleep(3000); await dump(page, 'modal-step2');
    console.log('step2 fields:', await d.locator('input, select, textarea').evaluateAll(es => es.map(e => `${e.tagName}:${e.type}:${e.getAttribute('aria-label') || e.id}`)));
    console.log('step2 buttons:', await d.locator('button').evaluateAll(bs => bs.map(b => (b.getAttribute('aria-label') || b.innerText).trim().slice(0, 40)))); }
  const x = d.locator('button[aria-label="Dismiss"], button[aria-label="Close"]').first();
  if (await x.count()) { await x.click(); await sleep(2000); await dump(page, 'discard-prompt');
    console.log('after dismiss buttons:', await page.locator('dialog button, div[role="dialog"] button, [role="alertdialog"] button').evaluateAll(bs => bs.map(b => (b.getAttribute('aria-label') || b.innerText).trim().slice(0, 40))));
    const disc = page.locator('button:has-text("Discard")').first(); if (await disc.count()) await disc.click(); await sleep(1500); }
  await ctx.close();
})();
