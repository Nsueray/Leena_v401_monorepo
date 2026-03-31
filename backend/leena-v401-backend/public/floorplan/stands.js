/**
 * Floor Plan Builder — Stands Module
 * Stand creation, deletion, editing, status change, and dialog management.
 */

import { state } from './state.js';
import { createStand, deleteStand, updateStand, updateStandStatus, splitStand, mergeStands } from './api.js';
import { drawStands, drawSelection } from './grid.js';

export function initStandActions() {
  // Create stand button
  const createBtn = document.getElementById('btn-create-stand');
  if (createBtn) {
    createBtn.addEventListener('click', showCreateDialog);
  }

  // Delete stand button
  const deleteBtn = document.getElementById('btn-delete-stand');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', handleDeleteStand);
  }

  // Listen for stand selection to update detail panel
  state.on('standSelected', updateDetailPanel);
  state.on('standUpdated', (stand) => { updateDetailPanel(stand); updateStats(); });
  state.on('selectionChanged', updateCreateButton);
  state.on('standsLoaded', updateStats);
  state.on('standAdded', updateStats);
  state.on('standRemoved', updateStats);
}

function updateCreateButton() {
  const btn = document.getElementById('btn-create-stand');
  if (!btn) return;
  const count = state.selectedCells.size;
  btn.disabled = count === 0 || !state.isDraft();
  btn.textContent = count > 0 ? `Create Stand (${count}m²)` : 'Create Stand';
}

// --- Detail Panel with inline editing ---

const STATUS_OPTIONS = [
  { value: 'available', label: 'Available' },
  { value: 'hold', label: 'Hold' },
  { value: 'reserved', label: 'Reserved' },
  { value: 'pending_contract', label: 'Pending Contract' },
  { value: 'sold', label: 'Sold' }
];

const COLOR_PALETTE = [
  { color: '', label: 'Default' },
  { color: '#dbeafe', label: 'Blue' },
  { color: '#dcfce7', label: 'Green' },
  { color: '#fef3c7', label: 'Yellow' },
  { color: '#fce7f3', label: 'Pink' },
  { color: '#ede9fe', label: 'Purple' },
  { color: '#ffedd5', label: 'Orange' },
  { color: '#f0fdfa', label: 'Teal' },
  { color: '#fef2f2', label: 'Red' },
  { color: '#f3f4f6', label: 'Grey' }
];

