# Easy Apply Helper

Two tools that share one answers bank (`profile.json`):

1. **Chrome extension** (`extension/`) — the one to use day to day. You browse LinkedIn normally;
   it opens jobs in batches, fills each Easy Apply step, asks you only for questions it has never
   seen (and remembers the answer), and auto-clicks Next. **It never clicks Submit. That is always
   your own click**, and it refuses to click anything whose label contains "submit".
2. **Playwright script** (`apply.js`) — an unattended runner. Kept for reference; the extension is
   the recommended path.

## Install the extension (once)
1. Chrome → `chrome://extensions` → turn on **Developer mode** (top right).
2. **Load unpacked** → choose the `extension/` folder.
3. Open a LinkedIn job search. A small "⚡ Easy Apply Helper" panel appears bottom-right.

## Daily flow
1. On a LinkedIn job search (ideally with the **Easy Apply** filter on) or a Naukri search page, the panel
   shows **Found | Remaining | Opened**. Click **Open next 5 jobs** (or press **Alt+O**): the next five
   un-opened jobs, in page order from the top, open in new tabs. Opened cards get a small green
   "✓ opened" badge. Already-applied, external-apply and title-filtered LinkedIn cards are skipped and
   counted as "Skipped here". **Reset history** forgets what was opened. Batch size is editable in the panel.
2. In each LinkedIn tab, press **Alt+A** (or click **Easy Apply + Fill**). The helper fills every step and
   clicks Next until the review page. If a step has a question it does not know, it lists it in the
   panel: answer it and click **Save & Next**. It will never ask that question again.
3. On the review page, check it, then click LinkedIn's own **Submit application**.
4. **Alt+W** closes the tab. Go to the next tab. (Naukri tabs: apply by hand for now.)

Shortcuts on a job page: Alt+A apply · Alt+F fill this step · Alt+N next · Alt+W close tab.

## Editing answers
- `profile.json` is the master answers bank. After editing it run `node sync-extension.js`, then in
  `chrome://extensions` click the reload icon on the helper, then in the extension's options page click
  **Reload profile.json**.
- Answers you type into the panel are stored in the extension. The options page (right-click the
  extension icon → Options) lets you edit them, export the merged bank, or change the batch size and
  auto-Next.
- To fold learned answers back into `profile.json`: export from the options page, then
  `node sync-extension.js --import ~/Downloads/profile.json`.
- `SKIP` as an answer leaves a field blank on purpose. `@personal.xxx` points at a field in `personal`.

## Tests
```bash
node test/test-filler.js                 # mock form, no LinkedIn
node test/test-ext-live.js <jobId>       # exercises the extension code on a real job in the script's
                                         # Chrome profile; blocks all form submissions; discards at the end
```

## Known limits
- Resume upload: LinkedIn already keeps your resumes; the helper leaves the preselected one.
- LinkedIn's markup changes. If filling stops working, run `node test/inspect.js` to dump the current
  page structure into `debug/`.

## Carrying it to another laptop
The code lives in Git (`github.com/parshuramsde/linkedin-easy-apply`). Your answers do **not**: `profile.json`
and `extension/profile.json` are gitignored because they hold your phone, address and salary answers.
Nothing runs on a server; each Chrome loads the folder directly.

**Fresh machine, once**
```bash
git clone git@github-parshuramsde:parshuramsde/linkedin-easy-apply.git
cd linkedin-easy-apply
cp profile.example.json profile.json   # then paste your real profile.json over it (AirDrop / USB / private drive)
node sync-extension.js                 # Node 18+ is the only requirement; npm install is not needed for the extension
```
Then `chrome://extensions` → Developer mode → Load unpacked → the `extension/` folder.

**After changing the code on any machine**
```bash
npm run push        # sync into the extension, commit, push (profile.json stays local)
```
**On the other machine**
```bash
npm run pull        # git pull + sync
```
then click the **↻** button in the helper panel (it reloads the extension from disk, no need to visit
chrome://extensions).

**Moving your answers** between your own machines is manual: copy `profile.json` across, run
`node sync-extension.js`, press ↻. Answers typed into the panel are stored in that Chrome only; to carry
them over: options page → *Export full bank* → `node sync-extension.js --import ~/Downloads/profile.json`.

## Sharing it with a friend
The repository is safe to share as-is: it contains no personal data, only `profile.example.json` with
`FILL_ME` placeholders. Two ways to give access:

- **Collaborator** (simplest): GitHub → repo Settings → Collaborators → add them. They clone the same URL
  and `npm run pull` gets every update.
- **Fork**: they press *Fork* on GitHub, clone their fork, and add yours as `upstream` to pull updates:
  `git remote add upstream https://github.com/parshuramsde/linkedin-easy-apply.git` once, then
  `git pull upstream main && node sync-extension.js`. Fixes they make come back as pull requests.

Their setup, once:
```bash
git clone <repo-url> linkedin-easy-apply
cd linkedin-easy-apply
cp profile.example.json profile.json   # replace every FILL_ME (give the file + your resume to Claude and ask it to fill it)
node sync-extension.js
```
Load unpacked in Chrome, log in to their own LinkedIn, then use *Open next 5* / Alt+A as described above.
Their `profile.json` never leaves their laptop. Things to tell them:
- `config.json` → `skipIfTitleMatches` is tuned for a 1-year backend profile; edit it or untick
  *Skip senior / lead / manager titles* in the panel.
- The helper never clicks Submit. That is always their click.
- Keep volumes modest; batch opening plus auto-fill is still automation on LinkedIn.

Not in the repository on purpose: `profile.json` (yours), `resume.pdf` (LinkedIn already has it), `chrome-profile/`, logs and
`debug/`.
