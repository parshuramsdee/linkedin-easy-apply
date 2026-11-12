const $ = id => document.getElementById(id);
async function load() {
  const s = await chrome.storage.local.get(['learned', 'settings']);
  $('learned').value = JSON.stringify(s.learned || [], null, 2);
  $('autoNext').checked = (s.settings || {}).autoNext !== false;
  $('batch').value = (s.settings || {}).batch || 5;
  $('autoStart').checked = (s.settings || {}).autoStart !== false;
  $('titleFilter').checked = (s.settings || {}).titleFilter !== false;
}
$('save').onclick = async () => {
  try {
    const learned = JSON.parse($('learned').value);
    await chrome.storage.local.set({ learned, settings: { autoNext: $('autoNext').checked, batch: +$('batch').value || 5, autoStart: $('autoStart').checked, titleFilter: $('titleFilter').checked } });
    $('msg').textContent = 'Saved.';
  } catch (e) { $('msg').textContent = 'Invalid JSON: ' + e.message; }
};
$('export').onclick = async () => {
  const s = await chrome.storage.local.get(['learned', 'profile']);
  const merged = { ...s.profile, answers: [...(s.learned || []), ...((s.profile || {}).answers || [])] };
  const blob = new Blob([JSON.stringify(merged, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'profile.json'; a.click();
};
$('reseed').onclick = async () => { await chrome.runtime.sendMessage({ type: 'reseed' }); $('msg').textContent = 'Profile reloaded.'; };
$('clearHistory').onclick = async () => { await chrome.storage.local.set({ opened: {}, applied: {} }); $('msg').textContent = 'History cleared.'; };
load();
