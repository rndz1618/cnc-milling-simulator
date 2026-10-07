/**
 * Training scenario checklist + soft-key helpers (v0.6)
 */
export const trainState = {
  partzero: false,
  toollength: false,
  dryrun: false,
  cyclestart: false,
  dryRunPlayed: false,
  cyclePlayed: false
};

const $ = (id) => document.getElementById(id);

export function renderTrainSteps() {
  const steps = ['partzero', 'toollength', 'dryrun', 'cyclestart'];
  let done = 0;
  let firstOpen = null;
  steps.forEach((id) => {
    const li = document.querySelector('.train-step[data-step="' + id + '"]');
    if (!li) return;
    const ok = !!trainState[id];
    if (ok) done++;
    li.classList.toggle('done', ok);
    li.classList.remove('current');
    const chk = li.querySelector('.train-check');
    if (chk) chk.textContent = ok ? '☑' : '☐';
    if (!ok && firstOpen === null) firstOpen = id;
  });
  if (firstOpen) {
    document.querySelector('.train-step[data-step="' + firstOpen + '"]')?.classList.add('current');
  }
  const pct = (done / steps.length) * 100;
  if ($('trainProgressFill')) $('trainProgressFill').style.width = pct + '%';
  if ($('trainProgressText')) $('trainProgressText').textContent = done + ' / 4 langkah';
  if (done === 4 && $('sbMsg')) {
    $('sbMsg').textContent = 'Training complete \u2014 semua prosedur selesai';
  }
}

export function markTrain(step) {
  if (trainState[step]) return;
  trainState[step] = true;
  renderTrainSteps();
  if ($('sbMsg')) {
    const labels = {
      partzero: '\u2713 Part Zero (G54) selesai',
      toollength: '\u2713 Tool Length diterapkan',
      dryrun: '\u2713 Dry Run dijalankan',
      cyclestart: '\u2713 Cycle Start produksi selesai'
    };
    $('sbMsg').textContent = labels[step] || 'Step done';
  }
}

export function openTraining() {
  const ov = $('trainOverlay');
  if (!ov) return;
  ov.style.display = 'flex';
  ov.setAttribute('aria-hidden', 'false');
  renderTrainSteps();
}

export function closeTraining() {
  const ov = $('trainOverlay');
  if (!ov) return;
  ov.style.display = 'none';
  ov.setAttribute('aria-hidden', 'true');
}

export function resetTraining() {
  trainState.partzero = false;
  trainState.toollength = false;
  trainState.dryrun = false;
  trainState.cyclestart = false;
  trainState.dryRunPlayed = false;
  trainState.cyclePlayed = false;
  renderTrainSteps();
  if ($('sbMsg')) $('sbMsg').textContent = 'Training checklist di-reset';
}
