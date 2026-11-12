#!/usr/bin/env node
// LinkedIn Easy Apply runner.
//   node apply.js --login          open browser, log in once, exit
//   node apply.js                  run (dryRun from config.json)
//   node apply.js --live           actually submit
//   node apply.js --dry-run        never submit, just walk through forms
//   node apply.js --max 20         cap this run
//   node apply.js --no-ask         never prompt, use defaults for unknowns
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { fillStep, erroredQuestions, unfilledQuestions, stepSignature, clean } = require('./filler');

const ROOT = __dirname;
const argv = process.argv.slice(2);
const flag = n => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };

const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const profilePath = path.join(ROOT, 'profile.json');
const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));

const dryRun = flag('--live') ? false : flag('--dry-run') ? true : !!config.behaviour.dryRun;
const askOnUnknown = flag('--no-ask') ? false : !!config.behaviour.askOnUnknownQuestion;
const maxApps = +opt('--max', config.limits.maxApplicationsPerRun);
const resumePath = path.resolve(ROOT, profile.resumePath || './resume.pdf');
const appliedLog = path.resolve(ROOT, config.paths.appliedLog);
const unansweredLog = path.resolve(ROOT, config.paths.unansweredLog);
const userDataDir = path.resolve(ROOT, config.paths.userDataDir);

const rand = ([a, b]) => a + Math.random() * (b - a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pause = async (page) => page.waitForTimeout(rand(config.limits.delayBetweenActionsMs));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const reList = list => (list || []).map(p => new RegExp(p, 'i'));
const skipTitle = reList(config.behaviour.skipIfTitleMatches);
const skipCompany = reList(config.behaviour.skipIfCompanyMatches);
const skipDesc = reList(config.behaviour.skipIfDescriptionMatches);

// ---------- state ----------
const seen = new Map(); // jobId -> status
if (fs.existsSync(appliedLog)) {
  for (const line of fs.readFileSync(appliedLog, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); seen.set(String(r.jobId), r.status); } catch {}
  }
}
function record(entry) {
  const row = { ts: new Date().toISOString(), ...entry };
  fs.appendFileSync(appliedLog, JSON.stringify(row) + '\n');
  seen.set(String(entry.jobId), entry.status);
}
function recordUnanswered(job, question, options, used) {
  fs.appendFileSync(unansweredLog, JSON.stringify({ ts: new Date().toISOString(), jobId: job.id, title: job.title, question, options, used }) + '\n');
}

// ---------- url building ----------
function searchUrl(s, start) {
  const f = config.filters;
  const p = new URLSearchParams({ keywords: s.keywords, location: s.location, start: String(start) });
  if (f.easyApplyOnly !== false) p.set('f_AL', 'true');
  const tpr = { day: 'r86400', week: 'r604800', month: 'r2592000' }[f.postedWithin];
  if (tpr) p.set('f_TPR', tpr);
  if (f.experienceLevels?.length) p.set('f_E', f.experienceLevels.join(','));
  if (f.workTypes?.length) p.set('f_WT', f.workTypes.join(','));
  if (f.sortBy) p.set('sortBy', f.sortBy);
  return 'https://www.linkedin.com/jobs/search/?' + p.toString();
}

// ---------- login ----------
async function ensureLoggedIn(page) {
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
  await sleep(3000);
  if (/\/feed/.test(page.url()) && !/login|checkpoint|authwall/.test(page.url())) return true;
  log('🔐 Not logged in. Please log in to LinkedIn in the browser window (I will wait up to 10 minutes)...');
  for (let i = 0; i < 120; i++) {
    await sleep(5000);
    if (/linkedin\.com\/feed/.test(page.url())) { log('✅ Logged in.'); return true; }
  }
  return false;
}

function checkpoint(page) {
  return /checkpoint|challenge|captcha|authwall|\/login/.test(page.url());
}

// ---------- job listing ----------
async function dumpDebug(page, tag) {
  const dir = path.join(ROOT, 'debug');
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, `${tag}-${Date.now()}`);
  await page.screenshot({ path: base + '.png', fullPage: false }).catch(() => {});
  fs.writeFileSync(base + '.html', await page.content().catch(() => ''));
  const counts = await page.evaluate(() => {
    const sels = ['li[data-occludable-job-id]', '[data-job-id]', 'a[href*="/jobs/view/"]', '[data-entity-urn*="jobPosting"]',
      '[componentkey^="job-card-component-ref-"]', 'dialog', 'button[aria-label*="Easy Apply"]', '.job-card-container', '.jobs-search-results-list', '.scaffold-layout__list', 'ul.scaffold-layout__list-container', 'div[role="dialog"]', 'h1'];
    return Object.fromEntries(sels.map(s => [s, document.querySelectorAll(s).length]));
  }).catch(() => ({}));
  log(`   🐞 debug saved: ${base}.png / .html  url=${page.url()}`);
  log('   🐞 selector counts: ' + JSON.stringify(counts));
}

