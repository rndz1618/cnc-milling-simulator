/**
 * Playback engine: advances moves, cuts stock, syncs line highlight.
 * Program coordinates = world/display coordinates (tool stays on toolpath).
 * G54 is stored for DRO Machine mode only: machine = work + g54.
 */
export class Simulator {
  constructor({ stock, machine, onUpdate, onLine }) {
    this.stock = stock;
    this.machine = machine;
    this.onUpdate = onUpdate || (() => {});
    this.onLine = onLine || (() => {});

    this.moves = [];
    this.totalTime = 0;
    this.index = 0;
    this.progress = 0;
    this.elapsed = 0;
    this.playing = false;
    this.singleBlock = false;
    this.dryRun = false;
    this.simSpeed = 1;
    this.feedOvr = 1;
    this.rapidOvr = 1;
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
    this.machine.x = 0;
    this.machine.y = 0;
    this.machine.z = 50;
    this.onLine(null);
    this.onUpdate();
  }

  play() {
    if (!this.moves.length) return;
    if (this.index >= this.moves.length) {
      this.index = 0;
      this.progress = 0;
      this.elapsed = 0;
      this.stock.reset();
      this.stock._dirty = true;
    }
    this.playing = true;
    this.onUpdate();
  }

  pause() {
    this.playing = false;
    this.onUpdate();
  }

  stop() {
    this.playing = false;
    this.reset();
    this.stock.reset();
    this.stock._dirty = true;
    this.onUpdate();
  }

  step() {
    if (!this.moves.length || this.index >= this.moves.length) return;
    const prev = this.index === 0 ? { x: 0, y: 0, z: 50 } : this.moves[this.index - 1];
    const m = this.moves[this.index];
    this._applyMove(m);
    if (!this.dryRun && m.type === 'feed') {
      this.stock.cutSegment(
        prev.x, prev.y, prev.z,
        m.x, m.y, m.z,
        this.machine.toolDiameter / 2
      );
    }
    this.onLine(m.line);
    this.index++;
    this.progress = 0;
    this.onUpdate();
    if (this.index >= this.moves.length) this.playing = false;
  }

  _applyMove(m) {
    // Program coords = display/work coords (aligned with stock & toolpath)
    this.machine.x = m.x;
    this.machine.y = m.y;
    this.machine.z = m.z;
    this.machine.feed = m.f || 0;
    if (m.spindle) {
      this.machine.spindle = m.spindle;
      this.machine.spindleOn = true;
    }
    if (m.tool) this.machine.tool = m.tool;
  }

  tick(dt) {
    if (!this.playing || this.singleBlock) return;
    if (this.index >= this.moves.length) {
      this.playing = false;
      this.onUpdate();
      return;
    }

    const move = this.moves[this.index];
    const prev = this.index === 0 ? { x: 0, y: 0, z: 50 } : this.moves[this.index - 1];
    const dx = move.x - prev.x;
    const dy = move.y - prev.y;
    const dz = move.z - prev.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001;

    const feed = move.type === 'rapid'
      ? 5000 * this.rapidOvr
      : (move.f || 500) * this.feedOvr;
    const moveTime = (dist / feed) * 60;
    const dProg = (dt * this.simSpeed) / (moveTime || 0.01);

    const prevProg = this.progress;
    this.progress += dProg;
    this.elapsed += dt * this.simSpeed;
    this.onLine(move.line);

    const t0 = prevProg;
    const t1 = Math.min(1, this.progress);
    const x0 = prev.x + dx * t0;
    const y0 = prev.y + dy * t0;
    const z0 = prev.z + dz * t0;
    const x1 = prev.x + dx * t1;
    const y1 = prev.y + dy * t1;
    const z1 = prev.z + dz * t1;

    this.machine.x = x1;
    this.machine.y = y1;
    this.machine.z = z1;
    this.machine.feed = feed;

    if (!this.dryRun && move.type === 'feed') {
      this.stock.cutSegment(x0, y0, z0, x1, y1, z1, this.machine.toolDiameter / 2);
    }

    if (this.progress >= 1) {
      this._applyMove(move);
      this.index++;
      this.progress = 0;
      if (this.index >= this.moves.length) this.playing = false;
    }
    this.onUpdate();
  }
}
