// Generic Easy Apply form filler. Works on any dialog: enumerates visible controls,
// derives the question text, looks it up in the answers bank, and fills it.
const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');

const rl = () => readline.createInterface({ input: process.stdin, output: process.stdout });

function clean(s) {
  return (s || '')
    .replace(/\s+/g, ' ')
    .replace(/\*|Required|\(required\)/gi, '')
    .trim();
}

function resolveRef(profile, value) {
  if (typeof value === 'string' && value.startsWith('@')) {
    const v = value.slice(1).split('.').reduce((o, k) => (o ? o[k] : undefined), profile);
    return v === undefined ? value : v;
  }
  return value;
}

// Returns { answer, rule } or null when unknown / FILL_ME.
function lookupAnswer(profile, question) {
  const q = question.toLowerCase();
  for (const rule of profile.answers) {
    for (const pat of rule.match) {
      let re;
      try { re = new RegExp(pat, 'i'); } catch { continue; }
      if (re.test(q)) {
        const answer = resolveRef(profile, rule.answer);
        if (answer === 'FILL_ME' || answer === undefined || answer === null) return { answer: null, rule };
        if (answer === 'SKIP') return { answer: 'SKIP', rule };
        return { answer: String(answer), rule };
      }
    }
  }
  return null;
}

function saveAnswer(profile, profilePath, question, answer, existingRule) {
  if (existingRule) {
    existingRule.answer = answer;
  } else {
    const escaped = question.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    profile.answers.unshift({ match: [escaped], answer });
  }
  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2));
}

function pickOption(options, answer) {
  if (!answer) return null;
  const a = answer.toLowerCase().trim();
  const texts = options.map(o => o.toLowerCase().trim());
  let i = texts.findIndex(t => t === a);
  const numeric = /^\d+(\.\d+)?$/.test(a);
  if (i < 0 && !numeric) i = texts.findIndex(t => t.includes(a) || a.includes(t));
  if (i < 0 && numeric) {
    // numeric answer vs ranges like "1-3 years", "0-1", "3+"; prefer [lo,hi) so 1 -> "1-3" not "0-1"
    const n = parseFloat(a);
    const rangeMatch = inclusive => t => {
      const m = t.match(/(\d+)\s*(?:-|–|to)\s*(\d+)/);
      if (m) return n >= +m[1] && (inclusive ? n <= +m[2] : n < +m[2]);
      const p = t.match(/(\d+)\s*\+/);
      if (p) return n >= +p[1];
      const s = t.match(/^(\d+)/);
      return !!s && +s[1] === n;
    };
    i = texts.findIndex(rangeMatch(false));
    if (i < 0) i = texts.findIndex(rangeMatch(true));
  }
  if (i < 0 && /^(yes|y|true)$/.test(a)) i = texts.findIndex(t => /^yes\b/.test(t));
  if (i < 0 && /^(no|n|false)$/.test(a)) i = texts.findIndex(t => /^no\b/.test(t));
  return i >= 0 ? options[i] : null;
}

async function ask(question, options, hint) {
  const r = rl();
  console.log('\n   ❓ Unknown question: ' + question);
  if (options && options.length) options.forEach((o, i) => console.log(`      ${i + 1}) ${o}`));
  if (hint) console.log('      (' + hint + ')');
  let a = (await r.question('   Your answer (number or text, blank = skip): ')).trim();
  r.close();
  if (options && options.length && /^\d+$/.test(a) && +a >= 1 && +a <= options.length) a = options[+a - 1];
  return a;
}

