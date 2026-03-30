/**
 * Floor Plan Builder — Grid Module
 * Konva.js Stage, Layer management, grid rendering, zoom/pan, cell interaction.
 */

import { state } from './state.js';

// --- Color maps ---
const STATUS_COLORS = {
  available:        { fill: '#ffffff', stroke: '#d1d5db' },
  hold:             { fill: '#fef3c7', stroke: '#f59e0b' },
  reserved:         { fill: '#fde68a', stroke: '#d97706' },
  pending_contract: { fill: '#fed7aa', stroke: '#ea580c' },
  sold:             { fill: '#bbf7d0', stroke: '#16a34a' }
};

const AREA_KIND_COLORS = {
  special:  { fill: '#e9d5ff', stroke: '#7c3aed' },
  blocked:  { fill: '#fecaca', stroke: '#dc2626' }
};

const SPECIAL_TYPE_COLORS = {
  vip:          { fill: '#c4b5fd', stroke: '#6d28d9' },
  conference:   { fill: '#bfdbfe', stroke: '#2563eb' },
  registration: { fill: '#93c5fd', stroke: '#1d4ed8' },
  entrance:     { fill: '#d1d5db', stroke: '#6b7280' },
  exit:         { fill: '#d1d5db', stroke: '#6b7280' },
  technical:    { fill: '#9ca3af', stroke: '#4b5563' }
};

const CELL_SIZE = 24;         // px per cell at zoom 1.0
const GRID_LINE_COLOR = '#e5e7eb';
const SELECTED_FILL = '#3b82f6';
const SELECTED_OPACITY = 0.4;
const HOVER_FILL = '#60a5fa';
const HOVER_OPACITY = 0.2;

let stage = null;
let gridLayer = null;
let standLayer = null;
let interactionLayer = null;
let selectionRects = [];
let hoverRect = null;

export function initGrid(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight;

  stage = new Konva.Stage({
    container: containerId,
    width: containerWidth,
    height: containerHeight,
    draggable: true
  });

  gridLayer = new Konva.Layer();
  standLayer = new Konva.Layer();
  interactionLayer = new Konva.Layer();

  stage.add(gridLayer);
  stage.add(standLayer);
  stage.add(interactionLayer);

  // Zoom with mouse wheel
  stage.on('wheel', (e) => {
    e.evt.preventDefault();
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();

    const scaleBy = 1.08;
    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const newScale = direction > 0 ? oldScale * scaleBy : oldScale / scaleBy;
    const clampedScale = Math.max(0.2, Math.min(5, newScale));

    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale
    };

    stage.scale({ x: clampedScale, y: clampedScale });
    stage.position({
      x: pointer.x - mousePointTo.x * clampedScale,
      y: pointer.y - mousePointTo.y * clampedScale
    });
  });

  // Cell click handler
  stage.on('click tap', (e) => {
    if (e.target === stage) {
      // Clicked on empty stage — clear selection if in select mode
      if (state.tool === 'select') {
        state.clearSelection();
      }
      return;
    }

    const pos = stage.getPointerPosition();
    const transform = stage.getAbsoluteTransform().copy().invert();
    const realPos = transform.point(pos);
    const cellX = Math.floor(realPos.x / CELL_SIZE);
    const cellY = Math.floor(realPos.y / CELL_SIZE);

    if (cellX < 0 || cellY < 0 || cellX >= state.gridWidth || cellY >= state.gridHeight) return;

    const occupied = state.getOccupiedCells();
    const key = `${cellX},${cellY}`;

    if (state.tool === 'select') {
      const stand = state.getStandAtCell(cellX, cellY);
      state.selectStand(stand);
    } else if (state.tool === 'draw') {
      if (!occupied.has(key)) {
        state.toggleCell(cellX, cellY);
      }
    } else if (state.tool === 'erase') {
      if (state.selectedCells.has(key)) {
        state.toggleCell(cellX, cellY);
      }
    }
  });

  // Mouse move for hover
  stage.on('mousemove', (e) => {
    const pos = stage.getPointerPosition();
    if (!pos) return;
    const transform = stage.getAbsoluteTransform().copy().invert();
    const realPos = transform.point(pos);
    const cellX = Math.floor(realPos.x / CELL_SIZE);
    const cellY = Math.floor(realPos.y / CELL_SIZE);

    if (cellX >= 0 && cellY >= 0 && cellX < state.gridWidth && cellY < state.gridHeight) {
      state.setHoveredCell({ x: cellX, y: cellY });
    } else {
      state.setHoveredCell(null);
    }
  });

  // Listen to state events
  state.on('hallChanged', () => { drawGrid(); drawStands(); drawSelection(); });
  state.on('standsLoaded', () => { drawStands(); drawSelection(); });
  state.on('standAdded', () => { drawStands(); drawSelection(); });
  state.on('standRemoved', () => { drawStands(); drawSelection(); });
  state.on('selectionChanged', () => { drawSelection(); });
  state.on('hoverChanged', () => { drawHover(); });
  state.on('standSelected', () => { drawStands(); });

  window.addEventListener('resize', () => {
    if (!stage) return;
    const c = document.getElementById(containerId);
    if (c) {
      stage.width(c.clientWidth);
      stage.height(c.clientHeight);
    }
  });
}

