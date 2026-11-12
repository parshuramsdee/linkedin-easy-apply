// DOM-only Easy Apply filler (shared logic with ../filler.js, ported to run inside the page).
window.EAFiller = (() => {
  const clean = s => (s || '').replace(/\s+/g, ' ').replace(/\*|Required|\(required\)/gi, '').trim();
  const textOf = el => (el ? el.innerText || el.textContent || '' : '');
  const vis = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const resolveRef = (profile, v) => (typeof v === 'string' && v.startsWith('@'))
    ? (v.slice(1).split('.').reduce((o, k) => (o ? o[k] : undefined), profile) ?? v) : v;

  function lookup(bank, profile, question) {
    const q = question.toLowerCase();
    for (const rule of bank) for (const pat of rule.match || []) {
      let re; try { re = new RegExp(pat, 'i'); } catch { continue; }
      if (re.test(q)) {
        const a = resolveRef(profile, rule.answer);
        if (a === 'FILL_ME' || a === undefined || a === null) return { answer: null, rule };
        return { answer: String(a), rule };
      }
    }
    return null;
  }

  function pickOption(options, answer) {
    if (!answer) return null;
    const a = answer.toLowerCase().trim();
    const texts = options.map(o => o.toLowerCase().trim());
    let i = texts.findIndex(t => t === a);
    const numeric = /^\d+(\.\d+)?$/.test(a);
    if (i < 0 && !numeric) i = texts.findIndex(t => t.includes(a) || a.includes(t));
    if (i < 0 && numeric) {
      const n = parseFloat(a);
      const rm = inc => t => {
        const m = t.match(/(\d+)\s*(?:-|–|to)\s*(\d+)/); if (m) return n >= +m[1] && (inc ? n <= +m[2] : n < +m[2]);
        const p = t.match(/(\d+)\s*\+/); if (p) return n >= +p[1];
        const s = t.match(/^(\d+)/); return !!s && +s[1] === n;
      };
      i = texts.findIndex(rm(false)); if (i < 0) i = texts.findIndex(rm(true));
    }
    if (i < 0 && /^(yes|y|true)$/.test(a)) i = texts.findIndex(t => /^yes\b/.test(t));
    if (i < 0 && /^(no|n|false)$/.test(a)) i = texts.findIndex(t => /^no\b/.test(t));
    return i >= 0 ? options[i] : null;
  }

  const grouping = el => el.closest('[data-test-form-element], .fb-dash-form-element, .jobs-easy-apply-form-element, fieldset, .form-group, [class*="form-element"]') || el.parentElement;
  function labelFor(root, el) {
    if (el.id) { const l = root.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l && textOf(l).trim()) return textOf(l); }
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    if (el.getAttribute('aria-labelledby')) { const l = root.querySelector('#' + CSS.escape(el.getAttribute('aria-labelledby'))); if (l) return textOf(l); }
    const g = grouping(el); const lab = g && g.querySelector('label, legend, [class*="label"]');
    if (lab && textOf(lab).trim()) return textOf(lab);
    return el.placeholder || textOf(g).split('\n')[0] || '';
  }

  // "Month"/"Year" mean nothing alone: prefix them with the step section and the nearest From/To label.
  const GENERIC = /^(month|year|day|date)$/i;
  function contextFor(root, el) {
    const section = /work experience|employment/i.test(root.innerText || '') ? 'work' : /education|school|degree/i.test(root.innerText || '') ? 'education' : '';
    let node = el, label = '';
    for (let depth = 0; depth < 6 && node && node !== root && !label; depth++) {
      let sib = node.previousElementSibling, hops = 0;
      while (sib && hops < 4) {
        const t = (sib.innerText || '').replace(/\s+/g, ' ').trim();
        if (!sib.querySelector('input, select, textarea') && t && t.length <= 25) { label = t; break; }
        sib = sib.previousElementSibling; hops++;
      }
      node = node.parentElement;
    }
    return [section, label].filter(Boolean).join(' ');
  }
  function scan(root) {
    const out = []; const seen = new Set();
    for (const el of root.querySelectorAll('input, select, textarea')) {
      const type = (el.getAttribute('type') || el.tagName).toLowerCase();
      if (['hidden', 'submit', 'button', 'file'].includes(type)) continue;
      if (!vis(el) && type !== 'radio') continue;
      const e = { el, type, tag: el.tagName.toLowerCase() };
      if (type === 'radio') {
        const key = el.name || el.closest('fieldset')?.id || el.id; if (seen.has(key)) continue; seen.add(key);
        const fs = el.closest('fieldset') || grouping(el);
        const radios = [...fs.querySelectorAll('input[type="radio"]')].filter(r => !el.name || r.name === el.name);
        const wrappers = radios.map(r => r.closest('[role="radio"]'));
        e.radios = radios;
        e.options = radios.map((r, i) => {
          const l = r.id && fs.querySelector(`label[for="${CSS.escape(r.id)}"]`); const w = wrappers[i];
          return ((l && textOf(l).trim()) || (w && textOf(w.querySelector('p, span:not(:empty)')).trim()) || (w && w.getAttribute('aria-label')) || r.getAttribute('aria-label') || r.value || '').trim();
        });
        const wl = [...new Set(wrappers.map(w => w && w.getAttribute('aria-label')).filter(Boolean))];
        const prev = fs.previousElementSibling;
        e.question = textOf(fs.querySelector('legend')).trim() || (wl.length === 1 && !e.options.includes(wl[0]) ? wl[0] : '') || fs.getAttribute('aria-label')
          || (prev && !prev.querySelector('input') ? textOf(prev).trim() : '') || labelFor(root, el);
        e.checked = radios.findIndex(r => r.checked);
      } else if (type === 'checkbox') { e.question = labelFor(root, el); e.checked = el.checked; }
      else if (e.tag === 'select') {
        e.question = labelFor(root, el); e.options = [...el.options].map(o => o.text.trim());
        e.value = el.options[el.selectedIndex]?.text.trim() || '';
        e.placeholderSelected = el.selectedIndex <= 0 || /select|choose/i.test(e.value) || !e.value;
      } else {
        e.question = labelFor(root, el); e.value = el.value || '';
        e.combobox = el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete') === 'list';
        e.numeric = type === 'number' || el.getAttribute('inputmode') === 'numeric';
        e.error = fieldError(el);
      }
      e.question = clean(e.question);
      if (GENERIC.test(e.question)) { const c = contextFor(root, el); if (c) e.question = `${c} ${e.question}`; }
      out.push(e);
    }
    return out;
  }

  const submitLike = el => el && /submit|send application|apply now/i.test(((el.getAttribute && el.getAttribute('aria-label')) || '') + ' ' + (el.innerText || ''));
  const click = el => { if (!el || submitLike(el) || el.closest('button[type="submit"]')) { console.warn('[EA] refused click', el); return false; } el.click(); return true; };
  // Text LinkedIn shows under a field after rejecting it ("Invalid input", "Enter a whole number", ...)
  function fieldError(el) {
    const ids = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    for (const id of ids) { const n = document.getElementById(id); if (n && vis(n) && /invalid|must|enter|required|number|numeric|whole|decimal|valid/i.test(n.innerText || '')) return (n.innerText || '').trim(); }
    const g = grouping(el); const err = g && [...g.querySelectorAll('[id^="error-message-"], [role="alert"], [class*="error"]')].find(n => vis(n) && (n.innerText || '').trim());
    return err ? err.innerText.trim() : '';
  }
  function setNative(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function apply(e, answer) {
    const chosen = e.options ? (pickOption(e.options.filter(o => o && !/^select|^choose/i.test(o)), answer) || (e.tag === 'select' ? null : answer)) : answer;
    if (chosen === null || chosen === undefined) return false;
    if (e.type === 'radio') {
      const i = e.options.indexOf(chosen); if (i < 0) return false;
      const r = e.radios[i]; const w = r.closest('[role="radio"]'); const l = r.id && document.querySelector(`label[for="${CSS.escape(r.id)}"]`);
      click(w || (l && textOf(l).trim() ? l : r));
      if (!r.checked) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
    } else if (e.tag === 'select') {
      const opt = [...e.el.options].find(o => o.text.trim() === chosen); if (!opt) return false;
      e.el.value = opt.value; e.el.dispatchEvent(new Event('input', { bubbles: true })); e.el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (e.combobox) {
      e.el.focus(); setNative(e.el, chosen); await sleep(1200);
      const opt = [...document.querySelectorAll('[role="listbox"] [role="option"]')].find(vis); if (opt && !submitLike(opt)) opt.click();
    } else {
      e.el.focus(); setNative(e.el, chosen); e.el.blur();
    }
    return true;
  }

  // Fill every control in root. Returns { filled, unknown: [{question, entry, options}] }
  async function fill(root, ctx) {
    const res = { filled: 0, unknown: [] };
    for (const e of scan(root)) {
      if (!e.question) continue;
      if (!document.contains(e.el) || (e.type !== 'radio' && !vis(e.el))) continue;
      if (e.type === 'checkbox') {
        if (/follow/i.test(e.question) && /company|page/i.test(e.question)) { if (ctx.unfollow && e.el.checked) click(e.el); continue; }
        const h = lookup(ctx.bank, ctx.profile, e.question);
        if (h && h.answer && /^(yes|true|check)/i.test(h.answer) && !e.el.checked) { click(e.el); res.filled++; }
        continue;
      }
      const rejected = !!(e.error && e.value);           // LinkedIn refused what is in the box
      const needs = (e.type === 'radio' && e.checked < 0) || (e.tag === 'select' && e.placeholderSelected) || (e.tag !== 'select' && e.type !== 'radio' && (!e.value || rejected));
      if (!needs) continue;
      const h = lookup(ctx.bank, ctx.profile, e.question);
      if (h && h.answer === 'SKIP') continue;
      let answer = h ? h.answer : null;
      const digitsOf = a => { const d = (a || '').match(/\d+(\.\d+)?/); return d ? d[0] : null; };
      if (answer && (e.numeric || rejected) && !e.options) answer = digitsOf(answer);
      if (answer && await apply(e, answer)) {
        // if LinkedIn flags the value, retry once with just the number ("4 LPA" -> "4", "0 days" -> "0")
        if (!e.options) {
          await sleep(350);
          const err = fieldError(e.el);
          if (err && digitsOf(answer) && digitsOf(answer) !== answer) { await apply(e, digitsOf(answer)); await sleep(350); }
          const still = fieldError(e.el);
          if (still) { res.unknown.push({ question: e.question, entry: e, options: null, numeric: true, label: `${e.question} — LinkedIn says "${still}"` }); continue; }
        }
        res.filled++; await sleep(150); continue;
      }
      const dup = res.unknown.filter(u => u.question === e.question).length;
      const label = (dup ? `${e.question} (${dup + 1})` : e.question) + (e.error ? ` — LinkedIn says "${e.error}"` : '');
      res.unknown.push({ question: e.question, entry: e, options: e.options ? e.options.filter(o => o && !/^select|^choose/i.test(o)) : null, numeric: !!e.numeric || rejected, label });
    }
    return res;
  }

  const signature = root => [...root.querySelectorAll('input, select, textarea')].map(e => e.id || e.name || e.getAttribute('aria-label') || '').join('|');
  return { scan, fill, apply, lookup, pickOption, clean, signature };
})();
