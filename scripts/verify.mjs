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

// Probe sekali: true bila sudah ada server yang melayani di url.
function probe(url, ms = 800) {
  return new Promise((res) => {
    const req = get(url, (r) => { res(r.statusCode === 200); r.resume(); });
    req.on('error', () => res(false));
    req.setTimeout(ms, () => { req.destroy(); res(false); });
  });
}

// 1) unit test + 2) build
log('npm test');
run('npm', ['test']);
log('npm run build');
run('npm', ['run', 'build']);

// 3) smoke headless: serve dist → load → Cycle Start 25x → tanpa pageerror
log('smoke browser headless');
const PORT = 4199;
// Fail-closed: bila port sudah dilayani (preview orphan/basi), abort — jangan
// menguji dist lama tanpa sadar.
if (await probe('http://localhost:' + PORT + '/')) {
  console.error('GAGAL: port ' + PORT + ' sudah melayani (preview orphan/basi) — matikan dulu.');
  process.exit(1);
}
// detached: proses jadi group leader supaya seluruh anak (vite + grandchild)
// bisa dimatikan sekaligus di finally.
const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore', detached: true
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

  // Gerbang JUJUR worker: window.__meshWorkerActive di-set setelah probe round-trip
  // ke Web Worker selesai (bukan sekadar typeof Worker). Tunggu sampai terdefinisi.
  // Arg ke-2 signature Playwright = `arg`; opsi WAJIB di arg ke-3, kalau tidak
  // timeout diabaikan dan verify bergantung pada default 30s (goyah di GL software).
  // Sandbox lambat: inisialisasi main-thread + worker round-trip bisa ~30s.
  await page.waitForFunction(() => window.__meshWorkerActive !== undefined, null, { timeout: 90000 });

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
      linesVisible: vis('#gcodeLines'),
      feedHoldLabel: document.querySelector('#btnPause')?.textContent?.trim() || ''
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
  // FEED HOLD: klik Play lalu Pause seketika → state hold + flag harus muncul.
  await page.evaluate(() => {
    document.querySelector('.ovr-btn[data-ovr="sim"][data-val="25"]').click();
    document.querySelector('#btnPlay').click();
    document.querySelector('#btnPause').click();
  });
  const hold = await page.evaluate(() => ({
    flags: document.querySelector('#sbFlags')?.textContent || '',
    status: document.querySelector('#simStatus')?.textContent
  }));
  await page.evaluate(() => document.querySelector('#btnPlay').click());
  await page.waitForTimeout(3000);
  const run = await page.evaluate(() => ({
    status: document.querySelector('#simStatus')?.textContent,
    stock: document.querySelector('#stockLeft')?.textContent,
    hdrSpindle: document.querySelector('#hdrSpindle')?.textContent,
    cmdsAfter: document.querySelector('#cmdsPanelBody')?.innerText || '',
    meshWorker: window.__meshWorkerActive === true
  }));

  // Regresi MDI: satu blok via DOM, tanpa pageerror.
  await page.evaluate(() => {
    document.querySelector('#modeTabs .mode-tab[data-mode="mdi"]').click();
    const el = document.querySelector('#mdiInput');
    if (el) el.value = 'G0 X10';
    document.querySelector('#btnMdiRun').click();
  });
  await page.waitForTimeout(800);

  // Tahap 7: FIXTURE editor — sub-tab, add row, simpan/muat skenario (tanpa pageerror).
  const fx = await page.evaluate(async () => {
    const out = { fixtureTab: false, fixtureVisible: false, rowsBefore: 0, rowsAfter: 0, saved: false, fxCount: 0, progLen: 0, msg: '', loadMsg: '', rowsAfterLoad: 0, xssLeaked: null, xssText: '' };
    const m = document.querySelector('#modeTabs .mode-tab[data-mode="setup"]');
    if (m) m.click();
    const tab = document.querySelector('#setupSubs [data-sub="fixture"]');
    if (tab) tab.click();
    const pane = document.querySelector('#setupFixture');
    if (pane) out.fixtureVisible = getComputedStyle(pane).display === 'flex';
    out.fixtureTab = !!tab && tab.textContent.trim() === 'FIXTURE';
    const rows = () => document.querySelectorAll('#fixtureList .fx-row').length;
    out.rowsBefore = rows();
    const add = document.querySelector('#fxAdd');
    if (add) add.click();
    out.rowsAfter = rows();
    const nameEl = document.querySelector('#scenarioName');
    if (nameEl) nameEl.value = 'smoke_fixture';
    const save = document.querySelector('#scenarioSave');
    if (save) save.click();
    const map = JSON.parse(localStorage.getItem('cnc-sim-scenarios') || '{}');
    out.saved = map.smoke_fixture !== undefined;
    try { const sc = JSON.parse(map.smoke_fixture); out.fxCount = sc.fixtures.length; out.progLen = (sc.program || '').length; }
    catch { out.fxCount = 0; out.progLen = 0; }
    out.msg = document.querySelector('#sbMsg')?.textContent || '';
    document.querySelector('#scenarioLoad')?.click();
    out.loadMsg = document.querySelector('#sbMsg')?.textContent || '';
    out.rowsAfterLoad = document.querySelectorAll('#fixtureList .fx-row').length;
    // H1: nama fixture berbahaya dari skenario TIDAK boleh dieksekusi (XSS).
    const payload = '<img src=x onerror="window.__xss=1">';
    const map2 = JSON.parse(localStorage.getItem('cnc-sim-scenarios') || '{}');
    map2.smoke_xss = JSON.stringify({ fixtures: [{ wcs: 'G54', name: payload }], program: '', wcs: {}, tools: {} });
    localStorage.setItem('cnc-sim-scenarios', JSON.stringify(map2));
    if (nameEl) nameEl.value = 'smoke_xss';
    document.querySelector('#scenarioLoad')?.click();
    await new Promise((r) => setTimeout(r, 100));
    out.xssLeaked = window.__xss === undefined ? false : true;
    out.xssText = (document.querySelector('#fixtureList .fx-row b')?.textContent) || '';
    localStorage.removeItem('cnc-sim-scenarios');
    return out;
  });

  // Tahap 7: wizard touch-off — jog zai PROBE ke kontak lalu SET WCS.
  const to = await page.evaluate(() => {
    const out = { overlay: false, disabledBefore: null, disabledAfter: null, g54x0: NaN, g54x: NaN, msg: '' };
    // Normalisasi G54 ke stok default top-center (boot mengaktifkan auto-fit).
    const row = document.querySelector('#fixtureList .fx-row');
    if (row) {
      const bubble = () => new Event('input', { bubbles: true });
      const setField = (sel, val) => {
        const el = document.querySelector('#fixtureList .fx-row ' + sel);
        if (el) { el.value = val; el.dispatchEvent(bubble()); }
      };
      setField('input[data-field="stockX"]', 100);
      setField('input[data-field="stockY"]', 80);
      setField('input[data-field="stockZ"]', 20);
      setField('select[data-field="placement"]', 'top-center');
    }
    document.querySelector('#btnJogHome')?.click();
    document.querySelector('#modeTabs .mode-tab[data-mode="setup"]').click();
    const sub = document.querySelector('#setupSubs [data-sub="work"]');
    if (sub) sub.click();
    const btn = document.querySelector('#btnTouchOff');
    if (btn) btn.click();
    const ov = document.querySelector('#touchoffOverlay');
    out.overlay = !!ov && getComputedStyle(ov).display === 'flex';
    const fixture = document.querySelector('#toFixture');
    if (fixture) { fixture.value = 'G54'; fixture.dispatchEvent(new Event('change')); }
    const edge = document.querySelector('#toEdge');
    if (edge) { edge.value = 'x-'; edge.dispatchEvent(new Event('change')); }
    const xInput = document.querySelector('#workOffsetTable tr[data-wcs="G54"] input[data-axis="x"]');
    out.g54x0 = xInput ? Number(xInput.value) : NaN;
    const start = document.querySelector('#toStart');
    out.disabledBefore = start ? start.disabled : null;
    document.querySelector('#toProbe')?.click();
    out.disabledAfter = start ? start.disabled : null;
    start?.click();
    out.g54x = xInput ? Number(xInput.value) : NaN;
    out.msg = document.querySelector('#sbMsg')?.textContent || '';
    return out;
  });
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
  const feedHoldLabel = shell.feedHoldLabel;
  const status = run.status;
  const stock = run.stock;
  const hdrSpindle = run.hdrSpindle;
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
  if (!feedHoldLabel.includes('FEED HOLD')) problems.push('tombol FEED HOLD tidak ada (label=' + feedHoldLabel + ')');
  if (!hold.flags.includes('FEED HOLD')) problems.push('flag FEED HOLD tidak tampil (flags=' + hold.flags + ')');
  if (!/^S\d+/.test(hdrSpindle || '')) problems.push('RPM aktual tidak tampil (hdrSpindle=' + hdrSpindle + ')');
  if (!fx.fixtureTab || !fx.fixtureVisible) problems.push('sub-tab FIXTURE tidak tampil (tab=' + fx.fixtureTab + ' visible=' + fx.fixtureVisible + ')');
  if (fx.rowsBefore < 1) problems.push('daftar fixture kosong (rows=' + fx.rowsBefore + ')');
  if (fx.rowsAfter <= fx.rowsBefore) problems.push('#fxAdd tidak menambah fixture (' + fx.rowsBefore + '->' + fx.rowsAfter + ')');
  if (!fx.saved) problems.push('skenario tidak tersimpan');
  if (fx.fxCount !== 2) problems.push('skenario 2-ragum tidak menyimpan 2 fixture (fxCount=' + fx.fxCount + ')');
  if (!(fx.progLen > 0)) problems.push('skenario 2-ragum tidak menyimpan program (progLen=' + fx.progLen + ')');
  if (!/Skenario dimuat/.test(fx.loadMsg || '')) problems.push('skenario tidak bisa dimuat (loadMsg=' + fx.loadMsg + ')');
  if (fx.rowsAfterLoad !== 2) problems.push('layout 2-ragum tidak dipulihkan saat load (rows=' + fx.rowsAfterLoad + ')');
  if (fx.xssLeaked) problems.push('XSS nama fixture tereksekusi (window.__xss ter-set)');
  if (fx.xssText !== '<img src=x onerror="window.__xss=1">') problems.push('nama fixture berbahaya tidak di-escape (text=' + fx.xssText + ')');
  if (!to.overlay) problems.push('wizard touch-off tidak terbuka (overlay=' + to.overlay + ')');
  if (to.disabledBefore !== true) problems.push('#toStart harus disabled sebelum kontak (disabledBefore=' + to.disabledBefore + ')');
  if (to.disabledAfter !== false) problems.push('#toStart harus enabled saat kontak (disabledAfter=' + to.disabledAfter + ')');
  if (!(Math.abs(to.g54x + 50) < 0.05)) problems.push('WCS G54 X tidak ter-set touch-off (x=' + to.g54x + ', harap edge kiri stok default -50)');
  if (!/Touch-off set/.test(to.msg || '')) problems.push('pesan touch-off tidak muncul (msg=' + to.msg + ')');
  if (!run.meshWorker) problems.push('mesh worker tidak aktif (window.__meshWorkerActive)');
  if (errors.length) problems.push('pageerror: ' + errors[0]);
  if (problems.length) throw new Error(problems.join('; '));
  console.log('smoke OK — glines=' + glines + ' status=' + status + ' stock=' + stock);
} finally {
  try { process.kill(-preview.pid, 'SIGTERM'); } catch {}
}
log('VERIFY HIJAU ✓');
