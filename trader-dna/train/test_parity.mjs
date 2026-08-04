import pw from '/home/claude/.npm-global/lib/node_modules/playwright/index.js';
const { chromium } = pw;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist', 'index.html');
const CASES = JSON.parse(fs.readFileSync(path.join(HERE, 'test_cases.json')));

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
const ignore = t => /ERR_CONNECTION_RESET|ERR_NAME_NOT_RESOLVED|fonts\.g(oogleapis|static)|Failed to load resource/i.test(t);
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !ignore(m.text())) errors.push('CONSOLE: ' + m.text()); });

await page.goto('file://' + DIST);
await page.waitForFunction(() => window.MODEL || (typeof MODEL !== 'undefined' && MODEL), null, { timeout: 8000 })
  .catch(() => {});
// MODEL is a top-level `let`; expose a checker
await page.waitForFunction(() => typeof extractFeatures === 'function' && typeof MODEL !== 'undefined' && MODEL, null, { timeout: 8000 });

let maxFeatErr = 0, maxScoreErr = 0, worst = '';
for (const c of CASES) {
  const res = await page.evaluate((rts) => {
    const F = extractFeatures(rts);
    const x = featVector(F);
    const raw = rawPredict(x);
    const score = scoreOf(raw);
    return { x, raw, score };
  }, c.roundtrips);

  for (let j = 0; j < c.vector.length; j++) {
    const e = Math.abs(res.x[j] - c.vector[j]);
    if (e > maxFeatErr) { maxFeatErr = e; worst = `${c.archetype} feat[${j}] js=${res.x[j]} py=${c.vector[j]}`; }
  }
  const se = Math.abs(res.score - c.score);
  if (se > maxScoreErr) maxScoreErr = se;
}

console.log(`cases: ${CASES.length}`);
console.log(`max |feature JS-PY| = ${maxFeatErr.toExponential(3)}`);
console.log(`max |score   JS-PY| = ${maxScoreErr.toExponential(3)}`);

// ---- functional smoke: drive the real sample flow, confirm it renders ----
await page.setViewportSize({ width: 1180, height: 1400 });
await page.evaluate(() => runSample());
await page.waitForSelector('#results', { state: 'visible', timeout: 5000 });
const ui = await page.evaluate(() => ({
  score: document.getElementById('score').textContent,
  tier: document.getElementById('tier').textContent,
  arch: document.getElementById('arch').textContent,
  dBad: document.getElementById('d-bad').textContent,
  dTier: document.getElementById('d-tier').textContent,
  helped: document.getElementById('helped').children.length,
  hurt: document.getElementById('hurt').children.length,
  improve: document.getElementById('improve').children.length,
  privs: document.getElementById('privs').children.length,
  regime: document.getElementById('regime-read').textContent.slice(0, 80),
}));
console.log('sample render:', JSON.stringify(ui));
await page.screenshot({ path: path.join(HERE, '..', 'dist', 'sample-render.png'), fullPage: true });

const funcOk = ui.score !== '–' && /Tier [A-E]/.test(ui.tier) && ui.arch.length > 2 && ui.helped > 0 && ui.improve > 0;
if (errors.length) { console.log('PAGE ERRORS:\n' + errors.slice(0, 8).join('\n')); }
await browser.close();

const ok = maxFeatErr < 1e-6 && maxScoreErr < 0.05 && errors.length === 0 && funcOk;
console.log(`parity ${maxFeatErr < 1e-6 && maxScoreErr < 0.05 ? 'ok' : 'BAD'} · functional ${funcOk ? 'ok' : 'BAD'} · errors ${errors.length}`);
console.log(ok ? 'ALL: PASS ✓' : 'ALL: FAIL ✗');
process.exit(ok ? 0 : 1);
