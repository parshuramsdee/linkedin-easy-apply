// Inject the extension on a public Naukri search page and exercise the batch opener (tab opening is stubbed).
const fs = require('fs'); const path = require('path'); const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const profile = JSON.parse(fs.readFileSync(path.join(root, 'profile.json'), 'utf8'));
const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(process.env.TMPDIR || '/tmp', 'ea-naukri-profile'), { channel: 'chrome', headless: false, viewport: { width: 1280, height: 900 } });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.on('console', m => { if (/^EA/.test(m.text())) console.log('  [page]', m.text().slice(0, 400)); });
  await page.goto('https://www.naukri.com/java-developer-jobs-in-delhi-ncr', { waitUntil: 'commit' }).catch(e => console.log('goto:', e.message.slice(0, 60)));
  await page.waitForTimeout(7000);
  const store = { profile, config, learned: [], settings: { batch: 5 }, opened: {}, applied: {} };
  await page.exposeFunction('__eaGet', () => store); await page.exposeFunction('__eaSet', o => Object.assign(store, o));
  await page.evaluate(() => { window.chrome = { storage: { local: { get: () => window.__eaGet(), set: o => window.__eaSet(o) } }, runtime: { sendMessage: async m => { console.log('EA msg ' + JSON.stringify(m)); return {}; } } }; });
  await page.evaluate(css => { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); }, fs.readFileSync(path.join(root, 'extension/panel.css'), 'utf8')).catch(() => {});
  await page.evaluate(fs.readFileSync(path.join(root, 'extension/filler.js'), 'utf8'));
  await page.evaluate(fs.readFileSync(path.join(root, 'extension/content.js'), 'utf8'));
  await page.waitForTimeout(1500);
  console.log('status:', await page.locator('#ea-status').innerText().catch(() => '(no panel)'));
  const clickOpen = () => page.evaluate(() => [...document.querySelectorAll('#ea-panel button')].find(b => /open next/i.test(b.textContent)).click());
  await clickOpen();
  await page.waitForTimeout(1000);
  console.log('status after open:', await page.locator('#ea-status').innerText());
  console.log('badges on page:', await page.locator('.ea-badge').count(), '| opened keys:', Object.keys(store.opened).length);
  await clickOpen();
  await page.waitForTimeout(800);
  console.log('status after 2nd open:', await page.locator('#ea-status').innerText());
  await ctx.close();
})();
