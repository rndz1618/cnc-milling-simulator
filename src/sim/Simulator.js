/**
 * Playback engine — mengeksekusi stream entri parser DALAM KOORDINAT MESIN.
 * Work offset (G54–G59) diterapkan lewat moveTarget() saat eksekusi, sehingga
 * mengubah offset SETELAH load tetap memindahkan jalur (seperti mesin asli).
 *
 * Status: idle | run | hold | alarm | done
 * Alarm (kode tak dikenal, soft limit, G00 nabrak material, H offset belum
 * di-set) MENGHENKAN eksekusi — lanjut hanya setelah RESET.
 */
import { moveTarget, outOfTravel, MACHINE_PROFILE, wcsOffset } from '../machine/MachineState.js';

/** Waktu ganti tool (ATC) dalam detik simulasi. */
const ATC_TIME = 1.0;

export class Simulator {
  constructor({
    stock,
    machine,
    onUpdate,
    onLine,
    onAlarm,
    onTool,
    onToolComp,
    onCoolant,
    onMessage
  }) {
    this.stock = stock;
    this.machine = machine;
    this.onUpdate = onUpdate || (() => {});
    this.onLine = onLine || (() => {});
    this.onAlarm = onAlarm || (() => {});
    this.onTool = onTool || (() => {});
    this.onToolComp = onToolComp || (() => {});
    this.onCoolant = onCoolant || (() => {});
    this.onMessage = onMessage || (() => {});

    this.moves = [];
    this.totalTime = 0;
    this.index = 0;
    this.progress = 0;
    this.elapsed = 0;
    this.playing = false;
    this.state = 'idle';
    this.singleBlock = false;
    this.dryRun = false;
    this.simSpeed = 1;
    this.feedOvr = 1;
    this.rapidOvr = 1;
    this.holdReason = null;
    this.timer = 0;
    this.timerKind = null;
  }

  loadMoves(moves, totalTime = 0) {
    this.moves = moves;
    this.totalTime = totalTime;
    this.reset();
  }

  reset() {
    this.index = 0;
    this.progress = 0;
    this.elapsed = 0;
    this.playing = false;
    this.state = 'idle';
    this.timer = 0;
    this.timerKind = null;
    this.holdReason = null;
    this._homeMachine();
    this.onLine(null);
    this.onUpdate();
  }

  stop() {
    // RESET: hentikan, kembali ke awal, bersihkan alarm.
    this.playing = false;
    this.state = 'idle';
    this.index = 0;
    this.progress = 0;
    this.elapsed = 0;
    this.timer = 0;
    this.timerKind = null;
    this.holdReason = null;
    this._homeMachine();
    this.stock.reset();
    this.stock._dirty = true;
    this.onLine(null);
    this.onUpdate();
  }

  _homeMachine() {
    this.machine.x = MACHINE_PROFILE.home.x;
    this.machine.y = MACHINE_PROFILE.home.y;
    this.machine.z = MACHINE_PROFILE.home.z;
    this.machine.spindle = 0;
    this.machine.spindleTarget = 0;
    this.machine.spindleOn = false;
    this.machine.dtg = { x: 0, y: 0, z: 0 };
  }

  play() {
    if (this.state === 'alarm') {
      this.onMessage('ALARM AKTIF — tekan RESET (⏹) dulu');
      this.onUpdate();
      return;
    }
    this.holdReason = null;
    if (!this.moves.length) return;
    if (this.index >= this.moves.length) {
      this.stock.reset();
      this.stock._dirty = true;
      this.index = 0;
      this.progress = 0;
      this.elapsed = 0;
    }
    // _advanceEntries bisa langsung mengakhiri program (M30) / berhenti (M00)
    // atau memicu alarm — hormati status yang ia set, jangan paksa 'run'.
    const ready = this._advanceEntries();
    this.playing = ready;
    if (ready) this.state = 'run';
    this.onUpdate();
  }

  pause() {
    this.playing = false;
    if (this.state === 'run') this.state = 'hold';
    this.onUpdate();
  }

  alarm(msg, line) {
    this.playing = false;
    this.state = 'alarm';
    this.machine.dtg = { x: 0, y: 0, z: 0 };
    this.onAlarm(msg, line);
    this.onUpdate();
  }

