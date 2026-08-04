import pw from '/home/claude/.npm-global/lib/node_modules/playwright/index.js';
const { chromium } = pw;
import fs from 'fs'; import os from 'os'; import path from 'path';
import { fileURLToPath } from 'url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist', 'index.html');

// ---- build a realistic Binance-Futures export (detected adapter path) ----
function binanceCSV() {
  const rows = [['Date(UTC)', 'Symbol', 'Side', 'Price', 'Quantity', 'Amount', 'Fee', 'Realized Profit']];
  const syms = { BTCUSDT: 60000, ETHUSDT: 3000 };
  let day = 5;
  for (const [sym, base] of Object.entries(syms)) {
    let px = base;
    for (let i = 0; i < 14; i++) {
      const entry = px * (1 + (Math.sin(i) * 0.02));
      const move = (i % 3 === 0 ? -1 : 1) * (0.01 + (i % 5) * 0.004);
      const exit = entry * (1 + move);
      const qty = +(3000 / entry).toFixed(4);
      const d1 = `2024-0${1 + (i % 6)}-${String(1 + day % 26).padStart(2, '0')} 12:00:00`;
      const d2 = `2024-0${1 + (i % 6)}-${String(2 + day % 26).padStart(2, '0')} 15:00:00`;
      rows.push([d1, sym, 'BUY', entry.toFixed(2), qty, (qty * entry).toFixed(2), '1.2', '']);
      rows.push([d2, sym, 'SELL', exit.toFixed(2), qty, (qty * exit).toFixed(2), '1.2', (qty * (exit - entry)).toFixed(2)]);
      day += 3; px = exit;
    }
  }
  return rows.map(r => r.join(',')).join('\n');
}

// ---- build a generic export with arbitrary headers (mapper path) ----
function genericCSV() {
  const rows = [['when', 'ticker', 'bs', 'shares', 'fill_px', 'costs']];
  let px = 150, day = 3;
  for (let i = 0; i < 20; i++) {
    const entry = px * (1 + Math.cos(i) * 0.015);
    const exit = entry * (1 + ((i % 4 === 0 ? -1 : 1) * (0.008 + (i % 3) * 0.006)));
    const qty = 20;
    rows.push([`2023-11-${String(1 + day % 27).padStart(2, '0')}`, 'AAPL', 'Buy', qty, entry.toFixed(2), '0.5']);
    rows.push([`2023-11-${String(2 + day % 27).padStart(2, '0')}`, 'AAPL', 'Sell', qty, exit.toFixed(2), '0.5']);
    day += 2; px = exit;
  }
  return rows.map(r => r.join(',')).join('\n');
}

const tmp = os.tmpdir();
const binPath = path.join(tmp, 'binance_test.csv'); fs.writeFileSync(binPath, binanceCSV());
const genPath = path.join(tmp, 'generic_test.csv'); fs.writeFileSync(genPath, genericCSV());

const browser = await chromium.launch();
const errors = [];
const ignore = t => /ERR_CONNECTION_RESET|ERR_NAME_NOT_RESOLVED|fonts\.g|Failed to load resource/i.test(t);
let pass = true;

async function run(label, file, isMapper) {
  const page = await browser.newPage();
  page.on('pageerror', e => { if (!ignore(e.message)) { errors.push(label + ' PAGEERROR: ' + e.message); pass = false; } });
  page.on('console', m => { if (m.type() === 'error' && !ignore(m.text())) { errors.push(label + ' CONSOLE: ' + m.text()); pass = false; } });
  await page.goto('file://' + DIST);
  await page.waitForFunction(() => typeof MODEL !== 'undefined' && MODEL, null, { timeout: 8000 });
  await page.setInputFiles('#file', file);
  if (isMapper) {
    await page.waitForSelector('#mapper:not(.hide)', { timeout: 5000 });
    // fill required mapper selects by label match
    await page.selectOption('#map-ts', { label: 'when' });
    await page.selectOption('#map-symbol', { label: 'ticker' });
    await page.selectOption('#map-side', { label: 'bs' });
    await page.selectOption('#map-qty', { label: 'shares' });
    await page.selectOption('#map-price', { label: 'fill_px' });
    await page.selectOption('#map-fee', { label: 'costs' });
    await page.click('button[onclick="applyMapping()"]');
  }
  await page.waitForSelector('#results', { state: 'visible', timeout: 6000 });
  const ui = await page.evaluate(() => ({
    score: document.getElementById('score').textContent,
    tier: document.getElementById('tier').textContent,
    arch: document.getElementById('arch').textContent,
    src: document.getElementById('src-line').textContent,
  }));
  const ok = ui.score !== '–' && /Tier [A-E]/.test(ui.tier) && ui.arch.length > 2;
  if (!ok) pass = false;
  console.log(`${label}: score=${ui.score} ${ui.tier} · ${ui.arch} · ${ui.src.slice(0, 60)} ${ok ? '✓' : '✗'}`);
  await page.close();
}

await run('binance (auto-detect)', binPath, false);
await run('generic (column mapper)', genPath, true);
await browser.close();
if (errors.length) console.log('ERRORS:\n' + errors.slice(0, 6).join('\n'));
console.log(pass ? 'CSV PATHS: PASS ✓' : 'CSV PATHS: FAIL ✗');
process.exit(pass ? 0 : 1);
