/**
 * v0.6 soft keys + training wiring (loads after main.js)
 */
import {
  trainState, markTrain, openTraining, closeTraining, resetTraining, renderTrainSteps
} from './train.js';

const $ = (id) => document.getElementById(id);

document.querySelectorAll('.sk').forEach((btn) => {
  btn.addEventListener('click', () => {
    const sk = btn.dataset.sk;
    if (sk === 'f1') {
      const tab = document.querySelector('.mode-tab[data-mode="setup"]');
      if (tab) tab.click();
      document.querySelectorAll('.subtab').forEach((b) => {
        b.classList.toggle('active', b.dataset.sub === 'work');
      });
      if ($('setupWork')) $('setupWork').style.display = 'flex';
      if ($('setupTool')) $('setupTool').style.display = 'none';
      if ($('setupJog')) $('setupJog').style.display = 'none';
      if ($('sbMsg')) $('sbMsg').textContent = 'OFFSET \u2014 Work Coordinate System';
    } else if (sk === 'f2') {
      if ($('sbMsg')) $('sbMsg').textContent = 'CURNT CMDS \u2014 Active Codes';
    } else if (sk === 'f3') {
      if ($('sbAlarm')) {
        $('sbAlarm').textContent = 'NO ALARMS';
        $('sbAlarm').className = 'sb-item ok';
      }
      if ($('sbMsg')) $('sbMsg').textContent = 'ALARM \u2014 history kosong';
    } else if (sk === 'f4') {
      if ($('sbMsg')) $('sbMsg').textContent = 'GRAPH \u2014 viewport 3D aktif';
    } else if (sk === 'f5') {
      openTraining();
    } else if (sk === 'f6') {
      if ($('sbMsg')) $('sbMsg').textContent = 'COOLANT toggled';
      btn.classList.toggle('active');
      const lbl = $('sk6');
      if (lbl) lbl.textContent = btn.classList.contains('active') ? 'CLNT ON' : 'COOLANT';
    } else if (sk === 'f7') {
      const c = $('chkSingleBlock');
      if (c) {
        c.checked = !c.checked;
        c.dispatchEvent(new Event('change'));
      }
      btn.classList.toggle('active', c && c.checked);
      const lbl = $('sk7');
      if (lbl) lbl.textContent = (c && c.checked) ? 'SB ON' : 'SINGLE BLK';
    } else if (sk === 'f8') {
      const c = $('chkDryRun');
      if (c) {
        c.checked = !c.checked;
        c.dispatchEvent(new Event('change'));
      }
      btn.classList.toggle('active', c && c.checked);
      const lbl = $('sk8');
      if (lbl) lbl.textContent = (c && c.checked) ? 'DRY ON' : 'DRY RUN';
    }
  });
});

if ($('btnTrainClose')) $('btnTrainClose').addEventListener('click', closeTraining);
if ($('trainOverlay')) {
  $('trainOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'trainOverlay') closeTraining();
  });
}
if ($('btnTrainReset')) $('btnTrainReset').addEventListener('click', resetTraining);
if ($('btnTrainStart')) {
  $('btnTrainStart').addEventListener('click', () => {
    closeTraining();
    document.querySelector('.mode-tab[data-mode="setup"]')?.click();
    document.querySelectorAll('.subtab').forEach((b) => {
      b.classList.toggle('active', b.dataset.sub === 'work');
    });
    if ($('setupWork')) $('setupWork').style.display = 'flex';
    if ($('setupTool')) $('setupTool').style.display = 'none';
    if ($('setupJog')) $('setupJog').style.display = 'none';
  });
}
document.querySelectorAll('.train-goto').forEach((btn) => {
  btn.addEventListener('click', () => {
    const g = btn.dataset.goto;
    closeTraining();
    if (g === 'partzero' || g === 'toollength') {
      document.querySelector('.mode-tab[data-mode="setup"]')?.click();
      const sub = g === 'partzero' ? 'work' : 'tool';
      document.querySelectorAll('.subtab').forEach((b) => {
        b.classList.toggle('active', b.dataset.sub === sub);
      });
      if ($('setupWork')) $('setupWork').style.display = sub === 'work' ? 'flex' : 'none';
      if ($('setupTool')) $('setupTool').style.display = sub === 'tool' ? 'flex' : 'none';
      if ($('setupJog')) $('setupJog').style.display = 'none';
    } else {
      document.querySelector('.mode-tab[data-mode="operation"]')?.click();
      if (g === 'dryrun') {
        const c = $('chkDryRun');
        if (c && !c.checked) {
          c.checked = true;
          c.dispatchEvent(new Event('change'));
        }
      } else if (g === 'cyclestart') {
        const c = $('chkDryRun');
        if (c && c.checked) {
          c.checked = false;
          c.dispatchEvent(new Event('change'));
        }
      }
    }
  });
});

if ($('btnApplyWcs')) {
  $('btnApplyWcs').addEventListener('click', () => markTrain('partzero'));
}
if ($('btnApplyTool')) {
  $('btnApplyTool').addEventListener('click', () => markTrain('toollength'));
}

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
  const fMap = { F1: 'f1', F2: 'f2', F3: 'f3', F4: 'f4', F5: 'f5', F6: 'f6', F7: 'f7', F8: 'f8' };
  if (fMap[e.key]) {
    e.preventDefault();
    document.querySelector('[data-sk="' + fMap[e.key] + '"]')?.click();
  }
});

let prevDone = false;
setInterval(() => {
  const st = $('simStatus');
  if (!st) return;
  const done = st.textContent === 'DONE';
  if (done && !prevDone) {
    const dry = $('chkDryRun')?.checked;
    if (dry) markTrain('dryrun');
    else markTrain('cyclestart');
  }
  prevDone = done;
}, 500);

console.log('[v0.6] soft keys + training ready');