// Pull job ids from every place LinkedIn has ever put them.
async function extractJobIds(page) {
  return page.evaluate(() => {
    const ids = new Set();
    const add = v => { const m = String(v || '').match(/(\d{6,})/); if (m) ids.add(m[1]); };
    document.querySelectorAll('[componentkey^="job-card-component-ref-"]').forEach(e => add(e.getAttribute('componentkey')));
    document.querySelectorAll('[data-occludable-job-id]').forEach(e => add(e.getAttribute('data-occludable-job-id')));
    document.querySelectorAll('[data-job-id]').forEach(e => add(e.getAttribute('data-job-id')));
    document.querySelectorAll('[data-entity-urn*="jobPosting"]').forEach(e => add(e.getAttribute('data-entity-urn')));
    document.querySelectorAll('a[href*="/jobs/view/"]').forEach(a => { const m = a.href.match(/\/jobs\/view\/(\d+)/); if (m) ids.add(m[1]); });
    document.querySelectorAll('a[href*="currentJobId="]').forEach(a => { const m = a.href.match(/currentJobId=(\d+)/); if (m) ids.add(m[1]); });
    // ids of cards that already show "Applied"
    const applied = new Set();
    for (const card of document.querySelectorAll('[componentkey^="job-card-component-ref-"], li, .job-card-container, [data-job-id]')) {
      if (!/\bApplied\b/.test(card.innerText || '')) continue;
      const a = card.querySelector('a[href*="/jobs/view/"], a[href*="currentJobId="]');
      const m = (a && a.href.match(/(?:\/jobs\/view\/|currentJobId=)(\d+)/)) || String(card.getAttribute('componentkey') || card.getAttribute('data-occludable-job-id') || card.getAttribute('data-job-id') || '').match(/(\d{6,})/);
      if (m) applied.add(m[1]);
    }
    return { ids: [...ids], applied: [...applied] };
  });
}

