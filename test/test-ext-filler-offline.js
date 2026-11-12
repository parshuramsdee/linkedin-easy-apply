const fs = require('fs'); const path = require('path'); const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true }); const page = await browser.newPage();
  await page.goto('file://' + path.join(__dirname, 'mock-work-exp.html'));
  await page.evaluate(fs.readFileSync(path.join(root, 'extension/filler.js'), 'utf8'));
  const profile = JSON.parse(fs.readFileSync(path.join(root, 'test', 'fixture-profile.json'), 'utf8'));
  const r = await page.evaluate(async profile => {
    const d = document.querySelector('dialog');
    const qs = window.EAFiller.scan(d).map(e => e.question);
    const res = await window.EAFiller.fill(d, { bank: profile.answers, profile, unfollow: true });
    return { qs, filled: res.filled, unknown: res.unknown.map(u => u.label), fm: fm.value, fy: fy.value, cur: cur.checked, toGone: !document.getElementById('to'), city: city.value };
  }, profile);
  console.log(JSON.stringify(r, null, 1));
  const ok = r.fm === 'December' && r.fy === '2025' && r.cur && r.toGone && r.city === 'New Delhi' && r.unknown.length === 0;
  console.log(ok ? '✅ work experience step ok' : '❌ FAILED'); await browser.close(); process.exit(ok ? 0 : 1);
})();