function updateDetailPanel(stand) {
  const panel = document.getElementById('stand-detail');
  if (!panel) return;

  // Multi-select: show merge UI
  if (state.selectedStands.length >= 2) {
    const totalCells = state.selectedStands.reduce((sum, s) => sum + (s.cells ? s.cells.length : 0), 0);
    const codes = state.selectedStands.map(s => s.stand_code).join(' + ');
    panel.innerHTML = `
      <div style="background:#fef3c7;border-radius:8px;padding:12px;margin-bottom:10px;">
        <div style="font-size:12px;font-weight:600;color:#92400e;margin-bottom:4px;">${state.selectedStands.length} Stands Selected</div>
        <div style="font-size:11px;color:#92400e;">${codes}</div>
        <div style="font-size:11px;color:#92400e;margin-top:4px;">Total: ${totalCells} m²</div>
      </div>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-primary btn-sm" id="btn-merge-stands" style="flex:1;justify-content:center;"><i class="bi bi-union"></i> Merge</button>
        <button class="btn btn-sm" id="btn-bulk-duplicate" style="flex:1;justify-content:center;background:#d1fae5;color:#065f46;border-color:#6ee7b7;"><i class="bi bi-files"></i> Duplicate All</button>
      </div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:6px;text-align:center;">Shift+click or drag-select to pick stands</div>
    `;
    document.getElementById('btn-merge-stands')?.addEventListener('click', handleMergeStands);
    document.getElementById('btn-bulk-duplicate')?.addEventListener('click', handleBulkDuplicate);

    const deleteBtn = document.getElementById('btn-delete-stand');
    if (deleteBtn) deleteBtn.style.display = 'none';
    const splitBtn = document.getElementById('btn-split-stand');
    if (splitBtn) splitBtn.style.display = 'none';
    return;
  }

  if (!stand) {
    panel.innerHTML = '<div class="detail-empty">Select a stand to view details</div>';
    const deleteBtn = document.getElementById('btn-delete-stand');
    if (deleteBtn) deleteBtn.style.display = 'none';
    return;
  }

  const isStandType = stand.area_kind === 'stand';

  // Status dropdown (only for area_kind='stand')
  let statusHtml;
  if (isStandType) {
    const opts = STATUS_OPTIONS.map(o =>
      `<option value="${o.value}" ${stand.commercial_status === o.value ? 'selected' : ''}>${o.label}</option>`
    ).join('');
    statusHtml = `<select class="detail-select" id="detail-status">${opts}</select>`;
  } else {
    statusHtml = getStatusBadgeHtml(stand);
  }

  // Company name input (editable for all stands)
  const companyVal = stand.assigned_company_name || '';

  // Current custom color from metadata
  const meta = typeof stand.metadata === 'string' ? JSON.parse(stand.metadata || '{}') : (stand.metadata || {});
  const currentColor = meta.color || '';

  // Color palette swatches (only for area_kind='stand')
  let colorHtml = '';
  if (isStandType) {
    const swatches = COLOR_PALETTE.map(c => {
      const bg = c.color || '#ffffff';
      const sel = currentColor === c.color ? 'color-swatch-active' : '';
      return `<div class="color-swatch ${sel}" data-color="${c.color}" title="${c.label}" style="background:${bg};"></div>`;
    }).join('');
    colorHtml = `<div class="detail-row detail-edit-row"><span class="detail-label">Color</span><div class="color-palette">${swatches}</div></div>`;
  }

  panel.innerHTML = `
    <div class="detail-row"><span class="detail-label">Code</span><span class="detail-value">${stand.stand_code}</span></div>
    <div class="detail-row"><span class="detail-label">Zone</span><span class="detail-value">${stand.zone || '—'}</span></div>
    <div class="detail-row"><span class="detail-label">Type</span><span class="detail-value">${stand.area_kind}${stand.special_area_type ? ' / ' + stand.special_area_type : ''}</span></div>
    <div class="detail-row"><span class="detail-label">Size</span><span class="detail-value">${stand.size_m2 ? parseFloat(stand.size_m2) + ' m²' : '—'}</span></div>
    <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value">${statusHtml}</span></div>
    ${colorHtml}
    <div class="detail-row detail-edit-row">
      <span class="detail-label">Company</span>
      <input class="detail-input" id="detail-company" type="text" value="${escapeHtml(companyVal)}" placeholder="Company name">
    </div>
    <div class="detail-row detail-edit-row">
      <span class="detail-label">Label</span>
      <input class="detail-input" id="detail-label" type="text" value="${escapeHtml(stand.display_label || '')}" placeholder="Display label">
    </div>
    <div class="detail-row detail-edit-row">
      <span class="detail-label">Notes</span>
      <input class="detail-input" id="detail-notes" type="text" value="${escapeHtml(stand.notes || '')}" placeholder="Notes">
    </div>
    <button class="btn btn-primary btn-sm btn-block" id="btn-save-stand" style="margin-top:10px;"><i class="bi bi-check-lg"></i> Save Changes</button>
  `;

  // Bind status dropdown change (instant save)
  const statusSelect = document.getElementById('detail-status');
  if (statusSelect) {
    statusSelect.addEventListener('change', async () => {
      try {
        const updated = await updateStandStatus(stand.id, statusSelect.value);
        state.updateStand(updated);
      } catch (err) {
        alert(err.message);
        statusSelect.value = stand.commercial_status;
      }
    });
  }

  // Bind color swatch clicks (instant save)
  document.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.addEventListener('click', async () => {
      const color = swatch.dataset.color;
      const newMeta = { ...meta, color: color || undefined };
      if (!color) delete newMeta.color;
      try {
        const updated = await updateStand(stand.id, { metadata: newMeta });
        state.updateStand(updated);
      } catch (err) {
        alert(err.message);
      }
    });
  });

  // Bind save button for text fields
  const saveBtn = document.getElementById('btn-save-stand');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const fields = {};
      const newCompany = document.getElementById('detail-company')?.value?.trim() ?? '';
      const newLabel = document.getElementById('detail-label')?.value?.trim() ?? '';
      const newNotes = document.getElementById('detail-notes')?.value?.trim() ?? '';

      if (newCompany !== (stand.assigned_company_name || '')) fields.assigned_company_name = newCompany;
      if (newLabel !== (stand.display_label || '')) fields.display_label = newLabel;
      if (newNotes !== (stand.notes || '')) fields.notes = newNotes;

      if (Object.keys(fields).length === 0) return;

      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      try {
        const updated = await updateStand(stand.id, fields);
        state.updateStand(updated);
      } catch (err) {
        alert(err.message);
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Changes';
      }
    });
  }

  const deleteBtn = document.getElementById('btn-delete-stand');
  if (deleteBtn) {
    deleteBtn.style.display = state.isDraft() ? 'inline-flex' : 'none';
  }

  // Split button (only for stands with 2+ cells, draft only)
  const splitBtn = document.getElementById('btn-split-stand');
  if (splitBtn) {
    const canSplit = state.isDraft() && stand.cells && stand.cells.length >= 2 && stand.area_kind === 'stand';
    splitBtn.style.display = canSplit ? 'inline-flex' : 'none';
    splitBtn.onclick = () => showSplitDialog(stand);
  }

  // Duplicate button (draft only)
  const dupBtn = document.getElementById('btn-duplicate-stand');
  if (dupBtn) {
    dupBtn.style.display = state.isDraft() ? 'inline-flex' : 'none';
    dupBtn.onclick = () => startDuplicate(stand);
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getStatusBadgeHtml(stand) {
  if (stand.area_kind === 'special') {
    return `<span class="status-badge status-special">${stand.special_area_type || 'special'}</span>`;
  }
  if (stand.area_kind === 'blocked') {
    return '<span class="status-badge status-blocked">blocked</span>';
  }
  const cls = `status-${stand.commercial_status || 'available'}`;
  return `<span class="status-badge ${cls}">${stand.commercial_status || 'available'}</span>`;
}

export function updateStats() {
  const stats = state.getStats();

  setText('stat-total-area', `${stats.totalArea} m²`);
  setText('stat-net-area', `${stats.netArea} m²`);
  setText('stat-sold', `${stats.soldArea} m² (${stats.soldPercent}%)`);
  setText('stat-available', `${stats.availableArea} m²`);
  setText('stat-reserved', `${stats.reservedArea} m²`);
  setText('stat-stands', stats.standCount);
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// --- Create Stand Dialog ---

function showCreateDialog() {
  if (state.selectedCells.size === 0) return;

  const dialog = document.getElementById('create-stand-dialog');
  if (!dialog) return;

  // Reset form
  const form = dialog.querySelector('form');
  if (form) form.reset();

  // Hide special type group (form.reset doesn't affect display)
  const specialGroup = document.getElementById('special-type-group');
  if (specialGroup) specialGroup.style.display = 'none';

  // Pre-fill from duplicate template if available
  const dup = getPendingDuplicate();
  if (dup) {
    const codeInput = document.getElementById('dialog-stand-code');
    const zoneInput = document.getElementById('dialog-zone');
    const labelInput = document.getElementById('dialog-label');
    const areaKindSelect = document.getElementById('dialog-area-kind');
    const specialTypeSelect = document.getElementById('dialog-special-type');

    if (codeInput) codeInput.value = dup.originalCode + '-copy';
    if (zoneInput) zoneInput.value = dup.zone || '';
    if (labelInput) labelInput.value = dup.display_label || '';
    if (areaKindSelect) {
      areaKindSelect.value = dup.area_kind || 'stand';
      if (dup.area_kind === 'special' && specialGroup) {
        specialGroup.style.display = 'block';
        if (specialTypeSelect) specialTypeSelect.value = dup.special_area_type || 'vip';
      }
    }
  }

  const sizeEl = dialog.querySelector('#dialog-size');
  if (sizeEl) sizeEl.textContent = `${state.selectedCells.size} m²`;

  dialog.style.display = 'flex';
  const codeInput = dialog.querySelector('#dialog-stand-code');
  if (codeInput) codeInput.focus();
}

export function hideCreateDialog() {
  const dialog = document.getElementById('create-stand-dialog');
  if (dialog) dialog.style.display = 'none';
}

export async function handleCreateStand(e) {
  if (e) e.preventDefault();

  const code = document.getElementById('dialog-stand-code')?.value?.trim();
  const zone = document.getElementById('dialog-zone')?.value?.trim();
  const label = document.getElementById('dialog-label')?.value?.trim();
  const areaKind = document.getElementById('dialog-area-kind')?.value || 'stand';
  const specialType = document.getElementById('dialog-special-type')?.value || undefined;

  const cells = [];
  for (const key of state.selectedCells) {
    const [x, y] = key.split(',').map(Number);
    cells.push({ x, y });
  }

  const submitBtn = document.getElementById('dialog-submit');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Creating...'; }

  try {
    const standData = {
      zone: zone || undefined,
      display_label: label || undefined,
      area_kind: areaKind,
      cells
    };
    if (code) standData.stand_code = code;
    if (areaKind === 'special' && specialType) standData.special_area_type = specialType;

    const stand = await createStand(state.currentVersion.id, standData);

    state.addStand(stand);
    hideCreateDialog();
  } catch (err) {
    alert(err.message);
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create'; }
  }
}

async function handleDeleteStand() {
  if (!state.selectedStand) return;
  if (!state.isDraft()) return;

  const stand = state.selectedStand;
  if (!confirm(`Delete stand ${stand.stand_code} (${stand.size_m2 || 0} m²)?`)) return;

  try {
    await deleteStand(stand.id);
    state.removeStand(stand.id);
  } catch (err) {
    alert(err.message);
  }
}

// --- Duplicate ---

let pendingDuplicate = null; // stand template to duplicate

function startDuplicate(stand) {
  // Store template, switch to draw mode — user selects new cells, then dialog opens pre-filled
  pendingDuplicate = {
    zone: stand.zone,
    display_label: stand.display_label,
    area_kind: stand.area_kind,
    special_area_type: stand.special_area_type,
    stand_type: stand.stand_type,
    metadata: stand.metadata,
    originalCode: stand.stand_code
  };
  state.setTool('draw');
  // Show hint
  const panel = document.getElementById('stand-detail');
  if (panel) {
    panel.innerHTML = `
      <div style="background:#d1fae5;border-radius:8px;padding:12px;">
        <div style="font-size:12px;font-weight:600;color:#065f46;margin-bottom:4px;">Duplicate Mode</div>
        <div style="font-size:11px;color:#065f46;">Select cells for the duplicate of <strong>${stand.stand_code}</strong>, then click "Create Stand".</div>
      </div>
    `;
  }
}

export function getPendingDuplicate() {
  const dup = pendingDuplicate;
  pendingDuplicate = null;
  return dup;
}

// --- Merge ---

async function handleMergeStands() {
  if (state.selectedStands.length < 2) return;
  if (!state.isDraft()) { alert('Can only merge stands in draft versions'); return; }

  const codes = state.selectedStands.map(s => s.stand_code).join('+');
  const mergedCode = prompt('Stand code for merged stand:', codes) || '';

  const ids = state.selectedStands.map(s => s.id);

  try {
    const merged = await mergeStands(ids, mergedCode.trim() || undefined);

    // Remove old stands, add merged
    for (const id of ids) state.removeStand(id);
    state.addStand(merged);
    state.selectStand(merged);
  } catch (err) {
    alert(err.message);
  }
}

// --- Bulk Duplicate ---

async function handleBulkDuplicate() {
  const stands = state.selectedStands;
  if (stands.length === 0 || !state.isDraft() || !state.currentVersion) return;

  // Compute bounding box of all selected stands
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of stands) {
    for (const c of (s.cells || [])) {
      if (c.x < minX) minX = c.x;
      if (c.x > maxX) maxX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.y > maxY) maxY = c.y;
    }
  }

  const spanX = maxX - minX + 1;
  const occupied = state.getOccupiedCells();

  // Try placing to the right first (offset = spanX + 1)
  let offsetX = spanX + 1;
  let offsetY = 0;

  // Check if right placement fits
  let fits = true;
  for (const s of stands) {
    for (const c of (s.cells || [])) {
      const nx = c.x + offsetX;
      const ny = c.y + offsetY;
      if (nx >= state.gridWidth || occupied.has(`${nx},${ny}`)) { fits = false; break; }
    }
    if (!fits) break;
  }

  // If right doesn't fit, try below
  if (!fits) {
    const spanY = maxY - minY + 1;
    offsetX = 0;
    offsetY = spanY + 1;
    fits = true;
    for (const s of stands) {
      for (const c of (s.cells || [])) {
        const nx = c.x + offsetX;
        const ny = c.y + offsetY;
        if (ny >= state.gridHeight || occupied.has(`${nx},${ny}`)) { fits = false; break; }
      }
      if (!fits) break;
    }
  }

  if (!fits) {
    alert('Not enough space to duplicate — no room to the right or below.');
    return;
  }

  if (!confirm(`Duplicate ${stands.length} stands (offset: +${offsetX}x, +${offsetY}y)?`)) return;

  try {
    for (const s of stands) {
      const newCells = (s.cells || []).map(c => ({ x: c.x + offsetX, y: c.y + offsetY }));
      const newStand = await createStand(state.currentVersion.id, {
        stand_code: s.stand_code + '-c',
        zone: s.zone || undefined,
        area_kind: s.area_kind,
        stand_type: s.stand_type || undefined,
        metadata: s.metadata || undefined,
        cells: newCells
      });
      state.addStand(newStand);
    }
  } catch (err) {
    alert(err.message);
  }
}