// Describes every answerable control in the dialog. Runs in the page.
async function scanControls(dialog) {
  return dialog.evaluate(root => {
    const vis = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const textOf = el => (el ? el.innerText || el.textContent || '' : '');
    const grouping = el => el.closest('[data-test-form-element], .fb-dash-form-element, .jobs-easy-apply-form-element, .jobs-easy-apply-form-section__grouping, fieldset, .form-group, [class*="form-element"]') || el.parentElement;
    const labelFor = el => {
      if (el.id) {
        const l = root.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l && textOf(l).trim()) return textOf(l);
      }
      const aria = el.getAttribute('aria-label');
      if (aria) return aria;
      if (el.getAttribute('aria-labelledby')) {
        const l = root.querySelector('#' + CSS.escape(el.getAttribute('aria-labelledby')));
        if (l) return textOf(l);
      }
      const g = grouping(el);
      const lab = g && (g.querySelector('label, legend, .fb-dash-form-element__label, span[class*="label"]'));
      if (lab) return textOf(lab);
      return el.placeholder || textOf(g).split('\n')[0] || '';
    };
    const out = [];
    const seenRadio = new Set();
    let idx = 0;
    for (const el of root.querySelectorAll('input, select, textarea')) {
      const type = (el.getAttribute('type') || el.tagName).toLowerCase();
      if (type === 'hidden' || type === 'submit' || type === 'button') continue;
      if (type !== 'file' && !vis(el)) continue;
      if (type === 'radio') {
        const key = el.name || el.closest('fieldset')?.id || el.id;
        if (seenRadio.has(key)) continue;
        seenRadio.add(key);
      }
      el.setAttribute('data-ea-idx', String(idx));
      const entry = { idx, type, tag: el.tagName.toLowerCase(), name: el.name || '', id: el.id || '' };
      idx++;
      if (type === 'radio') {
        const fs = el.closest('fieldset') || grouping(el);
        const radios = [...(fs.querySelectorAll('input[type="radio"]'))].filter(r => !el.name || r.name === el.name);
        // option text: <label for>, else the <p> inside the [role=radio] wrapper (new UI), else wrapper/input aria-label
        const wrappers = radios.map(r => r.closest('[role="radio"]'));
        entry.options = radios.map((r, i) => {
          const l = r.id && fs.querySelector(`label[for="${CSS.escape(r.id)}"]`);
          const w = wrappers[i];
          return ((l && textOf(l).trim()) || (w && textOf(w.querySelector('p, span:not(:empty)')).trim()) || (w && w.getAttribute('aria-label')) || r.getAttribute('aria-label') || r.value || '').trim();
        });
        // question: <legend>, else the shared aria-label of the wrappers (new UI), else text just above the fieldset
        const wrapLabels = [...new Set(wrappers.map(w => w && w.getAttribute('aria-label')).filter(Boolean))];
        const prev = fs.previousElementSibling;
        entry.question = textOf(fs.querySelector('legend')).trim()
          || (wrapLabels.length === 1 && !entry.options.includes(wrapLabels[0]) ? wrapLabels[0] : '')
          || fs.getAttribute('aria-label')
          || (prev && !prev.querySelector('input') ? textOf(prev).trim() : '')
          || labelFor(el);
        entry.radioIdx = radios.map(r => { const i = idx++; r.setAttribute('data-ea-idx', String(i)); return i; });
        entry.checked = radios.findIndex(r => r.checked);
      } else if (type === 'checkbox') {
        entry.question = labelFor(el);
        entry.checked = el.checked;
      } else if (entry.tag === 'select') {
        entry.question = labelFor(el);
        entry.options = [...el.options].map(o => o.text.trim());
        entry.value = el.options[el.selectedIndex]?.text.trim() || '';
        entry.placeholderSelected = el.selectedIndex <= 0 || /select|choose/i.test(entry.value);
      } else if (type === 'file') {
        entry.question = labelFor(el);
        entry.accept = el.accept || '';
      } else {
        entry.question = labelFor(el);
        entry.value = el.value || '';
        entry.combobox = el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete') === 'list';
        entry.inputmode = el.getAttribute('inputmode') || '';
      }
      entry.question = (entry.question || '').replace(/\s+/g, ' ').trim();
      out.push(entry);
    }
    return out;
  });
}

function isYesNo(options) {
  const t = options.map(o => o.toLowerCase());
  return t.some(o => /^yes\b/.test(o)) && t.some(o => /^no\b/.test(o));
}

