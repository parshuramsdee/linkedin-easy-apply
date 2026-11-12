// Copies profile.json and config.json into the extension folder. Run after editing either file.
// node sync-extension.js                    copy into extension/
// node sync-extension.js --import x.json    merge learned answers from an exported file into profile.json
const fs = require('fs'); const path = require('path');
const root = __dirname, ext = path.join(root, 'extension');
const profilePath = path.join(root, 'profile.json');
if (!fs.existsSync(profilePath)) {
  console.error('profile.json not found.\n  cp profile.example.json profile.json\nthen replace every FILL_ME with your own details and run this again.');
  process.exit(1);
}
if (process.argv[2] === '--import') {
  const inc = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const prof = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  const have = new Set(prof.answers.map(a => a.match.join('|')));
  const add = (inc.answers || inc).filter(a => !have.has(a.match.join('|')));
  prof.answers.unshift(...add);
  fs.writeFileSync(profilePath, JSON.stringify(prof, null, 2));
  console.log(`merged ${add.length} new answer(s) into profile.json`);
}
for (const f of ['profile.json', 'config.json']) fs.copyFileSync(path.join(root, f), path.join(ext, f));
console.log('extension/profile.json and extension/config.json updated');
