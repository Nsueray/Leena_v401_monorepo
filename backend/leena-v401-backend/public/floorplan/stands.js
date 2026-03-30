/**
 * Floor Plan Builder — Stands Module
 * Stand creation, deletion, and dialog management.
 */

import { state } from './state.js';
import { createStand, deleteStand } from './api.js';
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

function updateDetailPanel(stand) {
  const panel = document.getElementById('stand-detail');
  if (!panel) return;

  if (!stand) {
    panel.innerHTML = '<div class="detail-empty">Select a stand to view details</div>';
    const deleteBtn = document.getElementById('btn-delete-stand');
    if (deleteBtn) deleteBtn.style.display = 'none';
    return;
  }

  const statusBadge = getStatusBadgeHtml(stand);

  panel.innerHTML = `
    <div class="detail-row"><span class="detail-label">Code</span><span class="detail-value">${stand.stand_code}</span></div>
    <div class="detail-row"><span class="detail-label">Zone</span><span class="detail-value">${stand.zone || '—'}</span></div>
    <div class="detail-row"><span class="detail-label">Type</span><span class="detail-value">${stand.area_kind}</span></div>
    <div class="detail-row"><span class="detail-label">Size</span><span class="detail-value">${stand.size_m2 ? parseFloat(stand.size_m2) + ' m²' : '—'}</span></div>
    <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value">${statusBadge}</span></div>
    <div class="detail-row"><span class="detail-label">Company</span><span class="detail-value">${stand.assigned_company_name || '—'}</span></div>
    <div class="detail-row"><span class="detail-label">Stand Type</span><span class="detail-value">${stand.stand_type || '—'}</span></div>
    ${stand.notes ? `<div class="detail-row"><span class="detail-label">Notes</span><span class="detail-value">${stand.notes}</span></div>` : ''}
  `;

  const deleteBtn = document.getElementById('btn-delete-stand');
  if (deleteBtn) {
    deleteBtn.style.display = state.isDraft() ? 'inline-flex' : 'none';
  }
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

  if (!code) {
    alert('Stand code is required');
    return;
  }

  const cells = [];
  for (const key of state.selectedCells) {
    const [x, y] = key.split(',').map(Number);
    cells.push({ x, y });
  }

  const submitBtn = document.getElementById('dialog-submit');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Creating...'; }

  try {
    const stand = await createStand(state.currentVersion.id, {
      stand_code: code,
      zone: zone || undefined,
      display_label: label || undefined,
      area_kind: areaKind,
      cells
    });

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
