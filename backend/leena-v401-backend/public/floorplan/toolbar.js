/**
 * Floor Plan Builder — Toolbar Module
 * Tool selection, expo/hall/version dropdowns, and hall creation dialog.
 */

import { state } from './state.js';
import { fetchHalls, createHall, updateHall, fetchVersions, createVersion, fetchStands, activateVersion, cloneVersion } from './api.js';
import { fitToView, zoomIn, zoomOut, exportPNG, setBackgroundImage, removeBackgroundImage, setBackgroundOpacity, loadSavedBackground, toggleBgLock, isBgLocked, fitBgToGrid } from './grid.js';
import { updateStats } from './stands.js';

export function initToolbar() {
  // Tool buttons
  document.querySelectorAll('[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.setTool(btn.dataset.tool);
    });
  });

  state.on('toolChanged', (tool) => {
    document.querySelectorAll('[data-tool]').forEach(btn => {
      btn.classList.toggle('tool-active', btn.dataset.tool === tool);
    });
    // Update cursor
    const container = document.getElementById('canvas-container');
    if (container) {
      container.style.cursor = tool === 'draw' ? 'crosshair' : tool === 'erase' ? 'not-allowed' : 'default';
    }
  });

  // Hall select
  const hallSelect = document.getElementById('hall-select');
  if (hallSelect) {
    hallSelect.addEventListener('change', async () => {
      const hallId = hallSelect.value;
      if (!hallId) { state.setCurrentHall(null); return; }
      const hall = state.halls.find(h => h.id == hallId);
      state.setCurrentHall(hall);
      await loadVersions(hall.id);
    });
  }

  // Version select
  const versionSelect = document.getElementById('version-select');
  if (versionSelect) {
    versionSelect.addEventListener('change', async () => {
      const versionId = versionSelect.value;
      if (!versionId) { state.setCurrentVersion(null); return; }
      const version = state.versions.find(v => v.id == versionId);
      state.setCurrentVersion(version);
      await loadStands(versionId);
    });
  }

  // Create hall button
  const createHallBtn = document.getElementById('btn-create-hall');
  if (createHallBtn) {
    createHallBtn.addEventListener('click', showHallDialog);
  }

  // Edit hall dimensions button
  const editHallBtn = document.getElementById('btn-edit-hall');
  if (editHallBtn) {
    editHallBtn.addEventListener('click', handleEditHall);
  }

  // Create version button
  const createVersionBtn = document.getElementById('btn-create-version');
  if (createVersionBtn) {
    createVersionBtn.addEventListener('click', handleCreateVersion);
  }

  // Background image controls
  const bgFileInput = document.getElementById('bg-file-input');
  const uploadBgBtn = document.getElementById('btn-upload-bg');
  const removeBgBtn = document.getElementById('btn-remove-bg');
  const bgOpacity = document.getElementById('bg-opacity');
  const bgLockBtn = document.getElementById('btn-bg-lock');
  const bgFitBtn = document.getElementById('btn-bg-fit');

  function showBgControls(show) {
    if (removeBgBtn) removeBgBtn.style.display = show ? 'flex' : 'none';
    if (bgOpacity) bgOpacity.style.display = show ? 'block' : 'none';
    if (bgLockBtn) bgLockBtn.style.display = show ? 'flex' : 'none';
    if (bgFitBtn) bgFitBtn.style.display = show ? 'flex' : 'none';
    updateBgLockBtn();
  }

  function updateBgLockBtn() {
    if (bgLockBtn) {
      const locked = isBgLocked();
      bgLockBtn.innerHTML = locked ? '<i class="bi bi-lock"></i>' : '<i class="bi bi-unlock"></i>';
      bgLockBtn.title = locked ? 'Unlock Background (drag/resize)' : 'Lock Background';
      bgLockBtn.style.color = locked ? 'var(--text-secondary)' : 'var(--warning)';
    }
  }

  if (uploadBgBtn && bgFileInput) {
    uploadBgBtn.addEventListener('click', () => bgFileInput.click());
    bgFileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      if (file.type === 'application/pdf' && typeof pdfjsLib !== 'undefined') {
        // PDF → PNG client-side rendering
        try {
          const arrayBuffer = await file.arrayBuffer();
          pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
          const page = await pdf.getPage(1);
          const viewport = page.getViewport({ scale: 2 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
          setBackgroundImage(canvas.toDataURL('image/png'));
          showBgControls(true);
        } catch (err) {
          console.error('PDF render error:', err);
          alert('Failed to render PDF. Try converting to PNG first.');
        }
      } else {
        // Normal image
        const reader = new FileReader();
        reader.onload = (ev) => {
          setBackgroundImage(ev.target.result);
          showBgControls(true);
        };
        reader.readAsDataURL(file);
      }
      bgFileInput.value = '';
    });
  }
  if (removeBgBtn) {
    removeBgBtn.addEventListener('click', () => {
      removeBackgroundImage();
      showBgControls(false);
    });
  }
  if (bgOpacity) {
    bgOpacity.addEventListener('input', () => {
      setBackgroundOpacity(parseInt(bgOpacity.value) / 100);
    });
  }
  if (bgLockBtn) {
    bgLockBtn.addEventListener('click', () => { toggleBgLock(); updateBgLockBtn(); });
  }
  if (bgFitBtn) {
    bgFitBtn.addEventListener('click', fitBgToGrid);
  }

  // Export PNG button
  const exportBtn = document.getElementById('btn-export-png');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportPNG);
  }

  // Clone version button
  const cloneBtn = document.getElementById('btn-clone-version');
  if (cloneBtn) {
    cloneBtn.addEventListener('click', handleCloneVersion);
  }

  // Activate version button
  const activateBtn = document.getElementById('btn-activate-version');
  if (activateBtn) {
    activateBtn.addEventListener('click', handleActivateVersion);
  }

  // Zoom buttons
  const zoomInBtn = document.getElementById('btn-zoom-in');
  if (zoomInBtn) zoomInBtn.addEventListener('click', zoomIn);
  const zoomOutBtn = document.getElementById('btn-zoom-out');
  if (zoomOutBtn) zoomOutBtn.addEventListener('click', zoomOut);

  // Fit to view button
  const fitBtn = document.getElementById('btn-fit-view');
  if (fitBtn) {
    fitBtn.addEventListener('click', fitToView);
  }

  // Listen to state for UI updates
  state.on('hallsLoaded', renderHallOptions);
  state.on('versionsLoaded', renderVersionOptions);
  state.on('versionChanged', updateDraftIndicator);
}

