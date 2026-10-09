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
  const glines = await page.locator('.gline').count();

  // Tahap 5: halaman CURNT CMDS (F2) terbuka, punya isi, dan LIVE update saat run
  await page.click('.sk[data-sk="f2"]');
  await page.waitForTimeout(200);
  const cmdsVisible = await page.locator('#cmdsPanel').isVisible();
  const cmdsRows = await page.locator('#cmdsPanelBody .alarm-row').count();
  const cmdsBefore = await page.locator('#cmdsPanelBody').innerText();

  // Panel CURNT CMDS adalah overlay; jalankan program lewat DOM langsung.
  await page.evaluate(() => {
    document.querySelector('.ovr-btn[data-ovr="sim"][data-val="25"]').click();
    document.querySelector('#btnPlay').click();
  });
  await page.waitForTimeout(3000);
  const status = await page.locator('#simStatus').textContent();
  const stock = await page.locator('#stockLeft').textContent();
  const cmdsAfter = await page.locator('#cmdsPanelBody').innerText();
  await browser.close();

  const problems = [];
  if (glines < 10) problems.push('daftar baris program kosong (glines=' + glines + ')');
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