// --- Split (Dialog-based: horizontal or vertical) ---

function showSplitDialog(stand) {
  const dialog = document.getElementById('split-stand-dialog');
  if (!dialog) return;

  const cells = stand.cells || [];
  if (cells.length < 2) return;

  // Compute bounding box
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of cells) {
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
  }

  const spanX = maxX - minX + 1;
  const spanY = maxY - minY + 1;
  const midX = minX + Math.floor(spanX / 2);
  const midY = minY + Math.floor(spanY / 2);

  // Enable/disable buttons based on dimensions
  const hBtn = document.getElementById('split-horizontal');
  const vBtn = document.getElementById('split-vertical');
  if (hBtn) hBtn.disabled = spanY < 2;
  if (vBtn) vBtn.disabled = spanX < 2;

  // Show preview info
  const infoEl = document.getElementById('split-info');
  if (infoEl) {
    infoEl.innerHTML = `
      <strong>${stand.stand_code}</strong> (${cells.length} m²)<br>
      ${spanX} x ${spanY} cells
    `;
  }

  // Code inputs
  const codeA = document.getElementById('split-code-a');
  const codeB = document.getElementById('split-code-b');
  if (codeA) codeA.value = stand.stand_code + 'a';
  if (codeB) codeB.value = stand.stand_code + 'b';

  dialog.style.display = 'flex';

  // Bind split actions
  const doSplit = async (direction) => {
    const cellsA = [];
    const cellsB = [];

    for (const c of cells) {
      if (direction === 'horizontal') {
        (c.y < midY ? cellsA : cellsB).push(c);
      } else {
        (c.x < midX ? cellsA : cellsB).push(c);
      }
    }

    if (cellsA.length === 0 || cellsB.length === 0) {
      alert('Cannot split: one side would be empty');
      return;
    }

    const nameA = codeA?.value?.trim() || undefined;
    const nameB = codeB?.value?.trim() || undefined;

    if (hBtn) hBtn.disabled = true;
    if (vBtn) vBtn.disabled = true;

    try {
      const newStands = await splitStand(stand.id, [
        { stand_code: nameA, cells: cellsA },
        { stand_code: nameB, cells: cellsB }
      ]);

      dialog.style.display = 'none';
      state.removeStand(stand.id);
      for (const ns of newStands) state.addStand(ns);
    } catch (err) {
      alert(err.message);
      if (hBtn) hBtn.disabled = spanY < 2;
      if (vBtn) vBtn.disabled = spanX < 2;
    }
  };

  if (hBtn) hBtn.onclick = () => doSplit('horizontal');
  if (vBtn) vBtn.onclick = () => doSplit('vertical');
}