export async function loadHalls() {
  if (!state.expoId) return;
  try {
    const halls = await fetchHalls(state.expoId);
    state.setHalls(halls);
  } catch (err) {
    console.error('Failed to load halls:', err);
  }
}

async function loadVersions(hallId) {
  try {
    const versions = await fetchVersions(hallId);
    state.setVersions(versions);

    // Auto-select first version if available
    if (versions.length > 0) {
      state.setCurrentVersion(versions[0]);
      await loadStands(versions[0].id);
    }
  } catch (err) {
    console.error('Failed to load versions:', err);
  }
}

async function loadStands(versionId) {
  try {
    const { version, stands } = await fetchStands(versionId);
    // Update grid dimensions from version response
    if (version) {
      state.gridWidth = version.grid_width;
      state.gridHeight = version.grid_height;
      state.cellSizeM2 = parseFloat(version.cell_size_m2) || 1.0;
    }
    state.setStands(stands);
    updateStats();
    setTimeout(() => {
      fitToView();
      loadSavedBackground();
      const key = `fp_bg_${state.expoId}_${state.currentHall?.id}`;
      showBgControls(!!localStorage.getItem(key));
    }, 50);
  } catch (err) {
    console.error('Failed to load stands:', err);
  }
}

function renderHallOptions(halls) {
  const select = document.getElementById('hall-select');
  if (!select) return;
  select.innerHTML = '<option value="">-- Select Hall --</option>';
  for (const hall of halls) {
    const opt = document.createElement('option');
    opt.value = hall.id;
    opt.textContent = `${hall.name} (${hall.grid_width}x${hall.grid_height})`;
    select.appendChild(opt);
  }
}

function renderVersionOptions(versions) {
  const select = document.getElementById('version-select');
  if (!select) return;
  select.innerHTML = '<option value="">-- Select Version --</option>';
  for (const v of versions) {
    const opt = document.createElement('option');
    opt.value = v.id;
    const badge = v.status === 'active' ? ' [ACTIVE]' : v.status === 'archived' ? ' [archived]' : '';
    opt.textContent = `v${v.version_number} — ${v.version_label || 'Untitled'}${badge}`;
    select.appendChild(opt);
  }
  // Auto-select first
  if (versions.length > 0) {
    select.value = versions[0].id;
  }
}