  /**
   * Konsumsi entri non-gerak sampai ketemu gerakan / berhenti.
   * Return true jika ada gerakan siap dieksekusi pada index sekarang.
   */
  _advanceEntries() {
    while (this.index < this.moves.length) {
      const e = this.moves[this.index];
      if (e.type === 'tool') {
        this.onTool(e.tool);
        if (this.state === 'alarm') return false;
        this.timer = ATC_TIME;
        this.timerKind = 'atc';
        this.index++;
        return true;
      }
      if (e.type === 'dwell') {
        if (e.p > 0) {
          this.timer = e.p;
          this.timerKind = 'dwell';
          this.index++;
          return true;
        }
        this.index++;
        continue;
      }
      if (e.type === 'coolant') {
        this.machine.coolant = e.on;
        this.onCoolant(e.on);
        this.index++;
        continue;
      }
      if (e.type === 'toolcomp') {
        this.onToolComp(e.h);
        if (this.state === 'alarm') return false;
        this.index++;
        continue;
      }
      if (e.type === 'alarm') {
        this.alarm(e.msg, e.line);
        return false;
      }
      if (e.type === 'stop') {
        this.index++;
        if (e.end) {
          this.playing = false;
          this.state = 'done';
          this.onLine(null);
          this.onMessage('PROGRAM END (M30)');
          this.onUpdate();
          return false;
        }
        if (e.optional && !this.machine.optStop) continue;
        this.playing = false;
        this.state = 'hold';
        this.onMessage(
          e.optional
            ? 'OPTIONAL STOP (M01) — Cycle Start untuk lanjut'
            : 'PROGRAM STOP (M00) — Cycle Start untuk lanjut'
        );
        this.onUpdate();
        return false;
      }
      return true; // rapid | feed | home
    }
    this.playing = false;
    this.state = this.moves.length ? 'done' : 'idle';
    this.onUpdate();
    return false;
  }

  step() {
    if (this.state === 'alarm') return;
    if (!this._advanceEntries()) return;
    if (this.timer > 0) {
      if (this.timerKind === 'dwell') this.elapsed += this.timer;
      this.timer = 0;
      this.timerKind = null;
    }
    if (this.index >= this.moves.length) return;
    const m = this.moves[this.index];
    const target = moveTarget(m, this.machine);
    const bad = outOfTravel(target);
    if (bad.length) {
      this.alarm(this._softLimitMsg(target, bad, m), m.line);
      return;
    }
    const prev = { x: this.machine.x, y: this.machine.y, z: this.machine.z };
    this._setPos(target);
    this.machine.dtg = { x: 0, y: 0, z: 0 };
    this._applyMeta(m);
    if (!this.dryRun) {
      if (m.type === 'feed') {
        this.stock.cutSegment(prev.x, prev.y, prev.z, target.x, target.y, target.z,
          (this.machine.toolDiameter || 12) / 2);
      } else if (m.type === 'rapid') {
        this._checkRapidCrash(prev, target, m);
      }
    }
    this.onLine(m.line);
    this.index++;
    this._advanceEntries();
    if (this.index >= this.moves.length) {
      this.playing = false;
      this.state = 'done';
    }
    this.onUpdate();
  }

  tick(dt) {
    if (!this.playing) return;
    if (this.timer > 0) {
      this.timer -= dt * this.simSpeed;
      if (this.timerKind === 'dwell') this.elapsed += dt * this.simSpeed;
      if (this.timer > 0) {
        this.onUpdate();
        return;
      }
      this.timer = 0;
      this.timerKind = null;
    }
    if (this.index >= this.moves.length) {
      this.playing = false;
      this.state = 'done';
      this.onUpdate();
      return;
    }

    const m = this.moves[this.index];
    const target = moveTarget(m, this.machine);
    const bad = outOfTravel(target);
    if (bad.length) {
      this.alarm(this._softLimitMsg(target, bad, m), m.line);
      return;
    }

    const prev = { x: this.machine.x, y: this.machine.y, z: this.machine.z };
    const dx = target.x - prev.x;
    const dy = target.y - prev.y;
    const dz = target.z - prev.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001;

    const feed = m.type === 'rapid'
      ? MACHINE_PROFILE.rapidRate * this.rapidOvr
      : (m.f || 500) * this.feedOvr;
    const moveTime = (dist / feed) * 60;
    // Hanya hitung waktu yang benar-benar dikonsumsi gerak ini — di sim speed
    // tinggi satu tick bisa menyelesaikan >1 move, sisanya jangan dihitung.
    const dProg = (dt * this.simSpeed) / (moveTime || 0.01);
    this.elapsed += (moveTime || 0.01) * Math.min(dProg, Math.max(0, 1 - this.progress));
    this.progress += dProg;
    this.onLine(m.line);
    this._applyMeta(m);

    const t1 = Math.min(1, this.progress);
    const now = {
      x: prev.x + dx * t1,
      y: prev.y + dy * t1,
      z: prev.z + dz * t1
    };
    this._setPos(now);
    this.machine.feed = feed;
    this.machine.dtg = {
      x: target.x - now.x,
      y: target.y - now.y,
      z: target.z - now.z
    };

    if (!this.dryRun && m.type === 'feed') {
      this.stock.cutSegment(prev.x, prev.y, prev.z, now.x, now.y, now.z,
        (this.machine.toolDiameter || 12) / 2);
    }

    if (this.progress >= 1) {
      this._setPos(target);
      this.machine.dtg = { x: 0, y: 0, z: 0 };
      if (!this.dryRun && m.type === 'rapid') this._checkRapidCrash(prev, target, m);
      if (this.state === 'alarm') return;
      this.index++;
      this.progress = 0;
      if (this.singleBlock) {
        this.playing = false;
        this.state = 'hold';
        this.onMessage('SINGLE BLOCK — Cycle Start untuk blok berikutnya');
      } else {
        this._advanceEntries();
      }
      if (this.index >= this.moves.length && this.playing) {
        this.playing = false;
        this.state = 'done';
      }
    }
    this.onUpdate();
  }

