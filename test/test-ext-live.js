// Exercise extension/filler.js + extension/content.js on a real job page (logged-in profile), never submitting.
// node test/test-ext-live.js <jobId>
const fs = require('fs'); const path = require('path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const profile = JSON.parse(fs.readFileSync(path.join(root, 'profile.json'), 'utf8'));
const id = process.argv[2];
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext(path.resolve(root, config.paths.userDataDir), {
    channel: 'chrome', headless: false, viewport: { width: 1280, height: 900 }, args: ['--disable-blink-features=AutomationControlled'] });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.on('console', m => { if (/EA|Error/i.test(m.text())) console.log('  [page]', m.text().slice(0, 200)); });
  page.on('pageerror', e => console.log('  [pageerror]', e.message.slice(0, 200)));
  await page.goto(`https://www.linkedin.com/jobs/view/${id}/`, { waitUntil: 'domcontentloaded' });
  await sleep(5000);
  // store lives in Node so it survives LinkedIn's full-page navigation when the modal opens
  const store = { profile, config, learned: [], settings: { autoNext: true }, opened: {}, applied: {} };
  await page.exposeFunction('__eaGet', () => store);
  await page.exposeFunction('__eaSet', o => { Object.assign(store, o); });
  const css = fs.readFileSync(path.join(root, 'extension/panel.css'), 'utf8');
  const fillerSrc = fs.readFileSync(path.join(root, 'extension/filler.js'), 'utf8');
  const contentSrc = fs.readFileSync(path.join(root, 'extension/content.js'), 'utf8');
  const inject = async () => {
    try {
      await page.evaluate(() => {
        if (window.__eaGuard) return; window.__eaGuard = true;
        const orig = HTMLElement.prototype.click;
        HTMLElement.prototype.click = function () {
          const label = ((this.getAttribute && this.getAttribute('aria-label')) || '') + ' | ' + (this.innerText || '').trim().slice(0, 40);
          const stack = new Error().stack.split('\n').slice(2, 5).join(' <- ');
          if (/submit/i.test(label)) { console.log('EA BLOCKED click on ' + label + ' STACK ' + stack); return; }
          console.log('EA click ' + label + ' STACK ' + stack);
          return orig.apply(this, arguments);
        };
        document.addEventListener('submit', e => { const inPanel = e.target.id === 'ea-panel'; if (!inPanel) { e.preventDefault(); e.stopImmediatePropagation(); } console.log('EA ' + (inPanel ? 'panel-own submit (ok)' : 'BLOCKED FORM SUBMIT') + ' from ' + (e.submitter ? (e.submitter.innerText || e.submitter.getAttribute('aria-label')) : 'implicit')); }, true);
        HTMLFormElement.prototype.submit = function () { console.log('EA BLOCKED form.submit'); };
        HTMLFormElement.prototype.requestSubmit = function () { console.log('EA BLOCKED form.requestSubmit'); };
        document.addEventListener('keydown', e => { if (e.altKey || e.key === 'Enter') console.log('EA keydown ' + e.key + ' alt=' + e.altKey + ' target=' + (e.target.tagName)); }, true);
        document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('button'); if (b) console.log('EA real-click ' + ((b.getAttribute('aria-label') || '') + ' | ' + (b.innerText || '').trim().slice(0, 40)) + ' trusted=' + e.isTrusted); }, true);
      });
      await page.evaluate(() => { window.chrome = { storage: { local: { get: () => window.__eaGet(), set: o => window.__eaSet(o) } }, runtime: { sendMessage: async m => { console.log('EA msg ' + JSON.stringify(m) + ' STACK ' + new Error().stack.split('\n').slice(1, 4).join(' <- ')); return {}; } } }; });
      await page.evaluate(css => { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); }, css).catch(() => {});
      await page.evaluate(fillerSrc); await page.evaluate(contentSrc);
      await page.evaluate(() => { const p = document.getElementById('ea-panel'); if (p) p.style.cssText += 'position:fixed;right:16px;bottom:16px;width:340px;z-index:2147483647;background:#fff;border:1px solid #0a66c2;padding:10px;max-height:70vh;overflow:auto;font:13px system-ui'; });
      console.log('  (injected on', page.url().slice(0, 60) + ')');
    } catch (e) { console.log('  inject failed:', e.message.slice(0, 100)); }
  };
  page.on('load', () => setTimeout(inject, 1500));
  page.on('close', () => console.log('  [event] page close')); page.on('crash', () => console.log('  [event] page CRASH'));
  page.on('framenavigated', f => { if (f === page.mainFrame()) console.log('  [event] navigated', page.url().slice(0, 90)); });
  console.log('applied marker on page:', await page.evaluate(() => (document.querySelector('main')?.innerText.match(/.{0,30}\bApplied\b.{0,30}/) || ['none'])[0]));
  await inject();
  await sleep(1500);
  const status = () => page.locator('#ea-status').innerText().catch(() => '(no panel)');
  console.log('panel:', await status());
  await page.locator('#ea-panel button', { hasText: 'Easy Apply + Fill' }).click();
  let last = '';
  for (let i = 0; i < 40; i++) {
    await sleep(1500);
    if (page.isClosed()) { console.log('page closed!'); break; }
    const s = await status();
    if (s !== last) { console.log(`t+${(i + 1) * 1.5}s:`, s); last = s; }
    if (i % 4 === 3) console.log(`   t+${(i + 1) * 1.5}s dialog?`, await page.evaluate(() => { const d = document.querySelector('dialog[open]'); return d ? d.innerText.replace(/\s+/g, ' ').slice(0, 120) : 'no dialog'; }).catch(() => 'n/a'));
    const unknown = await page.locator('#ea-unknown .ea-q label').allInnerTexts();
    if (unknown.length) {
      console.log('   unknown questions shown in panel:', unknown);
      // answer them like a user would: pick the "No"/first option or a plausible text
      const inputs = page.locator('#ea-unknown input, #ea-unknown select, #ea-unknown textarea');
      for (let k = 0; k < await inputs.count(); k++) {
        const el = inputs.nth(k); const tag = await el.evaluate(e => e.tagName);
        if (tag === 'SELECT') { const opts = await el.locator('option').allInnerTexts(); const pick = opts.find(o => /^no\b/i.test(o)) || opts[1]; await el.selectOption({ label: pick }); }
        else await el.fill('1');
      }
      await page.locator('#ea-unknown button', { hasText: 'Save & Next' }).click();
      console.log('   learned now:', store.learned.map(l => l.match[0] + ' => ' + l.answer));
    }
    if (/Review page/.test(s)) break;
    if (/did not advance/.test(s)) { console.log('   STUCK — dialog text tail:', (await page.locator('dialog').last().innerText()).slice(-400)); break; }
  }
  console.log('panel mount:', await page.evaluate(() => { const p = document.getElementById('ea-panel'); return p ? `parent=${p.parentElement.tagName} insideForm=${!!p.parentElement.closest('form')} buttonTypes=${[...new Set([...p.querySelectorAll('button')].map(b => b.type))]}` : 'no panel'; }));
  // on the review page, click a panel button and press Enter in the panel: neither may submit LinkedIn's form
  await page.locator('#ea-panel button', { hasText: 'Fill step' }).click().catch(e => console.log('panel click failed:', e.message.slice(0, 80)));
  await page.locator('#ea-panel').press('Enter').catch(() => {});
  await sleep(2000);
  console.log('after panel click, dialog still:', await page.evaluate(() => (document.querySelector('dialog[open]')?.innerText || 'GONE').replace(/\s+/g, ' ').slice(0, 60)));
  console.log('final step buttons:', await page.evaluate(() => [...document.querySelectorAll('dialog button')].map(b => `[aria=${b.getAttribute('aria-label')}] [text=${(b.innerText || '').trim().slice(0, 30)}] [type=${b.type}]`)));
  console.log('final step checkboxes:', await page.evaluate(() => [...document.querySelectorAll('dialog input[type=checkbox]')].map(c => (c.closest('label') || c.parentElement.parentElement).innerText.replace(/\s+/g, ' ').slice(0, 80))));
  const fields = await page.evaluate(() => [...document.querySelectorAll('dialog input, dialog select, dialog textarea')].map(e => `${e.type || e.tagName}:${(e.getAttribute('aria-label') || e.id || '').slice(0, 30)}=${(e.type === 'radio' || e.type === 'checkbox') ? e.checked : String(e.value).slice(0, 40)}`));
  console.log('final step fields:', fields);
  await page.screenshot({ path: path.join(root, 'debug', `ext-live-${id}.png`) });
  // discard, never submit
  await page.locator('dialog button[aria-label="Dismiss"]').first().click().catch(() => {}); await sleep(1200);
  await page.locator('button:has-text("Discard")').last().click().catch(() => {}); await sleep(1000);
  await ctx.close();
})();