export function drawGrid() {
  if (!gridLayer) return;
  gridLayer.destroyChildren();

  const w = state.gridWidth;
  const h = state.gridHeight;
  if (w === 0 || h === 0) return;

  // Background
  gridLayer.add(new Konva.Rect({
    x: 0, y: 0,
    width: w * CELL_SIZE,
    height: h * CELL_SIZE,
    fill: '#f9fafb'
  }));

  // Vertical lines
  for (let x = 0; x <= w; x++) {
    gridLayer.add(new Konva.Line({
      points: [x * CELL_SIZE, 0, x * CELL_SIZE, h * CELL_SIZE],
      stroke: GRID_LINE_COLOR,
      strokeWidth: x % 5 === 0 ? 0.8 : 0.3
    }));
  }

  // Horizontal lines
  for (let y = 0; y <= h; y++) {
    gridLayer.add(new Konva.Line({
      points: [0, y * CELL_SIZE, w * CELL_SIZE, y * CELL_SIZE],
      stroke: GRID_LINE_COLOR,
      strokeWidth: y % 5 === 0 ? 0.8 : 0.3
    }));
  }

  // Cache grid layer for performance (static content)
  gridLayer.cache();
  gridLayer.draw();
}

export function drawStands() {
  if (!standLayer) return;
  standLayer.destroyChildren();

  for (const stand of state.stands) {
    if (!stand.cells || stand.cells.length === 0) continue;

    const isSelected = state.selectedStand && state.selectedStand.id === stand.id;
    const colorInfo = getStandColor(stand);

    // Draw each cell
    for (const cell of stand.cells) {
      standLayer.add(new Konva.Rect({
        x: cell.x * CELL_SIZE + 0.5,
        y: cell.y * CELL_SIZE + 0.5,
        width: CELL_SIZE - 1,
        height: CELL_SIZE - 1,
        fill: colorInfo.fill,
        stroke: isSelected ? '#1d4ed8' : colorInfo.stroke,
        strokeWidth: isSelected ? 2 : 1,
        cornerRadius: 1
      }));
    }

    // Draw label at centroid
    const centroid = getCellCentroid(stand.cells);
    const label = stand.display_label || stand.assigned_company_name || stand.stand_code;
    const sizeLabel = stand.size_m2 ? `${parseFloat(stand.size_m2)}m²` : '';

    if (label) {
      standLayer.add(new Konva.Text({
        x: centroid.x - 50,
        y: centroid.y - 12,
        width: 100,
        text: label,
        fontSize: 10,
        fontFamily: 'Inter, sans-serif',
        fontStyle: 'bold',
        fill: '#1f2937',
        align: 'center',
        listening: false
      }));
    }

    if (sizeLabel) {
      standLayer.add(new Konva.Text({
        x: centroid.x - 50,
        y: centroid.y + (label ? 2 : -6),
        width: 100,
        text: sizeLabel,
        fontSize: 9,
        fontFamily: 'Inter, sans-serif',
        fill: '#6b7280',
        align: 'center',
        listening: false
      }));
    }
  }

  standLayer.draw();
}

export function drawSelection() {
  if (!interactionLayer) return;

  // Remove old selection rects
  for (const r of selectionRects) r.destroy();
  selectionRects = [];

  for (const key of state.selectedCells) {
    const [x, y] = key.split(',').map(Number);
    const rect = new Konva.Rect({
      x: x * CELL_SIZE,
      y: y * CELL_SIZE,
      width: CELL_SIZE,
      height: CELL_SIZE,
      fill: SELECTED_FILL,
      opacity: SELECTED_OPACITY,
      listening: false
    });
    interactionLayer.add(rect);
    selectionRects.push(rect);
  }

  interactionLayer.draw();
}

function drawHover() {
  if (!interactionLayer) return;

  if (hoverRect) {
    hoverRect.destroy();
    hoverRect = null;
  }

  const cell = state.hoveredCell;
  if (!cell) { interactionLayer.draw(); return; }

  if (state.tool === 'draw' || state.tool === 'erase') {
    hoverRect = new Konva.Rect({
      x: cell.x * CELL_SIZE,
      y: cell.y * CELL_SIZE,
      width: CELL_SIZE,
      height: CELL_SIZE,
      fill: HOVER_FILL,
      opacity: HOVER_OPACITY,
      listening: false
    });
    interactionLayer.add(hoverRect);
  }

  interactionLayer.draw();
}

function getStandColor(stand) {
  if (stand.area_kind === 'special') {
    return SPECIAL_TYPE_COLORS[stand.special_area_type] || AREA_KIND_COLORS.special;
  }
  if (stand.area_kind === 'blocked') {
    return AREA_KIND_COLORS.blocked;
  }
  return STATUS_COLORS[stand.commercial_status] || STATUS_COLORS.available;
}

function getCellCentroid(cells) {
  let sumX = 0, sumY = 0;
  for (const c of cells) {
    sumX += c.x * CELL_SIZE + CELL_SIZE / 2;
    sumY += c.y * CELL_SIZE + CELL_SIZE / 2;
  }
  return { x: sumX / cells.length, y: sumY / cells.length };
}

export function fitToView() {
  if (!stage || !state.gridWidth) return;

  const padding = 40;
  const gridPixelW = state.gridWidth * CELL_SIZE;
  const gridPixelH = state.gridHeight * CELL_SIZE;

  const scaleX = (stage.width() - padding * 2) / gridPixelW;
  const scaleY = (stage.height() - padding * 2) / gridPixelH;
  const scale = Math.min(scaleX, scaleY, 2);

  stage.scale({ x: scale, y: scale });
  stage.position({
    x: (stage.width() - gridPixelW * scale) / 2,
    y: (stage.height() - gridPixelH * scale) / 2
  });
  stage.batchDraw();
}