  /** Pesan soft limit yang bisa didiagnosis operator: nilai target, batas, dan offset WCS. */
  _softLimitMsg(target, bad, m) {
    const t = MACHINE_PROFILE.travel;
    const wcs = m.wcs || this.machine.activeWcs;
    const detail = bad.map((a) => {
      const ax = a.toLowerCase();
      return a + '=' + target[ax].toFixed(1) + ' (batas ' + t[ax][0] + '..' + t[ax][1] + ')';
    }).join(', ');
    const off = wcsOffset(this.machine, wcs);
    return 'SOFT LIMIT ' + bad.join('/') + ' — TARGET MELEBIHI TRAVEL MESIN: ' + detail +
      ' | offset ' + wcs + ' X' + off.x.toFixed(1) + ' Y' + off.y.toFixed(1) + ' Z' + off.z.toFixed(1) +
      ' — cek OFFSET (F1) → WORK, atau Reset Default';
  }

  _setPos(t) {
    this.machine.x = t.x;
    this.machine.y = t.y;
    this.machine.z = t.z;
  }

  _applyMeta(m) {
    if (m.g != null) this.machine.motion = 'G' + m.g;
    if (m.wcs) this.machine.activeWcs = m.wcs;
    if (m.tool) this.machine.tool = m.tool;
    if (m.spindle != null) {
      this.machine.spindleTarget = m.spindle;
      this.machine.spindleOn = m.spindle > 0;
    }
    if (m.spindleDir) this.machine.spindleDir = m.spindleDir;
    this.machine.feed = m.type === 'rapid'
      ? MACHINE_PROFILE.rapidRate * this.rapidOvr
      : (m.f || this.machine.feed || 0);
  }

  /** Ramp spindle ke `spindleTarget` (linear, time constant penuh ~1.5 s). */
  updateSpindle(dt) {
    const target = this.machine.spindleTarget || 0;
    const rate = (MACHINE_PROFILE.maxRpm / 1.5) * dt;
    if (this.machine.spindle < target) {
      this.machine.spindle = Math.min(target, this.machine.spindle + rate);
    } else if (this.machine.spindle > target) {
      this.machine.spindle = Math.max(target, this.machine.spindle - rate);
    }
    this.machine.spindleOn = target > 0;
  }

  /** FEED HOLD — hentikan mid-blok, pertahankan progress; lanjut via play(). */
  feedHold() {
    this.holdReason = 'feed';
    this.pause();
  }

  /**
   * G00 yang menembus material = crash. Cek bukan hanya garis tengah tool —
   * juga lingkar radius (badan tool bisa menabrak dinding slot yang baru
   * dipotong). Sisa segmen sampai titik tabrak dipotong (kerusakan terlihat),
   * lalu alarm + halt.
   */
  _checkRapidCrash(p0, p1, m) {
    const dist = Math.sqrt((p1.x - p0.x) ** 2 + (p1.y - p0.y) ** 2 + (p1.z - p0.z) ** 2);
    if (dist < 1e-6) return false;
    const r = (this.machine.toolDiameter || 12) / 2;
    const ringR = r * 0.85;
    const ring = [[0, 0]];
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI * 2 * k) / 6;
      ring.push([Math.cos(a) * ringR, Math.sin(a) * ringR]);
    }
    const step = Math.max((this.stock.res || 1) * 0.5, 0.5);
    const n = Math.max(1, Math.ceil(dist / step));
    for (let s = 1; s <= n; s++) {
      const t = s / n;
      const px = p0.x + (p1.x - p0.x) * t;
      const py = p0.y + (p1.y - p0.y) * t;
      const pz = p0.z + (p1.z - p0.z) * t;
      for (const [ox, oy] of ring) {
        if (this.stock.pointInStock(px + ox, py + oy, pz)) {
          this.stock.cutSegment(p0.x, p0.y, p0.z, px, py, pz, r);
          this.alarm('RAPID CRASH — G00 MENABRAK MATERIAL (baris ' + m.line + ')', m.line);
          return true;
        }
      }
    }
    return false;
  }
}
