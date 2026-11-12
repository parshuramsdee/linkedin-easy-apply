const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { fillStep } = require('../filler');

(async () => {
  const profile = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture-profile.json'), 'utf8'));
  const resume = path.join(__dirname, 'dummy-resume.pdf');
  fs.writeFileSync(resume, '%PDF-1.4\n%dummy\n');
  process.on('exit', () => { try { fs.unlinkSync(resume); fs.unlinkSync(path.join(__dirname, 'profile-copy.json')); } catch {} });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.goto('file://' + path.join(__dirname, 'mock-form.html'));
  const dialog = page.locator('div[role="dialog"]');
  const unanswered = [];
  const res = await fillStep(dialog, {
    profile, profilePath: path.join(__dirname, 'profile-copy.json'), askOnUnknown: false, resumePath: resume,
    unfollowCompany: true, log: m => console.log(m), onUnanswered: q => unanswered.push(q),
  });
  const got = await page.evaluate(() => ({
    phone: document.querySelector('#phone').value,
    email: document.querySelector('#email').value,
    cc: document.querySelector('#cc').value,
    java: document.querySelector('#java').value,
    kafka: document.querySelector('#kafka').value,
    ctc: document.querySelector('#ctc').value,
    auth: document.querySelector('input[name=auth]:checked')?.value,
    visa: document.querySelector('input[name=visa]:checked')?.value,
    exp: document.querySelector('#exp').value,
    edu: document.querySelector('#edu').value,
    pizza: document.querySelector('input[name=pizza]:checked')?.id,
    visaHold: document.querySelector('input[name="radio-group-_r_3b_"]:checked')?.id,
    cover: document.querySelector('#cover').value.slice(0, 20),
    city: document.querySelector('#city').value,
    follow: document.querySelector('#follow-company-checkbox').checked,
    resume: document.querySelector('#resume').files.length,
  }));
  console.log('\nRESULT', JSON.stringify(got, null, 1));
  console.log('unanswered:', unanswered);
  const expect = {
    phone: '9999999999', email: 'test@example.com', cc: 'India (+91)', java: '1', kafka: '1',
    ctc: '4 LPA', auth: 'Yes', visa: 'No', exp: '1-3 years', edu: "Master's Degree", pizza: 'pz-y', visaHold: '_r_3f_', cover: 'Backend engineer (Ja',
    city: 'New Delhi, Delhi, India', follow: false, resume: 1,
  };
  let fail = 0;
  for (const k in expect) if (got[k] !== expect[k]) { fail++; console.log(`❌ ${k}: got ${JSON.stringify(got[k])} expected ${JSON.stringify(expect[k])}`); }
  if (!unanswered.includes('Do you like pineapple on pizza?')) { fail++; console.log('❌ pizza should be reported unanswered'); }
  console.log(fail ? `\n${fail} FAILED` : '\n✅ all checks passed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
