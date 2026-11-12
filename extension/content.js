// Easy Apply Helper: floating panel on LinkedIn job pages and search pages.
(async () => {
  if (window.top !== window) return;
  // After the extension is reloaded (↻ / chrome://extensions), scripts already running in open tabs lose
  // access to chrome.* ("Extension context invalidated"). Detect that and ask for a tab refresh instead of throwing.
  const alive = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch { return false; } };
  let deadShown = false;
  const onDead = () => {
    if (deadShown) return; deadShown = true;
    const s = document.getElementById('ea-status');
    if (s) s.textContent = '⚠ Helper was reloaded. Refresh this tab (Cmd+R) to use it again.';
  };
  const isDeadErr = e => /context invalidated|reading 'local'|reading 'sendMessage'|Receiving end does not exist/i.test(String(e && (e.message || e)));
  window.addEventListener('unhandledrejection', e => { if (isDeadErr(e.reason)) { e.preventDefault(); onDead(); } });
  window.addEventListener('error', e => { if (isDeadErr(e.error || e.message)) { e.preventDefault(); onDead(); } });
  const send = msg => { if (!alive()) { onDead(); return Promise.resolve(); } return chrome.runtime.sendMessage(msg).catch(e => { if (isDeadErr(e)) onDead(); }); };
  if (!alive()) return;
  const F = window.EAFiller;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // HARD RULE: nothing this helper clicks may be a submit control. Submitting is always the user's own click.
  const isSubmitLike = el => el && /submit|send application|apply now/i.test(((el.getAttribute && el.getAttribute('aria-label')) || '') + ' ' + (el.innerText || '') + ' ' + ((el.getAttribute && el.getAttribute('type')) || ''));
  const safeClick = el => { if (!el) return false; if (isSubmitLike(el)) { console.warn('[EA] refused to click submit-like control', el); return false; } el.click(); return true; };
  window.EAFiller.safeClick = safeClick;
  const store = {
    async get() { if (!alive()) { onDead(); return {}; } return chrome.storage.local.get(['profile', 'config', 'learned', 'settings', 'opened', 'applied']); },
    async set(o) { if (!alive()) { onDead(); return; } return chrome.storage.local.set(o); },
  };
  let S = await chrome.storage.local.get(['profile', 'config', 'learned', 'settings', 'opened', 'applied', 'profileLoadedAt', 'profileMissing']);
  if (!S.profile) { await send({ type: 'reseed' }); S = await store.get(); }
  S.learned = S.learned || []; S.opened = S.opened || {}; S.applied = S.applied || {}; S.settings = S.settings || {};
  const bank = () => [...S.learned, ...((S.profile || {}).answers || [])];
  const escapeRe = s => s.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const jobId = () => (location.pathname.match(/\/jobs\/view\/(\d+)/) || location.search.match(/currentJobId=(\d+)/) || [])[1];
  const isSearch = () => /\/jobs\/(search|collections)/.test(location.pathname);

  // ---------- panel ----------
  // The panel is its own <form> so that no button or Enter key inside it can ever reach LinkedIn's application form.
  const panel = document.createElement('form'); panel.id = 'ea-panel'; panel.setAttribute('autocomplete', 'off');
  {  // built with createElement: LinkedIn enforces Trusted Types, so innerHTML is not reliable here
    const h4 = document.createElement('h4'); const t = document.createElement('span'); t.textContent = '⚡ Easy Apply Helper';
    const min = document.createElement('button'); min.type = 'button'; min.className = 'ea-secondary'; min.id = 'ea-min'; min.textContent = '–';
    const rl = document.createElement('button'); rl.type = 'button'; rl.className = 'ea-secondary'; rl.id = 'ea-reload'; rl.textContent = '↻'; rl.title = 'Reload the extension from disk (after git pull / editing profile.json)';
    rl.onclick = () => send({ type: 'reloadExt' });
    const grp = document.createElement('span'); grp.append(rl, document.createTextNode(' '), min);
    h4.append(t, grp); panel.appendChild(h4);
    for (const [id, cls] of [['ea-status', 'ea-status'], ['ea-unknown', ''], ['ea-actions', 'ea-row'], ['ea-hint', 'ea-small']]) { const d = document.createElement('div'); d.id = id; if (cls) d.className = cls; panel.appendChild(d); }
  }
  panel.addEventListener('submit', e => { e.preventDefault(); e.stopPropagation(); });
  panel.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); e.stopPropagation(); } });
  document.documentElement.appendChild(panel);
  const mountPanel = d => {
    // keep the panel inside the modal (so it stays clickable) but never inside LinkedIn's <form>
    let host = d ? (d.closest('dialog') || d) : document.documentElement;
    if (host.closest && host.closest('form')) host = document.documentElement;
    if (panel.parentElement !== host) host.appendChild(panel);
  };
  const $ = id => panel.querySelector('#' + id);
  $('ea-min').onclick = () => panel.classList.toggle('ea-min');
  const status = (t) => { $('ea-status').textContent = t; };
  const btn = (label, fn, secondary) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (secondary) b.className = 'ea-secondary'; b.onclick = fn; $('ea-actions').appendChild(b); return b; };

  // ---------- job page ----------
  const vis = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const dialog = () => [...document.querySelectorAll('dialog[open], dialog, div[role="dialog"]')]
    .filter(d => vis(d) && (d.querySelector('input, select, textarea') || [...d.querySelectorAll('button')].some(b => /^(next|review|submit application|back)$/i.test((b.innerText || '').trim()))))
    .pop();
  const stepKey = d => F.signature(d) + '|' + ((d.innerText || '').match(/\d+\s*\/\s*\d+ pages?/) || [''])[0];
  const footerBtn = re => [...(dialog() || document).querySelectorAll('button')].filter(b => !panel.contains(b))
    .find(b => re.test((b.getAttribute('aria-label') || '').trim()) || re.test((b.innerText || '').trim()));
  const nextBtn = () => { const b = footerBtn(/^(next|continue to next step|review|review your application)\b/i); return b && !isSubmitLike(b) ? b : null; };
  const submitBtn = () => footerBtn(/submit application/i);
  const easyApplyBtn = () => [...document.querySelectorAll('button')].filter(b => !panel.contains(b)).find(b => /easy apply/i.test(b.getAttribute('aria-label') || b.innerText));

  let lastSig = '', autoClickedFor = '', pending = [];
  async function runStep(reason) {
    const d = dialog(); if (!d) return;
    const sig = stepKey(d);
    const ctx = { bank: bank(), profile: S.profile, unfollow: (S.config?.behaviour?.unfollowCompany) !== false };
    const r = await F.fill(d, ctx);
    pending = r.unknown;
    renderUnknown();
    const sub = submitBtn();
    if (sub) { status(`Filled ${r.filled}. Review page: check it, then click LinkedIn's Submit yourself.`); return; }
    if (pending.length) { status(`Filled ${r.filled}. ${pending.length} question(s) need you ↓ then "Save & Next".`); return; }
    status(`Filled ${r.filled} field(s) on this step.`);
    if (S.settings.autoNext !== false && sig !== autoClickedFor) {
      autoClickedFor = sig; await sleep(700);
      if (sig === lastSig && reason === 'auto') { status('Step did not advance. Check the form for an error, fix it, then click Next.'); return; }
      lastSig = sig; const n = nextBtn(); if (n) safeClick(n);
    }
  }
  function renderUnknown() {
    const box = $('ea-unknown'); box.replaceChildren();
    pending.forEach((u, i) => {
      const q = document.createElement('div'); q.className = 'ea-q';
      const lab = document.createElement('label'); lab.textContent = u.label || u.question; q.appendChild(lab);
      let input;
      if (u.options && u.options.length) {
        input = document.createElement('select');
        const ph = document.createElement('option'); ph.value = ''; ph.textContent = '— choose —'; input.appendChild(ph);
        for (const o of u.options) { const op = document.createElement('option'); op.textContent = o; input.appendChild(op); }
      }
      else if (u.entry.tag === 'textarea') { input = document.createElement('textarea'); input.rows = 3; }
      else { input = document.createElement('input'); input.placeholder = u.numeric ? 'number' : 'answer'; }
      input.dataset.i = i; q.appendChild(input); box.appendChild(q);
    });
    if (pending.length) { const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Save & Next ▶'; b.onclick = saveAndNext; box.appendChild(b); }
  }
  async function saveAndNext() {
    const inputs = [...$('ea-unknown').querySelectorAll('input, select, textarea')];
    for (const inp of inputs) {
      const u = pending[+inp.dataset.i]; const v = inp.value.trim(); if (!v) continue;
      await F.apply(u.entry, v);
      // date parts and other context-free labels are answered each time, never memorised
      if (/^(month|year|day|date|from|to|start|end)$/i.test(u.question)) continue;
      const key = '^' + escapeRe(u.question) + '$';
      S.learned = S.learned.filter(l => l.match[0] !== key);
      S.learned.unshift({ match: [key], answer: v });
    }
    await store.set({ learned: S.learned });
    pending = []; renderUnknown(); autoClickedFor = '';
    const n = nextBtn(); if (n) safeClick(n); else await runStep('manual');
  }
  async function markApplied() {
    const id = jobId(); if (!id) return;
    S.applied[id] = Date.now(); await store.set({ applied: S.applied });
    status('✅ Applied. Close this tab (Alt+W) and move to the next one.');
  }

  if (jobId() && !isSearch()) {
    const id = jobId();
    if (S.applied[id]) status('Already applied to this job (per helper history).');
    else status('Click "Easy Apply + Fill" or press Alt+A.');
    // Tabs opened by the batch opener start on their own: the user should only have to press Submit.
    if (S.opened[id] && !S.applied[id] && S.settings.autoStart !== false) {
      status('Auto-starting Easy Apply…');
      let tries = 0;
      const tick = () => {
        const b = easyApplyBtn();
        if (b) { safeClick(b); return; }
        if (++tries < 12) setTimeout(tick, 1000);
        else status(/\bApplied\b|Application submitted/i.test(document.body.innerText) ? 'Already applied to this job.' : 'No Easy Apply button on this page (external apply or closed).');
      };
      setTimeout(tick, 1500);
    }
    btn('Easy Apply + Fill', async () => { const b = easyApplyBtn(); if (!b) return status('No Easy Apply button on this page.'); safeClick(b); });
    btn('Fill step', () => runStep('manual'), true);
    btn('Next ▶', () => { const n = nextBtn(); n ? safeClick(n) : status('No Next button.'); }, true);
    btn('Mark applied', markApplied, true);
    btn('Close tab', () => send({ type: 'closeTab' }), true);
    $('ea-hint').textContent = (S.profileMissing ? '⚠ profile.json missing: copy profile.example.json to profile.json, fill it, run node sync-extension.js, then ↻. ' : '') + `Alt+A apply · Alt+F fill · Alt+N next · Alt+W close tab. Submit is always your click. Answers loaded ${S.profileLoadedAt ? new Date(S.profileLoadedAt).toLocaleString() : '(unknown)'}; ${S.learned.length} learned.`;
    document.addEventListener('keydown', e => {
      if (!e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'a') safeClick(easyApplyBtn()); else if (k === 'f') runStep('manual'); else if (k === 'n') safeClick(nextBtn()); else if (k === 'w') send({ type: 'closeTab' });
    });
    // watch the dialog: fill whenever a step renders; detect submission
    let t = null, hadDialog = false;
    new MutationObserver(records => {
      if (records.every(r => panel.contains(r.target))) return; // ignore our own panel updates
      const d = dialog();
      mountPanel(d); // a modal <dialog> swallows clicks outside itself, so the panel lives inside it while open
      if (d) { hadDialog = true; clearTimeout(t); t = setTimeout(() => { const s = stepKey(d); if (s !== lastSig || pending.length === 0) runStep('auto'); }, 700); }
      else if (hadDialog) { hadDialog = false; }
      // the "Application sent" confirmation is itself a dialog (without inputs), so look at every dialog on the page
      const anyDialog = [...document.querySelectorAll('dialog, div[role="dialog"]')].map(x => x.innerText || '').join(' ');
      if (/application (was )?sent|application submitted/i.test(anyDialog) && !S.applied[id]) markApplied();
    }).observe(document.body, { childList: true, subtree: true });
  }

  // ---------- search page (LinkedIn or Naukri): serial batch opener ----------
  const site = /naukri\.com$/.test(location.hostname) ? 'naukri' : 'linkedin';
  const skipRe = (S.config?.behaviour?.skipIfTitleMatches || []).map(p => new RegExp(p, 'i'));
  const listJobs = () => {
    if (site === 'naukri') {
      const seen = new Map();
      document.querySelectorAll(".srp-jobtuple-wrapper a.title[href], .cust-job-tuple a.title[href], a.title[href*='job-listings'], a[href*='-job-listings-']").forEach(a => {
        try {
          const u = new URL(a.href, location.href); if (!u.pathname.includes('job-listings')) return; u.search = ''; u.hash = '';
          if (!seen.has(u.href)) seen.set(u.href, { id: u.href, url: u.href, title: (a.innerText || '').trim() || 'View job', el: a.closest('.srp-jobtuple-wrapper, .cust-job-tuple') || a, easy: true, applied: false });
        } catch {}
      });
      return [...seen.values()];
    }
    // LinkedIn nests two elements with the same componentkey per card: keep only the outermost per job id
    const byId = new Map();
    for (const c of document.querySelectorAll('[componentkey^="job-card-component-ref-"]')) {
      const id = (c.getAttribute('componentkey').match(/(\d{6,})/) || [])[1]; if (!id || byId.has(id)) continue;
      const text = c.innerText || '';
      byId.set(id, { id, url: `https://www.linkedin.com/jobs/view/${id}/`, el: c, title: text.split('\n').map(x => x.trim()).filter(Boolean)[0] || '', easy: /easy apply/i.test(text), applied: /\bApplied\b/.test(text) });
    }
    return [...byId.values()];
  };
  const titleFilterOn = () => S.settings.titleFilter !== false;
  const eligible = j => j.easy && !j.applied && !S.applied[j.id] && !(titleFilterOn() && skipRe.some(r => r.test(j.title)));
  const remaining = () => listJobs().filter(j => eligible(j) && !S.opened[j.id]);

  if (site === 'naukri' ? listJobs().length > 0 : isSearch()) {
    const badge = el => { if (el.querySelector('.ea-badge')) return; const b = document.createElement('span'); b.className = 'ea-badge'; b.textContent = '✓ opened'; el.insertBefore(b, el.firstChild); };
    const refresh = () => {
      const jobs = listJobs(); const rem = remaining();
      jobs.forEach(j => { if (S.opened[j.id] || S.applied[j.id]) badge(j.el); });
      const applied = jobs.filter(j => j.applied || S.applied[j.id]).length, ext = jobs.filter(j => !j.easy).length;
      const byTitle = jobs.filter(j => j.easy && !j.applied && !S.applied[j.id] && skipRe.some(r => r.test(j.title))).length;
      status(`Found: ${jobs.length} | Remaining: ${rem.length} | Opened: ${Object.keys(S.opened).length}\nSkipped here: ${applied} applied, ${ext} external, ${titleFilterOn() ? byTitle : 0} by title (senior/lead/manager…)`);
      openBtn.textContent = `Open next ${Math.min(+batchInput.value || 5, rem.length)} jobs`; openBtn.disabled = rem.length === 0;
    };
    const openBatch = async () => {
      if (!alive()) return onDead();   // do not mark jobs opened if the tabs cannot be opened
      const n = +batchInput.value || 5; const pick = remaining().slice(0, n);   // page order, top to bottom
      if (!pick.length) return status('Nothing new on this page. Scroll down or go to the next page.');
      pick.forEach(j => { S.opened[j.id] = Date.now(); });
      await store.set({ opened: S.opened, settings: { ...S.settings, batch: n } });
      await send({ type: 'openTabs', urls: pick.map(j => j.url) });
      refresh();
    };
    const row = document.createElement('div'); row.className = 'ea-row';
    const batchInput = document.createElement('input'); batchInput.type = 'number'; batchInput.min = 1; batchInput.max = 15; batchInput.value = S.settings.batch || 5; batchInput.style.width = '56px'; batchInput.onchange = refresh;
    const lbl = document.createElement('span'); lbl.textContent = 'Batch size '; row.append(lbl, batchInput); $('ea-actions').before(row);
    const frow = document.createElement('label'); frow.className = 'ea-small'; frow.style.display = 'block';
    const fcb = document.createElement('input'); fcb.type = 'checkbox'; fcb.checked = titleFilterOn();
    fcb.onchange = async () => { S.settings.titleFilter = fcb.checked; await store.set({ settings: S.settings }); refresh(); };
    frow.append(fcb, document.createTextNode(' Skip senior / lead / manager titles')); $('ea-actions').before(frow);
    const openBtn = btn('Open next 5 jobs', openBatch);
    btn('Reset history', async () => { S.opened = {}; await store.set({ opened: {} }); panel.ownerDocument.querySelectorAll('.ea-badge').forEach(b => b.remove()); refresh(); }, true);
    btn('Close panel', () => panel.remove(), true);
    $('ea-hint').textContent = (site === 'naukri' ? 'Naukri: opens job pages in order. ' : 'Opens Easy Apply jobs in page order; already-applied, external and title-filtered cards are skipped. ') + 'Alt+O = open next batch.';
    document.addEventListener('keydown', e => { if (e.altKey && e.key.toLowerCase() === 'o') openBatch(); });
    refresh(); const iv = setInterval(() => { if (!alive()) { clearInterval(iv); onDead(); return; } refresh(); }, 2500);
  }
})();