function updateDraftIndicator() {
  const indicator = document.getElementById('draft-indicator');
  if (!indicator) return;
  if (!state.currentVersion) {
    indicator.textContent = '';
    return;
  }
  const s = state.currentVersion.status;
  indicator.textContent = s.toUpperCase();
  indicator.className = `version-status status-${s}`;

  // Show/hide activate button
  const activateBtn = document.getElementById('btn-activate-version');
  if (activateBtn) {
    activateBtn.style.display = s === 'draft' ? 'flex' : 'none';
  }
}

async function handleActivateVersion() {
  if (!state.currentVersion || state.currentVersion.status !== 'draft') return;

  if (!confirm('Activate this version? The current active version (if any) will be archived.')) return;

  try {
    const activated = await activateVersion(state.currentVersion.id);
    state.setCurrentVersion(activated);

    // Reload versions list to reflect status changes
    if (state.currentHall) {
      const versions = await fetchVersions(state.currentHall.id);
      state.setVersions(versions);
    }
  } catch (err) {
    alert(err.message);
  }
}

async function handleCloneVersion() {
  if (!state.currentVersion) return;

  const clear = confirm('Clone this version?\n\nOK = Clone with assignments\nCancel first, then use code if you need to clear assignments.');
  // Simple: always clone with assignments. clear_assignments=false
  try {
    const cloned = await cloneVersion(state.currentVersion.id, false);

    // Reload versions and select the new one
    if (state.currentHall) {
      const versions = await fetchVersions(state.currentHall.id);
      state.setVersions(versions);
      state.setCurrentVersion(cloned);

      const select = document.getElementById('version-select');
      if (select) select.value = cloned.id;

      // Load stands for cloned version
      const { version, stands } = await fetchStands(cloned.id);
      if (version) {
        state.gridWidth = version.grid_width;
        state.gridHeight = version.grid_height;
      }
      state.setStands(stands);
      updateStats();
      setTimeout(fitToView, 50);
    }
  } catch (err) {
    alert(err.message);
  }
}

// --- Hall Creation Dialog ---

async function handleEditHall() {
  if (!state.currentHall) { alert('Select a hall first'); return; }
  const hall = state.currentHall;
  const newWidth = prompt(`Grid width in meters (current: ${hall.grid_width}):`, hall.grid_width);
  if (!newWidth) return;
  const newHeight = prompt(`Grid height in meters (current: ${hall.grid_height}):`, hall.grid_height);
  if (!newHeight) return;
  const w = parseInt(newWidth), h = parseInt(newHeight);
  if (isNaN(w) || isNaN(h) || w < 5 || h < 5 || w > 200 || h > 200) {
    alert('Invalid dimensions. Min 5, max 200.'); return;
  }
  if (w === hall.grid_width && h === hall.grid_height) return;
  try {
    await updateHall(hall.id, { grid_width: w, grid_height: h });
    location.reload();
  } catch (err) { alert(err.message); }
}

function showHallDialog() {
  const dialog = document.getElementById('create-hall-dialog');
  if (!dialog) return;
  const form = dialog.querySelector('form');
  if (form) form.reset();
  dialog.style.display = 'flex';
  const nameInput = dialog.querySelector('#hall-name');
  if (nameInput) nameInput.focus();
}

export function hideHallDialog() {
  const dialog = document.getElementById('create-hall-dialog');
  if (dialog) dialog.style.display = 'none';
}

export async function handleCreateHall(e) {
  if (e) e.preventDefault();

  const name = document.getElementById('hall-name')?.value?.trim();
  const width = parseInt(document.getElementById('hall-width')?.value);
  const height = parseInt(document.getElementById('hall-height')?.value);

  if (!name || !width || !height) {
    alert('Name, width, and height are required');
    return;
  }

  try {
    const hall = await createHall(state.expoId, name, width, height);
    state.halls.push(hall);
    state.setHalls([...state.halls]);
    state.setCurrentHall(hall);
    hideHallDialog();

    // Auto-select new hall in dropdown
    const select = document.getElementById('hall-select');
    if (select) select.value = hall.id;

    // Auto-create first draft version
    await handleCreateVersion();
  } catch (err) {
    alert(err.message);
  }
}

async function handleCreateVersion() {
  if (!state.currentHall) {
    alert('Select a hall first');
    return;
  }

  try {
    const version = await createVersion(state.currentHall.id);
    state.versions.unshift(version);
    state.setVersions([...state.versions]);
    state.setCurrentVersion(version);

    const select = document.getElementById('version-select');
    if (select) select.value = version.id;

    state.setStands([]);
    updateStats();
    fitToView();
  } catch (err) {
    alert(err.message);
  }
}
