// Read-only: list the most recent "Applied" jobs from LinkedIn's My Jobs page.
const fs = require('fs'); const path = require('path'); const { chromium } = require('playwright');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
(async () => {
  const ctx = await chromium.launchPersistentContext(path.resolve(__dirname, '..', config.paths.userDataDir), { channel: 'chrome', headless: false, viewport: { width: 1280, height: 900 } });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('https://www.linkedin.com/my-items/saved-jobs/?cardType=APPLIED', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const txt = await page.evaluate(() => (document.querySelector('main') || document.body).innerText.replace(/\n{2,}/g, '\n'));
  console.log(txt.slice(0, 1500));
  await page.goto('https://www.linkedin.com/jobs/view/4486984197/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  console.log('--- job 4486984197 top:', await page.evaluate(() => (document.querySelector('main') || document.body).innerText.replace(/\s+/g, ' ').slice(0, 600)));
  await ctx.close();
})();
