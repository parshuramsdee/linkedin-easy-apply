// Print the first Easy Apply job ids for a keyword/company search (read-only).
const fs = require('fs'); const path = require('path'); const { chromium } = require('playwright');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
(async () => {
  const ctx = await chromium.launchPersistentContext(path.resolve(__dirname, '..', config.paths.userDataDir), { channel: 'chrome', headless: false, viewport: { width: 1280, height: 900 } });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('https://www.linkedin.com/jobs/search/?keywords=' + encodeURIComponent(process.argv[2]) + '&location=India&f_AL=true', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  console.log('url:', page.url(), '| title:', await page.title());
  console.log('text:', await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 300)));
  console.log(await page.evaluate(() => [...document.querySelectorAll('[componentkey^="job-card-component-ref-"]')].slice(0, 8).map(c => c.getAttribute('componentkey').match(/\d{6,}/)[0] + ' ' + (c.innerText || '').split('\n').filter(Boolean).slice(0, 2).join(' | ')).join('\n')));
  await ctx.close();
})();
