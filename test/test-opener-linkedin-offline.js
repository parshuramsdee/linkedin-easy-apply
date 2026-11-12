// Serve the saved LinkedIn search markup at a linkedin.com URL and exercise the opener offline.
const fs = require('fs'); const path = require('path'); const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'debug/search.html'), 'utf8');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.route('**/*', r => /linkedin\.com\/jobs\/search/.test(r.request().url()) ? r.fulfill({ contentType: 'text/html', body: html }) : r.abort());
  page.on('console', m => { if (/^EA/.test(m.text())) console.log('  [page]', m.text().slice(0, 300)); });
  await page.goto('https://www.linkedin.com/jobs/search/?keywords=x');
  const store = { profile: JSON.parse(fs.readFileSync(path.join(root, 'test', 'fixture-profile.json'))), config: JSON.parse(fs.readFileSync(path.join(root, 'config.json'))), learned: [], settings: { batch: 5 }, opened: {}, applied: {} };
  await page.exposeFunction('__eaGet', () => store); await page.exposeFunction('__eaSet', o => Object.assign(store, o));
  await page.evaluate(() => { window.chrome = { storage: { local: { get: () => window.__eaGet(), set: o => window.__eaSet(o) } }, runtime: { sendMessage: async m => { console.log('EA msg ' + JSON.stringify(m)); return {}; } } }; });
  await page.evaluate(fs.readFileSync(path.join(root, 'extension/filler.js'), 'utf8'));
  await page.evaluate(fs.readFileSync(path.join(root, 'extension/content.js'), 'utf8'));
  await page.waitForTimeout(800);
  console.log('raw componentkey elements:', await page.evaluate(() => document.querySelectorAll('[componentkey^="job-card-component-ref-"]').length));
  console.log('status:', await page.locator('#ea-status').innerText());
  await page.evaluate(() => [...document.querySelectorAll('#ea-panel button')].find(b => /open next/i.test(b.textContent)).click());
  await page.waitForTimeout(500);
  console.log('status after open:', await page.locator('#ea-status').innerText(), '| badges:', await page.locator('.ea-badge').count(), '| unique opened:', new Set(Object.keys(store.opened)).size);
  await browser.close();
})();