/**
 * Fill every control in the dialog.
 * ctx: { profile, profilePath, askOnUnknown, resumePath, unfollowCompany, log, forceAsk:Set<question>, onUnanswered(q, opts) }
 * Returns { filled, unknown:[question...] }
 */
async function fillStep(dialog, ctx) {
  const controls = await scanControls(dialog);
  const result = { filled: 0, unknown: [] };
  const log = ctx.log || (() => {});

  for (const c of controls) {
    const question = clean(c.question);
    const sel = `[data-ea-idx="${c.idx}"]`;
    const el = dialog.locator(sel).first();
    const force = ctx.forceAsk && ctx.forceAsk.has(question);

    // ---------- file upload ----------
    if (c.type === 'file') {
      if (!/resume|cv|curriculum/i.test(question) && !/pdf/i.test(c.accept)) continue;
      const alreadySelected = await dialog.locator('[class*="document-upload"][class*="selected"], [class*="jobs-document-upload"] input[type="radio"]:checked, [class*="resume"][aria-checked="true"]').count();
      if (alreadySelected && !force) { log('   📄 resume already selected'); continue; }
      if (ctx.resumePath && fs.existsSync(ctx.resumePath)) {
        await el.setInputFiles(ctx.resumePath);
        await dialog.page().waitForTimeout(1500);
        log('   📄 uploaded resume');
        result.filled++;
      } else {
        log('   ⚠️  resume file not found: ' + ctx.resumePath);
      }
      continue;
    }

    // ---------- checkbox ----------
    if (c.type === 'checkbox') {
      if (/follow/i.test(question) && /company|page/i.test(question)) {
        if (ctx.unfollowCompany && c.checked) { await el.scrollIntoViewIfNeeded().catch(() => {}); await el.evaluate(e => e.click()); log('   ☐ unfollowed company'); }
        continue;
      }
      const hit = lookupAnswer(ctx.profile, question);
      if (hit && hit.answer && /^(yes|true|check)/i.test(hit.answer) && !c.checked) {
        await el.scrollIntoViewIfNeeded().catch(() => {}); await el.evaluate(e => e.click()); result.filled++; log('   ☑ ' + question);
      }
      continue;
    }

    const needsValue =
      (c.type === 'radio' && (c.checked < 0 || force)) ||
      (c.tag === 'select' && (c.placeholderSelected || force)) ||
      (c.tag !== 'select' && c.type !== 'radio' && (!c.value || force));
    if (!needsValue) continue;

    // ---------- resolve answer ----------
    const options = c.options ? c.options.filter(o => o && !/^select|^choose/i.test(o)) : null;
    let hit = force ? null : lookupAnswer(ctx.profile, question);
    let answer = hit ? hit.answer : null;
    if (answer === 'SKIP') { log(`   ⏭  ${question} (left blank on purpose)`); continue; }
    let chosen = options ? pickOption(options, answer) : answer;
    const isNumeric = c.type === 'number' || c.inputmode === 'numeric' || /how many|years|number of/i.test(question);

    if (!chosen && isNumeric && answer && !options) {
      const digits = answer.match(/\d+(\.\d+)?/);
      chosen = digits ? digits[0] : null;
    }

    if (!chosen) {
      if (ctx.askOnUnknown) {
        const typed = await ask(question, options, isNumeric ? 'numeric answer expected' : (c.type === 'radio' || c.tag === 'select' ? 'pick an option' : 'free text'));
        if (typed) {
          chosen = options ? (pickOption(options, typed) || typed) : typed;
          saveAnswer(ctx.profile, ctx.profilePath, question, chosen, hit && hit.rule);
        }
      }
      if (!chosen) {
        // fall back to defaults so we at least try to move forward
        if (options && isYesNo(options)) chosen = pickOption(options, ctx.profile.defaults.yesNoDefault);
        else if (options) chosen = null;
        else if (isNumeric) chosen = ctx.profile.defaults.numericDefault;
        else chosen = ctx.profile.defaults.textDefault;
        result.unknown.push(question);
        if (ctx.onUnanswered) ctx.onUnanswered(question, options, chosen);
        log(`   ⚠️  no answer for "${question}" -> ${chosen === null ? 'left blank' : 'default "' + chosen + '"'}`);
        if (chosen === null) continue;
      }
    }

    // ---------- apply the value ----------
    try {
      if (c.type === 'radio') {
        const i = c.options.indexOf(chosen);
        if (i < 0) continue;
        const r = dialog.locator(`[data-ea-idx="${c.radioIdx[i]}"]`).first();
        const wrapper = r.locator('xpath=ancestor::*[@role="radio"][1]');
        const rid = await r.getAttribute('id');
        const label = rid ? dialog.locator(`label[for="${rid}"]`).first() : null;
        if (await wrapper.count()) await wrapper.click();
        else if (label && await label.count() && (await label.innerText()).trim()) await label.click();
        else await r.check({ force: true });
        if (!(await r.isChecked().catch(() => false))) await r.check({ force: true });
      } else if (c.tag === 'select') {
        await el.selectOption({ label: chosen });
      } else if (c.combobox) {
        await el.click();
        await el.fill(chosen);
        await dialog.page().waitForTimeout(1200);
        await el.press('ArrowDown');
        await el.press('Enter');
      } else {
        await el.click();
        await el.fill(chosen);
      }
      result.filled++;
      log(`   ✏️  ${question} -> ${chosen}`);
      await dialog.page().waitForTimeout(250 + Math.random() * 400);
    } catch (e) {
      log(`   ⚠️  could not fill "${question}": ${e.message.split('\n')[0]}`);
    }
  }
  return result;
}