async function scrollJobList(page) {
  await page.evaluate(async () => {
    // find the tallest scrollable container on the left (the job list) and walk it
    const scrollables = [...document.querySelectorAll('div, ul')].filter(el => {
      const st = getComputedStyle(el);
      return /(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 200;
    });
    const targets = scrollables.length ? scrollables : [document.scrollingElement];
    for (const el of targets) {
      for (let y = 0; y < el.scrollHeight; y += 500) { el.scrollTop = y; await new Promise(r => setTimeout(r, 200)); }
    }
  }).catch(() => {});
}

async function collectJobIds(page, s) {
  const ids = [];
  let lastIds = '';
  for (let pg = 0; pg < config.limits.maxPagesPerSearch; pg++) {
    if (pg === 0) await page.goto(searchUrl(s, 0), { waitUntil: 'domcontentloaded' });
    else {
      const next = page.locator('[data-testid^="pagination-controls-next-button"] button, button[data-testid^="pagination-controls-next-button"], button[aria-label="View next page"], button[aria-label="Next"]').first();
      if (!(await next.count()) || !(await next.isVisible().catch(() => false))) break;
      await next.click();
    }
    await page.waitForSelector('[componentkey^="job-card-component-ref-"], a[href*="/jobs/view/"], [data-job-id], [data-occludable-job-id]', { timeout: 15000 }).catch(() => {});
    await sleep(2000 + Math.random() * 2000);
    if (checkpoint(page)) throw new Error('LinkedIn checkpoint/captcha hit on search page');
    await scrollJobList(page);
    const { ids: pageIds, applied } = await extractJobIds(page);
    log(`   page ${pg + 1}: ${pageIds.length} jobs (${applied.length} already applied)`);
    if (!pageIds.length) { await dumpDebug(page, `search-empty-p${pg + 1}`); break; }
    const key = pageIds.join(',');
    if (key === lastIds) break; // Next did nothing: last page
    lastIds = key;
    for (const id of pageIds) if (!applied.includes(id) && !ids.includes(id)) ids.push(id);
    if (pageIds.length < 20) break;
    await sleep(1500 + Math.random() * 2500);
  }
  return ids;
}

async function readJob(page, id) {
  await page.goto(`https://www.linkedin.com/jobs/view/${id}/`, { waitUntil: 'domcontentloaded' });
  await sleep(2500 + Math.random() * 2000);
  if (checkpoint(page)) throw new Error('LinkedIn checkpoint/captcha hit on job page');
  await page.waitForSelector('button[aria-label*="Easy Apply"], button[aria-label*="Apply"], h1, [data-testid="expandable-text-box"]', { timeout: 15000 }).catch(() => {});
  const info = await page.evaluate(() => {
    const t = s => document.querySelector(s)?.innerText.replace(/\s+/g, ' ').trim() || '';
    const parts = document.title.split('|').map(x => x.trim());   // "Title | Company | LinkedIn"
    const main = document.querySelector('main') || document.body;
    const hasApplyBtn = !!document.querySelector('button[aria-label*="Easy Apply"], button[aria-label^="Apply"], button.jobs-apply-button');
    return {
      title: t('.job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, main h1, h1') || parts[0] || '',
      company: t('.job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name, [data-test-job-details-company-name]') || (parts.length >= 3 ? parts[parts.length - 2] : ''),
      description: t('#job-details, .jobs-description__content, .jobs-box__html-content, [data-testid="expandable-text-box"], [class*="description"]').slice(0, 6000),
      appliedAlready: !hasApplyBtn && /\bApplied\b|Application submitted|You applied/i.test(main.innerText || ''),
    };
  });
  if (!info.title) await dumpDebug(page, `job-${id}`);
  return { id, url: `https://www.linkedin.com/jobs/view/${id}/`, ...info };
}

function skipReason(job) {
  if (job.appliedAlready) return 'already applied';
  if (skipTitle.some(r => r.test(job.title))) return 'title filter';
  if (skipCompany.some(r => r.test(job.company))) return 'company filter';
  if (skipDesc.some(r => r.test(job.description))) return 'description filter (experience)';
  return null;
}

// ---------- the Easy Apply modal ----------
function dialogOf(page) {
  return page.locator('dialog, div[role="dialog"], .jobs-easy-apply-modal, .artdeco-modal').filter({ has: page.locator('input, select, textarea') }).last();
}

// LinkedIn sometimes puts a "Job search safety reminder" box in front of the form.
async function dismissInterstitials(page) {
  for (const sel of ['button:has-text("Continue applying")', 'button:has-text("Continue")', 'button[aria-label="Continue applying"]']) {
    const b = page.locator('dialog ' + sel + ', div[role="dialog"] ' + sel).first();
    if (await b.count() && await b.isVisible().catch(() => false)) { await b.click(); await sleep(1500); return; }
  }
}

async function clickFooter(dialog, kinds) {
  for (const k of kinds) {
    const btn = dialog.locator(k.sel).first();
    if (await btn.count() && await btn.isVisible()) { await btn.click(); return k.name; }
  }
  return null;
}
const NEXT = [
  { name: 'submit', sel: 'button[aria-label="Submit application"], button:has-text("Submit application")' },
  { name: 'review', sel: 'button[aria-label="Review your application"], button:has-text("Review")' },
  { name: 'next', sel: 'button[aria-label="Continue to next step"], button:has-text("Next")' },
];

async function discard(page) {
  try {
    const dismiss = page.locator('dialog button[aria-label="Dismiss"], div[role="dialog"] button[aria-label="Dismiss"], dialog button[aria-label="Close"]').first();
    if (await dismiss.count()) await dismiss.click();
    await sleep(1200);
    const confirm = page.locator('button[data-control-name="discard_application_confirm_btn"], button:has-text("Discard")').last();
    if (await confirm.count() && await confirm.isVisible()) await confirm.click();
    await sleep(1200);
  } catch {}
}

async function easyApply(page, job) {
  const btn = page.locator('button[aria-label*="Easy Apply"], button.jobs-apply-button, button:has-text("Easy Apply"), a[aria-label*="Easy Apply"]')
    .filter({ hasText: /easy apply/i }).first();
  if (!(await btn.count())) {
    const ext = await page.locator('button.jobs-apply-button, button[aria-label^="Apply"], button:has-text("Apply")').first().count();
    return { status: 'skipped', reason: ext ? 'external apply' : 'no apply button' };
  }
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  await btn.click();
  await sleep(2000);
  await dismissInterstitials(page);
  const dialog = dialogOf(page);
  try { await dialog.waitFor({ state: 'visible', timeout: 10000 }); }
  catch { await dumpDebug(page, `no-modal-${job.id}`); return { status: 'failed', reason: 'modal did not open' }; }
  await dialog.locator('input, select, textarea').first().waitFor({ timeout: 8000 }).catch(() => {});
  log('   🪟 Easy Apply form open');

  const forceAsk = new Set();
  let retries = 0;
  const ctx = {
    profile, profilePath, askOnUnknown, resumePath,
    unfollowCompany: config.behaviour.unfollowCompany,
    log: m => log(m), forceAsk,
    onUnanswered: (q, o, used) => recordUnanswered(job, q, o, used),
  };

  for (let step = 0; step < 20; step++) {
    const fill = await fillStep(dialog, ctx);
    log(`   step ${step + 1}: filled ${fill.filled} field(s)`);
    forceAsk.clear();
    await pause(page);
    const errorsBefore = await erroredQuestions(dialog);

    // which button is on this step?
    const hasSubmit = await dialog.locator(NEXT[0].sel).first().isVisible().catch(() => false);
    if (hasSubmit) {
      if (dryRun) { await discard(page); return { status: 'dry-run', reason: 'reached submit' }; }
      await clickFooter(dialog, [NEXT[0]]);
      await sleep(3000);
      // close "application sent" dialog
      const done = page.locator('dialog button:has-text("Done"), div[role="dialog"] button:has-text("Done"), dialog button[aria-label="Dismiss"], div[role="dialog"] button[aria-label="Dismiss"]').first();
      if (await done.count()) await done.click().catch(() => {});
      return { status: 'applied', reason: '' };
    }
    const sigBefore = await stepSignature(dialog);
    const clicked = await clickFooter(dialog, NEXT.slice(1));
    if (!clicked) { await discard(page); return { status: 'failed', reason: 'no next/review button' }; }
    await sleep(2000);

    let errors = await erroredQuestions(dialog);
    const stuck = (await stepSignature(dialog)) === sigBefore;
    if (stuck && !errors.length) errors = await unfilledQuestions(dialog);
    if (stuck && !errors.length) errors = ['(unknown: step did not advance)'];
    if (errors.length) {
      retries++;
      log(`   ⛔ validation errors: ${errors.join(' | ')}`);
      if (retries > config.behaviour.maxQuestionRetries || !askOnUnknown) {
        await discard(page);
        return { status: 'failed', reason: 'validation: ' + errors.join('; ') };
      }
      errors.forEach(q => forceAsk.add(clean(q)));
    }
  }
  await discard(page);
  return { status: 'failed', reason: 'too many steps' };
}

// ---------- main ----------
(async () => {
  if (!fs.existsSync(resumePath)) log(`⚠️  resume not found at ${resumePath} (copy your PDF there). Continuing; uploads will be skipped.`);
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome', headless: false, viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = context.pages()[0] || await context.newPage();

  if (!(await ensureLoggedIn(page))) { log('❌ login timed out'); await context.close(); process.exit(1); }
  if (flag('--login')) { log('Login saved. You can close the window.'); await context.close(); return; }

  log(`▶ mode=${dryRun ? 'DRY RUN (never submits)' : 'LIVE'}  max=${maxApps}  ask=${askOnUnknown}`);
  let applied = 0, processed = 0;
  const counts = {};
  try {
    outer: for (const s of config.searches) {
      log(`🔎 "${s.keywords}" in ${s.location}`);
      const ids = (await collectJobIds(page, s)).filter(id => !['applied', 'skipped'].includes(seen.get(String(id))));
      log(`   ${ids.length} new jobs to look at`);
      for (const id of ids) {
        if (applied >= maxApps) break outer;
        const job = await readJob(page, id);
        processed++;
        const why = skipReason(job);
        log(`\n#${processed} ${job.title} — ${job.company}`);
        if (why) { log('   ⏭  skip: ' + why); record({ jobId: id, title: job.title, company: job.company, url: job.url, status: 'skipped', reason: why }); continue; }

        let res;
        try { res = await easyApply(page, job); }
        catch (e) { res = { status: 'failed', reason: e.message.split('\n')[0] }; await discard(page); }
        record({ jobId: id, title: job.title, company: job.company, url: job.url, status: res.status, reason: res.reason });
        counts[res.status] = (counts[res.status] || 0) + 1;
        log(`   ${res.status === 'applied' ? '✅' : res.status === 'dry-run' ? '🧪' : '❌'} ${res.status} ${res.reason || ''}`);
        if (res.status === 'applied' || res.status === 'dry-run') applied++;

        const wait = rand(config.limits.delayBetweenJobsSec);
        if (applied && applied % config.limits.longBreakEveryNJobs === 0) {
          const b = rand(config.limits.longBreakSec); log(`   ☕ long break ${Math.round(b)}s`); await sleep(b * 1000);
        } else { log(`   ⏳ ${Math.round(wait)}s`); await sleep(wait * 1000); }
      }
    }
  } catch (e) {
    log('🛑 stopped: ' + e.message);
  }
  log(`\n🏁 done. processed=${processed} ${JSON.stringify(counts)}  log: ${appliedLog}`);
  await context.close();
})();
