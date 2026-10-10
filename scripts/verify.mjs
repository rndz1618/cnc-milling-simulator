/**
 * Gerbang verifikasi satu perintah: npm run verify
 * 1) unit test   2) build produksi   3) smoke browser headless (dist di port temp)
 * Exit code != 0 = gagal. Dipakai AI harness sebelum commit (aturan AGENTS.md).
 */
import { spawn, spawnSync } from 'node:child_process';
import { get } from 'node:http';

const log = (s) => console.log('\n== ' + s + ' ==');

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) {
    console.error('GAGAL: ' + cmd + ' ' + args.join(' '));
    process.exit(1);
  }
}

async function waitFor(url, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const ok = await new Promise((res) => {
      const req = get(url, (r) => { res(r.statusCode === 200); r.resume(); });
      req.on('error', () => res(false));
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

// 1) unit test + 2) build
log('npm test');
run('npm', ['test']);
log('npm run build');
run('npm', ['run', 'build']);

// 3) smoke headless: serve dist → load → Cycle Start 25x → tanpa pageerror
log('smoke browser headless');
const PORT = 4199;
const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore', detached: false
});
try {
  const up = await waitFor('http://localhost:' + PORT + '/');
  if (!up) throw new Error('preview server tidak naik di :' + PORT);

  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1366, height: 850 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  // Tahap 5 lanjutan: shell panel dirender dari controller JSON.
  // Catatan: klik Playwright sangat lambat di GL software; semua cek dikerjakan
  // di dalam satu page.evaluate (round-trip minimal).
  const shell = await page.evaluate(() => {
    const vis = (s) => {
      const el = document.querySelector(s);
      if (!el) return false;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    };
    const click = (s) => { const el = document.querySelector(s); if (el) el.click(); };
    const out = {
      glines: document.querySelectorAll('.gline').length,
      modes: document.querySelectorAll('#modeTabs .mode-tab').length,
      dro: document.querySelectorAll('#droTabs .dro-tab').length,
      sk: document.querySelectorAll('#softkeys .sk').length,
      linesVisible: vis('#gcodeLines')
    };
    click('#modeTabs .mode-tab[data-mode="jog"]');
    out.jogVisible = vis('#panelJog');
    out.progHidden = !vis('#panelProgram');
    click('#modeTabs .mode-tab[data-mode="mdi"]');
    out.mdiVisible = vis('#mdiWrap');
    click('#modeTabs .mode-tab[data-mode="mem"]');

    click('.sk[data-sk="f2"]');
    out.cmdsVisible = vis('#cmdsPanel');
    out.cmdsRows = document.querySelectorAll('#cmdsPanelBody .alarm-row').length;
    out.cmdsBefore = document.querySelector('#cmdsPanelBody')?.innerText || '';
    return out;
  });

  // Jalankan program (25x) lewat DOM; overlay CURNT CMDS live update.
  await page.evaluate(() => {
    document.querySelector('.ovr-btn[data-ovr="sim"][data-val="25"]').click();
    document.querySelector('#btnPlay').click();
  });
  await page.waitForTimeout(3000);
  const run = await page.evaluate(() => ({
    status: document.querySelector('#simStatus')?.textContent,
    stock: document.querySelector('#stockLeft')?.textContent,
    cmdsAfter: document.querySelector('#cmdsPanelBody')?.innerText || ''
  }));

  // Regresi MDI: satu blok via DOM, tanpa pageerror.
  await page.evaluate(() => {
    document.querySelector('#modeTabs .mode-tab[data-mode="mdi"]').click();
    const el = document.querySelector('#mdiInput');
    if (el) el.value = 'G0 X10';
    document.querySelector('#btnMdiRun').click();
  });
  await page.waitForTimeout(800);
  await browser.close();

  const glines = shell.glines;
  const modeCount = shell.modes;
  const droCount = shell.dro;
  const skCount = shell.sk;
  const linesVisible = shell.linesVisible;
  const jogVisible = shell.jogVisible;
  const progHidden = shell.progHidden;
  const mdiVisible = shell.mdiVisible;
  const cmdsVisible = shell.cmdsVisible;
  const cmdsRows = shell.cmdsRows;
  const cmdsBefore = shell.cmdsBefore;
  const status = run.status;
  const stock = run.stock;
  const cmdsAfter = run.cmdsAfter;


  const problems = [];
  if (glines < 10) problems.push('daftar baris program kosong (glines=' + glines + ')');
  if (modeCount !== 5) problems.push('mode tabs=' + modeCount + ' (harus 5 dari JSON)');
  if (droCount !== 4) problems.push('dro tabs=' + droCount + ' (harus 4 dari JSON)');
  if (skCount !== 8) problems.push('softkeys=' + skCount + ' (harus 8 dari JSON)');
  if (!linesVisible) problems.push('default mem: #gcodeLines tidak terlihat');
  if (!jogVisible || !progHidden) problems.push('mode JOG tidak menampilkan #panelJog / menyembunyikan #panelProgram');
  if (!mdiVisible) problems.push('mode MDI tidak menampilkan #mdiWrap');
  if (!['RUN', 'DONE'].includes(status)) problems.push('status=' + status);
  if (!cmdsVisible || cmdsRows < 5) problems.push('CURNT CMDS tidak tampil (visible=' + cmdsVisible + ' rows=' + cmdsRows + ')');
  if (cmdsBefore === cmdsAfter) problems.push('CURNT CMDS statis — tidak update saat proses berjalan');
  if (errors.length) problems.push('pageerror: ' + errors[0]);
  if (problems.length) throw new Error(problems.join('; '));
  console.log('smoke OK — glines=' + glines + ' status=' + status + ' stock=' + stock);
} finally {
  preview.kill('SIGTERM');
}
log('VERIFY HIJAU ✓');
