import pw from '/home/claude/.npm-global/lib/node_modules/playwright/index.js';
const { chromium } = pw;
import path from 'path'; import { fileURLToPath } from 'url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + path.join(HERE, 'gap-oracle.html');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 1550 } });
const errors = [];
const ignore = t => /ERR_CONNECTION_RESET|fonts\.g|Failed to load resource/i.test(t);
page.on('pageerror', e => { if (!ignore(e.message)) errors.push('PAGEERR: ' + e.message); });
page.on('console', m => { if (m.type() === 'error' && !ignore(m.text())) errors.push('CONSOLE: ' + m.text()); });
await page.goto(FILE);
await page.waitForTimeout(1200);
const read = async () => await page.evaluate(() => ({
  coeff: document.getElementById('coeff').textContent,
  cd: document.getElementById('cd').textContent,
  jump: document.getElementById('jump').textContent,
  imp: document.getElementById('imp').textContent,
  note: document.getElementById('curve-note').textContent,
}));
console.log('SPX/normal:', JSON.stringify(await read()));
await page.screenshot({ path: path.join(HERE, 'oracle-spx.png'), fullPage: true });
// NVDA
await page.click('#sym button[data-v="NVDA-PERP"]'); await page.waitForTimeout(400);
console.log('NVDA/normal:', JSON.stringify(await read()));
// crisis
await page.click('#reg button[data-v="crisis"]'); await page.waitForTimeout(400);
console.log('NVDA/crisis:', JSON.stringify(await read()));
await page.screenshot({ path: path.join(HERE, 'oracle-nvda-crisis.png'), fullPage: true });
// scrub into the weekend
await page.evaluate(() => { const s = document.getElementById('scrub'); s.value = 130; s.dispatchEvent(new Event('input')); });
await page.waitForTimeout(300);
console.log('scrubbed +130h:', JSON.stringify(await read()));
if (errors.length) console.log('ERRORS:\n' + errors.slice(0, 6).join('\n'));
await browser.close();
console.log(errors.length ? 'ORACLE: FAIL ✗' : 'ORACLE: PASS ✓');
process.exit(errors.length ? 1 : 0);