// Questions whose groupings currently show a validation error.
async function erroredQuestions(dialog) {
  const qs = await dialog.evaluate(root => {
    const out = [];
    for (const err of root.querySelectorAll('.artdeco-inline-feedback--error, [role="alert"], .fb-form-element__error-text, [id$="-error"], [id^="error-message-"]')) {
      if (!err.offsetHeight || !(err.innerText || '').trim()) continue;
      // new UI: the control points at its error via aria-describedby
      const ctrl = err.id && root.querySelector(`[aria-describedby~="${CSS.escape(err.id)}"]`);
      if (ctrl) {
        const l = ctrl.id && root.querySelector(`label[for="${CSS.escape(ctrl.id)}"]`);
        const q = (l && l.innerText.trim()) || ctrl.getAttribute('aria-label') || (ctrl.querySelector && ctrl.querySelector('legend')?.innerText) || '';
        if (q) { out.push(q.replace(/\s+/g, ' ').trim()); continue; }
      }
      const g = err.closest('[data-test-form-element], .fb-dash-form-element, .jobs-easy-apply-form-element, fieldset, .form-group, [class*="form-element"]');
      const lab = g && g.querySelector('label, legend, [class*="label"]');
      out.push((lab ? lab.innerText : g ? g.innerText.split('\n')[0] : err.innerText).replace(/\s+/g, ' ').trim());
    }
    return out;
  });
  return [...new Set(qs.map(clean).filter(Boolean))];
}

// Questions that still have no value (radio groups unchecked, selects at placeholder, empty required inputs).
async function unfilledQuestions(dialog) {
  const controls = await scanControls(dialog);
  const req = await dialog.evaluate(() => [...document.querySelectorAll('[data-ea-idx]')].map(e => e.required || e.getAttribute('aria-required') === 'true'));
  return controls.filter(c =>
    (c.type === 'radio' && c.checked < 0) ||
    (c.tag === 'select' && c.placeholderSelected) ||
    (c.tag !== 'select' && c.type !== 'radio' && c.type !== 'checkbox' && c.type !== 'file' && !c.value && req[c.idx])
  ).map(c => clean(c.question)).filter(Boolean);
}

// A fingerprint of the controls on the current step, to detect "Next did nothing".
async function stepSignature(dialog) {
  return dialog.evaluate(r => [...r.querySelectorAll('input, select, textarea')].map(e => e.id || e.name || e.getAttribute('aria-label') || '').join('|'));
}

module.exports = { fillStep, lookupAnswer, pickOption, erroredQuestions, unfilledQuestions, stepSignature, clean };
