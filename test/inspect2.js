// Open one job's Easy Apply, step forward until radio questions appear, dump their markup and the
// validation-error markup produced by clicking Next with them empty. Never submits.
const fs = require('fs'); const path = require('path');
const { chromium } = require('playwright');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const id = process.argv[2];
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext(path.resolve(__dirname, config.paths.userDataDir), {
    channel: 'chrome', headless: false, viewport: { width: 1280, height: 900 }, args: ['--disable-blink-features=AutomationControlled'] });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(`https://www.linkedin.com/jobs/view/${id}/`, { waitUntil: 'domcontentloaded' });
  await sleep(5000);
  await page.locator('button[aria-label*="Easy Apply"]').first().click(); await sleep(3500);
  const d = page.locator('dialog, div[role="dialog"]').filter({ has: page.locator('input, select, textarea') }).last();
  for (let step = 0; step < 6; step++) {
    const radios = await d.locator('input[type="radio"]').count();
    const fields = await d.locator('input, select, textarea').evaluateAll(es => es.map(e => `${e.tagName}:${e.type}:${e.getAttribute('aria-label') || e.id}`));
    console.log(`step ${step + 1}: fields`, fields);
    if (radios && !fields.some(f => /Resume/i.test(f))) {
      const html = await d.evaluate(r => r.outerHTML);
      fs.writeFileSync(path.join(__dirname, 'debug', `radio-step-${id}.html`), html);
      const fsHtml = await d.locator('fieldset').first().evaluate(f => f.outerHTML).catch(() => '');
      console.log('FIELDSET MARKUP:\n' + fsHtml.replace(/class="[^"]*"/g, '').slice(0, 3000));
      // click Next with it empty to capture error markup
      await d.locator('button:has-text("Next"), button:has-text("Review")').first().click(); await sleep(2500);
      const errs = await d.evaluate(r => [...r.querySelectorAll('[id^="error-message-"], [role="alert"], [aria-live], [class*="error"]')].map(e => `${e.tagName}#${e.id} role=${e.getAttribute('role')} vis=${!!e.offsetHeight} text=${(e.innerText || '').trim().slice(0, 80)}`));
      console.log('ERROR ELEMENTS:', errs);
      const fsHtml2 = await d.locator('fieldset').first().evaluate(f => f.outerHTML).catch(() => '');
      console.log('FIELDSET AFTER NEXT:\n' + fsHtml2.replace(/class="[^"]*"/g, '').slice(0, 3000));
      break;
    }
    const next = d.locator('button:has-text("Next"), button:has-text("Review")').first();
    if (!(await next.count())) break;
    await next.click(); await sleep(3000);
  }
  await page.locator('dialog button[aria-label="Dismiss"]').first().click().catch(() => {}); await sleep(1200);
  await page.locator('button:has-text("Discard")').last().click().catch(() => {}); await sleep(1200);
  await ctx.close();
})();
