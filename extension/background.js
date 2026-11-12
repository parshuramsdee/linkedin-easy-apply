// Seeds storage from the bundled profile/config and opens/closes tabs for the content script.
async function seed(force) {
  const cur = await chrome.storage.local.get(['profile', 'config']);
  const config = await (await fetch(chrome.runtime.getURL('config.json'))).json();
  // profile.json is gitignored (personal). If it is missing the user has not run `node sync-extension.js` yet.
  let profile, profileMissing = false;
  try { profile = await (await fetch(chrome.runtime.getURL('profile.json'))).json(); }
  catch (e) { profileMissing = true; profile = { personal: {}, defaults: {}, answers: [] }; }
  // profile.json is the master copy: every extension reload refreshes it. Learned answers live separately and are kept.
  await chrome.storage.local.set({ config, profile, profileMissing, profileLoadedAt: Date.now() });
}
chrome.runtime.onInstalled.addListener(() => seed(true));
chrome.runtime.onStartup.addListener(() => seed(true));

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    if (msg.type === 'openTabs') {
      const urls = msg.urls || (msg.ids || []).map(id => `https://www.linkedin.com/jobs/view/${id}/`);
      for (const url of urls) await chrome.tabs.create({ url, active: false });
      reply({ ok: true });
    } else if (msg.type === 'closeTab' && sender.tab) {
      await chrome.tabs.remove(sender.tab.id); reply({ ok: true });
    } else if (msg.type === 'reloadExt') {
      reply({ ok: true }); setTimeout(() => chrome.runtime.reload(), 100);   // re-reads the unpacked folder, then onInstalled re-seeds profile.json
    } else if (msg.type === 'reseed') {
      await seed(true); reply({ ok: true });
    } else reply({ ok: false });
  })();
  return true;
});
