/**
 * Floor Plan Builder — Grid Module
 * Konva.js Stage, Layer management, grid rendering, zoom/pan, cell interaction.
 */

import { state } from './state.js';
import { moveStand } from './api.js';

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
let bgLayer = null;
let gridLayer = null;
let standLayer = null;
let interactionLayer = null;
let bgImage = null;        // Konva.Image for background overlay
let selectionRects = [];
let hoverRect = null;
let isDrawing = false;      // marquee drag active
let drawStartCell = null;   // {x, y} where marquee started
let marqueeRect = null;     // Konva.Rect overlay during drag

// Stand drag-to-move state (supports multi-stand)
let isDraggingStand = false;
let dragStands = [];        // stands being dragged (1 or more)
let dragAllCells = [];      // combined cells of all dragged stands
let dragOwnKeys = new Set();// "x,y" keys of all dragged stands' cells
let dragStartCell = null;   // cell where drag started
let dragDeltaX = 0;
let dragDeltaY = 0;
let dragGhosts = [];
let dragValid = false;

// Pan state (middle mouse or space+drag)
let isPanning = false;
let panLastPos = null;
let spaceHeld = false;

// Select-mode marquee (empty area drag)
let isSelectMarquee = false;
let selectMarqueeStart = null;
let selectMarqueeRect = null;

export function initGrid(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight;

  stage = new Konva.Stage({
    container: containerId,
    width: containerWidth,
    height: containerHeight,
    draggable: false
  });

  // Space key for pan mode
  window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !e.repeat) { spaceHeld = true; e.preventDefault(); } });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceHeld = false; });

  bgLayer = new Konva.Layer();
  gridLayer = new Konva.Layer();
  standLayer = new Konva.Layer();
  interactionLayer = new Konva.Layer();

  stage.add(bgLayer);
  stage.add(gridLayer);
  stage.add(standLayer);
  stage.add(interactionLayer);

  // Wheel handler:
  //   ctrlKey (pinch or Ctrl+wheel) → ZOOM
  //   deltaX !== 0 (trackpad two-finger scroll) → PAN
  //   deltaX === 0, no Ctrl (mouse wheel) → ZOOM
  stage.on('wheel', (e) => {
    e.evt.preventDefault();
    const evt = e.evt;
    const isZoom = evt.ctrlKey || evt.metaKey || (Math.abs(evt.deltaX) === 0 && !evt.shiftKey);

    if (isZoom) {
      applyZoom(evt.deltaY > 0 ? -1 : 1, stage.getPointerPosition());
    } else {
      // PAN (trackpad two-finger or shift+wheel)
      stage.position({
        x: stage.x() - evt.deltaX,
        y: stage.y() - evt.deltaY
      });
    }
    stage.batchDraw();
  });

  // --- Pointer → cell helper ---
  function pointerToCell(pos) {
    if (!pos) return null;
    const transform = stage.getAbsoluteTransform().copy().invert();
    const real = transform.point(pos);
    const cx = Math.floor(real.x / CELL_SIZE);
    const cy = Math.floor(real.y / CELL_SIZE);
    if (cx < 0 || cy < 0 || cx >= state.gridWidth || cy >= state.gridHeight) return null;
    return { x: cx, y: cy };
  }

  // =========================================================
  // MOUSE HANDLERS
  // =========================================================

  let suppressClick = false;

  // --- Mouse down ---
  stage.on('mousedown touchstart', (e) => {
    const pos = stage.getPointerPosition();
    const cell = pointerToCell(pos);
    const isMiddle = e.evt && e.evt.button === 1;

    // PAN: middle mouse or space+left click
    if (isMiddle || spaceHeld) {
      isPanning = true;
      panLastPos = { x: e.evt.clientX, y: e.evt.clientY };
      e.evt.preventDefault();
      return;
    }

    // DRAW MODE: marquee cell selection
    if (state.tool === 'draw' && cell) {
      isDrawing = true;
      drawStartCell = { x: cell.x, y: cell.y };
      if (marqueeRect) { marqueeRect.destroy(); marqueeRect = null; }
      marqueeRect = new Konva.Rect({
        x: cell.x * CELL_SIZE, y: cell.y * CELL_SIZE,
        width: CELL_SIZE, height: CELL_SIZE,
        fill: SELECTED_FILL, opacity: 0.25,
        stroke: '#2563eb', strokeWidth: 1, dash: [4, 3], listening: false
      });
      interactionLayer.add(marqueeRect);
      interactionLayer.draw();
      return;
    }

    // SELECT MODE
    if (state.tool === 'select' && cell) {
      const stand = state.getStandAtCell(cell.x, cell.y);

      if (stand && stand.cells && stand.cells.length > 0 && state.isDraft()) {
        // Start stand drag — use selectedStands if this stand is in multi-select
        isDraggingStand = true;
        dragStartCell = { x: cell.x, y: cell.y };
        dragDeltaX = 0;
        dragDeltaY = 0;
        dragValid = true;

        // Determine which stands to drag
        const isInSelection = state.selectedStands.some(s => s.id === stand.id);
        if (isInSelection && state.selectedStands.length > 1) {
          dragStands = [...state.selectedStands];
        } else {
          dragStands = [stand];
        }

        // Collect all cells and own-keys for collision checks
        dragAllCells = [];
        dragOwnKeys = new Set();
        for (const s of dragStands) {
          for (const c of (s.cells || [])) {
            dragAllCells.push({ x: c.x, y: c.y, standId: s.id });
            dragOwnKeys.add(`${c.x},${c.y}`);
          }
        }
      } else if (!stand && !e.evt?.shiftKey) {
        // Empty area drag → select marquee in select mode
        isSelectMarquee = true;
        selectMarqueeStart = { x: cell.x, y: cell.y };
        if (selectMarqueeRect) { selectMarqueeRect.destroy(); selectMarqueeRect = null; }
        selectMarqueeRect = new Konva.Rect({
          x: cell.x * CELL_SIZE, y: cell.y * CELL_SIZE,
          width: CELL_SIZE, height: CELL_SIZE,
          fill: '#3b82f6', opacity: 0.1,
          stroke: '#3b82f6', strokeWidth: 1, dash: [4, 3], listening: false
        });
        interactionLayer.add(selectMarqueeRect);
        interactionLayer.draw();
      }
      return;
    }
  });

  // --- Mouse move ---
  stage.on('mousemove touchmove', (e) => {
    const pos = stage.getPointerPosition();
    const cell = pointerToCell(pos);

    // Hover
    state.setHoveredCell(cell);

    // Pan
    if (isPanning && panLastPos) {
      const dx = e.evt.clientX - panLastPos.x;
      const dy = e.evt.clientY - panLastPos.y;
      stage.position({ x: stage.x() + dx, y: stage.y() + dy });
      stage.batchDraw();
      panLastPos = { x: e.evt.clientX, y: e.evt.clientY };
      return;
    }

    // Draw marquee
    if (isDrawing && drawStartCell && cell && marqueeRect) {
      const minX = Math.min(drawStartCell.x, cell.x);
      const maxX = Math.max(drawStartCell.x, cell.x);
      const minY = Math.min(drawStartCell.y, cell.y);
      const maxY = Math.max(drawStartCell.y, cell.y);
      marqueeRect.x(minX * CELL_SIZE);
      marqueeRect.y(minY * CELL_SIZE);
      marqueeRect.width((maxX - minX + 1) * CELL_SIZE);
      marqueeRect.height((maxY - minY + 1) * CELL_SIZE);
      interactionLayer.batchDraw();
    }

    // Stand drag ghost
    if (isDraggingStand && dragStands.length > 0 && cell && dragStartCell) {
      const newDX = cell.x - dragStartCell.x;
      const newDY = cell.y - dragStartCell.y;
      if (newDX !== dragDeltaX || newDY !== dragDeltaY) {
        dragDeltaX = newDX;
        dragDeltaY = newDY;
        drawDragGhost();
      }
    }

    // Select marquee
    if (isSelectMarquee && selectMarqueeStart && cell && selectMarqueeRect) {
      const minX = Math.min(selectMarqueeStart.x, cell.x);
      const maxX = Math.max(selectMarqueeStart.x, cell.x);
      const minY = Math.min(selectMarqueeStart.y, cell.y);
      const maxY = Math.max(selectMarqueeStart.y, cell.y);
      selectMarqueeRect.x(minX * CELL_SIZE);
      selectMarqueeRect.y(minY * CELL_SIZE);
      selectMarqueeRect.width((maxX - minX + 1) * CELL_SIZE);
      selectMarqueeRect.height((maxY - minY + 1) * CELL_SIZE);
      interactionLayer.batchDraw();
    }
  });

  // --- Mouse up ---
  stage.on('mouseup touchend', (e) => {
    // End pan
    if (isPanning) {
      isPanning = false;
      panLastPos = null;
      return;
    }

    // End stand drag
    if (isDraggingStand && dragStands.length > 0) {
      const didMove = dragDeltaX !== 0 || dragDeltaY !== 0;
      clearDragGhost();

      if (didMove && dragValid) {
        // Move each stand sequentially
        const promises = dragStands.map(s => {
          const newCells = s.cells.map(c => ({ x: c.x + dragDeltaX, y: c.y + dragDeltaY }));
          return moveStand(s.id, newCells).then(updated => {
            state.updateStand(updated);
          });
        });
        Promise.all(promises).then(() => {
          state._rebuildCellMap();
          drawStands();
        }).catch(err => {
          alert(err.message);
          drawStands();
        });
      }

      if (didMove) suppressClick = true;
      isDraggingStand = false;
      dragStands = [];
      dragAllCells = [];
      dragOwnKeys = new Set();
      dragStartCell = null;
      dragDeltaX = 0;
      dragDeltaY = 0;
      return;
    }

    // End select marquee → select all stands inside the rectangle
    if (isSelectMarquee && selectMarqueeStart) {
      const endCell = pointerToCell(stage.getPointerPosition());
      if (endCell && (endCell.x !== selectMarqueeStart.x || endCell.y !== selectMarqueeStart.y)) {
        const minX = Math.min(selectMarqueeStart.x, endCell.x);
        const maxX = Math.max(selectMarqueeStart.x, endCell.x);
        const minY = Math.min(selectMarqueeStart.y, endCell.y);
        const maxY = Math.max(selectMarqueeStart.y, endCell.y);

        // Find all stands that have at least one cell inside the rectangle
        const selected = [];
        for (const stand of state.stands) {
          if (!stand.cells) continue;
          for (const c of stand.cells) {
            if (c.x >= minX && c.x <= maxX && c.y >= minY && c.y <= maxY) {
              selected.push(stand);
              break;
            }
          }
        }
        if (selected.length > 0) {
          state.selectedStands = selected;
          state.selectedStand = selected[selected.length - 1];
          state.emit('standSelected', state.selectedStand);
        }
        suppressClick = true;
      }

      if (selectMarqueeRect) { selectMarqueeRect.destroy(); selectMarqueeRect = null; }
      interactionLayer.draw();
      isSelectMarquee = false;
      selectMarqueeStart = null;
      return;
    }

    // End draw marquee
    if (!isDrawing || !drawStartCell) return;

    const endCell = pointerToCell(stage.getPointerPosition());
    const occupied = state.getOccupiedCells();

    if (endCell && (endCell.x !== drawStartCell.x || endCell.y !== drawStartCell.y)) {
      const minX = Math.min(drawStartCell.x, endCell.x);
      const maxX = Math.max(drawStartCell.x, endCell.x);
      const minY = Math.min(drawStartCell.y, endCell.y);
      const maxY = Math.max(drawStartCell.y, endCell.y);
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const key = `${x},${y}`;
          if (!occupied.has(key) && !state.selectedCells.has(key)) {
            state.selectedCells.add(key);
          }
        }
      }
      state.emit('selectionChanged', state.selectedCells);
    } else if (drawStartCell) {
      const key = `${drawStartCell.x},${drawStartCell.y}`;
      if (!occupied.has(key)) {
        state.toggleCell(drawStartCell.x, drawStartCell.y);
      }
    }

    if (marqueeRect) { marqueeRect.destroy(); marqueeRect = null; }
    interactionLayer.draw();
    isDrawing = false;
    drawStartCell = null;
  });

  // --- Click: select stand or erase cell (suppressed after drag) ---
  stage.on('click tap', (e) => {
    if (suppressClick) { suppressClick = false; return; }
    if (state.tool === 'draw') return;

    const cell = pointerToCell(stage.getPointerPosition());

    if (state.tool === 'select') {
      if (!cell) { state.clearSelection(); return; }
      const stand = state.getStandAtCell(cell.x, cell.y);
      if (e.evt && e.evt.shiftKey && stand) {
        state.toggleStandSelection(stand);
      } else {
        state.selectStand(stand);
      }
    } else if (state.tool === 'erase') {
      if (!cell) return;
      const key = `${cell.x},${cell.y}`;
      // Erase mode: delete stand at cell, or remove pending selection cell
      const stand = state.getStandAtCell(cell.x, cell.y);
      if (stand && state.isDraft()) {
        if (confirm(`Delete stand ${stand.stand_code} (${stand.size_m2 || 0} m²)?`)) {
          import('./api.js').then(api => {
            api.deleteStand(stand.id).then(() => state.removeStand(stand.id)).catch(err => alert(err.message));
          });
        }
      } else if (state.selectedCells.has(key)) {
        state.toggleCell(cell.x, cell.y);
      }
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
  state.on('standUpdated', () => { drawStands(); });

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

  // Background — semi-transparent so bgLayer image shows through
  gridLayer.add(new Konva.Rect({
    x: 0, y: 0,
    width: w * CELL_SIZE,
    height: h * CELL_SIZE,
    fill: '#f9fafb',
    opacity: bgImage ? 0.15 : 1
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

  // Ruler labels (every 5 cells)
  for (let x = 0; x <= w; x += 5) {
    gridLayer.add(new Konva.Text({
      x: x * CELL_SIZE - 1,
      y: -14,
      text: `${x}`,
      fontSize: 9,
      fontFamily: 'Inter, sans-serif',
      fill: '#9ca3af',
      listening: false
    }));
  }
  for (let y = 0; y <= h; y += 5) {
    gridLayer.add(new Konva.Text({
      x: -20,
      y: y * CELL_SIZE - 5,
      text: `${y}`,
      fontSize: 9,
      fontFamily: 'Inter, sans-serif',
      fill: '#9ca3af',
      align: 'right',
      width: 16,
      listening: false
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
    const isMultiSelected = state.selectedStands.some(s => s.id === stand.id);
    const colorInfo = getStandColor(stand);

    // Build a Set of this stand's cells for boundary detection
    const cellSet = new Set();
    for (const c of stand.cells) cellSet.add(`${c.x},${c.y}`);

    // Draw each cell as a filled rect with NO stroke (clean interior)
    for (const cell of stand.cells) {
      standLayer.add(new Konva.Rect({
        x: cell.x * CELL_SIZE,
        y: cell.y * CELL_SIZE,
        width: CELL_SIZE,
        height: CELL_SIZE,
        fill: colorInfo.fill,
        stroke: null,
        listening: false
      }));
    }

    // Selection glow: draw a blurred shadow rect behind selected stands
    if (isSelected || isMultiSelected) {
      const bbox = getCellBBox(stand.cells);
      standLayer.add(new Konva.Rect({
        x: bbox.px - 2, y: bbox.py - 2,
        width: bbox.pw + 4, height: bbox.ph + 4,
        fill: 'transparent',
        stroke: '#3b82f6',
        strokeWidth: 4,
        opacity: 0.3,
        cornerRadius: 3,
        listening: false
      }));
    }

    // Draw outer boundary: for each cell, draw edges that face non-stand cells
    const boundaryStroke = (isSelected || isMultiSelected) ? '#1d4ed8' : colorInfo.stroke;
    const boundaryWidth = (isSelected || isMultiSelected) ? 2.5 : 1.5;
    const boundaryLines = [];

    for (const cell of stand.cells) {
      const px = cell.x * CELL_SIZE;
      const py = cell.y * CELL_SIZE;

      // Top edge: no neighbor above
      if (!cellSet.has(`${cell.x},${cell.y - 1}`)) {
        boundaryLines.push([px, py, px + CELL_SIZE, py]);
      }
      // Bottom edge: no neighbor below
      if (!cellSet.has(`${cell.x},${cell.y + 1}`)) {
        boundaryLines.push([px, py + CELL_SIZE, px + CELL_SIZE, py + CELL_SIZE]);
      }
      // Left edge: no neighbor left
      if (!cellSet.has(`${cell.x - 1},${cell.y}`)) {
        boundaryLines.push([px, py, px, py + CELL_SIZE]);
      }
      // Right edge: no neighbor right
      if (!cellSet.has(`${cell.x + 1},${cell.y}`)) {
        boundaryLines.push([px + CELL_SIZE, py, px + CELL_SIZE, py + CELL_SIZE]);
      }
    }

    for (const pts of boundaryLines) {
      standLayer.add(new Konva.Line({
        points: pts,
        stroke: boundaryStroke,
        strokeWidth: boundaryWidth,
        lineCap: 'round',
        listening: false
      }));
    }

    // --- Labels: bounding box based ---
    const bbox = getCellBBox(stand.cells);
    const cellCount = stand.cells.length;
    const companyName = stand.display_label || stand.assigned_company_name || '';
    const sizeLabel = stand.size_m2 ? `${parseFloat(stand.size_m2)}m²` : '';

    if (cellCount <= 2) {
      // Tiny stands: only stand_code, centered
      standLayer.add(new Konva.Text({
        x: bbox.px,
        y: bbox.py,
        width: bbox.pw,
        height: bbox.ph,
        text: stand.stand_code,
        fontSize: 9,
        fontFamily: 'Inter, sans-serif',
        fontStyle: 'bold',
        fill: '#6b7280',
        align: 'center',
        verticalAlign: 'middle',
        listening: false
      }));
    } else {
      // Company name — center
      if (companyName) {
        const centroid = getCellCentroid(stand.cells);
        standLayer.add(new Konva.Text({
          x: bbox.px + 2,
          y: centroid.y - 7,
          width: bbox.pw - 4,
          text: companyName,
          fontSize: 11,
          fontFamily: 'Inter, sans-serif',
          fontStyle: 'bold',
          fill: '#1f2937',
          align: 'center',
          listening: false
        }));
      }

      // Stand code — bottom left (inside boundary)
      standLayer.add(new Konva.Text({
        x: bbox.px + 5,
        y: bbox.py + bbox.ph - 16,
        text: stand.stand_code,
        fontSize: 9,
        fontFamily: 'Inter, sans-serif',
        fill: '#9ca3af',
        listening: false
      }));

      // Size m² — bottom right (inside boundary, right-aligned via width)
      if (sizeLabel) {
        standLayer.add(new Konva.Text({
          x: bbox.px + 5,
          y: bbox.py + bbox.ph - 16,
          width: bbox.pw - 10,
          text: sizeLabel,
          fontSize: 10,
          fontFamily: 'Inter, sans-serif',
          fill: '#9ca3af',
          align: 'right',
          listening: false
        }));
      }
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

// --- Drag ghost rendering ---

function drawDragGhost() {
  clearDragGhost();
  if (dragAllCells.length === 0 || !interactionLayer) return;

  const occupied = state.getOccupiedCells();

  // First pass: check all validity
  dragValid = true;
  for (const c of dragAllCells) {
    const nx = c.x + dragDeltaX;
    const ny = c.y + dragDeltaY;
    if (nx < 0 || ny < 0 || nx >= state.gridWidth || ny >= state.gridHeight) {
      dragValid = false; break;
    }
    const key = `${nx},${ny}`;
    if (occupied.has(key) && !dragOwnKeys.has(key)) {
      dragValid = false; break;
    }
  }

  // Second pass: draw ghosts
  const fill = dragValid ? '#bbf7d0' : '#fecaca';
  const stroke = dragValid ? '#16a34a' : '#dc2626';
  for (const c of dragAllCells) {
    const ghost = new Konva.Rect({
      x: (c.x + dragDeltaX) * CELL_SIZE,
      y: (c.y + dragDeltaY) * CELL_SIZE,
      width: CELL_SIZE, height: CELL_SIZE,
      fill, opacity: 0.5, stroke, strokeWidth: 1, listening: false
    });
    interactionLayer.add(ghost);
    dragGhosts.push(ghost);
  }

  interactionLayer.batchDraw();
}

function clearDragGhost() {
  for (const g of dragGhosts) g.destroy();
  dragGhosts = [];
}

function getStandColor(stand) {
  // Custom color from metadata takes priority (for area_kind='stand' only)
  const meta = stand.metadata || {};
  const parsed = typeof meta === 'string' ? JSON.parse(meta || '{}') : meta;
  if (parsed.color && stand.area_kind === 'stand') {
    return { fill: parsed.color, stroke: darkenColor(parsed.color) };
  }

  if (stand.area_kind === 'special') {
    return SPECIAL_TYPE_COLORS[stand.special_area_type] || AREA_KIND_COLORS.special;
  }
  if (stand.area_kind === 'blocked') {
    return AREA_KIND_COLORS.blocked;
  }
  return STATUS_COLORS[stand.commercial_status] || STATUS_COLORS.available;
}

/** Darken a hex color by ~20% for stroke */
function darkenColor(hex) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, ((num >> 16) & 0xFF) - 40);
  const g = Math.max(0, ((num >> 8) & 0xFF) - 40);
  const b = Math.max(0, (num & 0xFF) - 40);
  return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`;
}

function getCellCentroid(cells) {
  let sumX = 0, sumY = 0;
  for (const c of cells) {
    sumX += c.x * CELL_SIZE + CELL_SIZE / 2;
    sumY += c.y * CELL_SIZE + CELL_SIZE / 2;
  }
  return { x: sumX / cells.length, y: sumY / cells.length };
}

/** Bounding box in pixels for a stand's cells */
function getCellBBox(cells) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of cells) {
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.x > maxX) maxX = c.x;
    if (c.y > maxY) maxY = c.y;
  }
  return {
    px: minX * CELL_SIZE,
    py: minY * CELL_SIZE,
    pw: (maxX - minX + 1) * CELL_SIZE,
    ph: (maxY - minY + 1) * CELL_SIZE
  };
}

export function exportPNG() {
  if (!stage || !state.gridWidth) return;

  // Temporarily reset transform to capture full grid at 2x
  const oldScale = stage.scaleX();
  const oldPos = stage.position();

  stage.scale({ x: 1, y: 1 });
  stage.position({ x: 0, y: 0 });

  // Hide interaction layer (selection rects, hover)
  if (interactionLayer) interactionLayer.visible(false);

  const gridW = state.gridWidth * CELL_SIZE;
  const gridH = state.gridHeight * CELL_SIZE;

  const dataUrl = stage.toDataURL({
    x: 0, y: 0,
    width: gridW,
    height: gridH,
    pixelRatio: 2
  });

  // Restore
  if (interactionLayer) interactionLayer.visible(true);
  stage.scale({ x: oldScale, y: oldScale });
  stage.position(oldPos);
  stage.batchDraw();

  // Download
  const hallName = (state.currentHall?.name || 'hall').replace(/\s+/g, '-');
  const vNum = state.currentVersion?.version_number || 0;
  const link = document.createElement('a');
  link.download = `floorplan-${hallName}-v${vNum}.png`;
  link.href = dataUrl;
  link.click();
}

function applyZoom(direction, pointer) {
  if (!stage) return;
  if (!pointer) pointer = { x: stage.width() / 2, y: stage.height() / 2 };
  const oldScale = stage.scaleX();
  const scaleBy = 1.2;
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
  stage.batchDraw();
}

export function zoomIn() { applyZoom(1); }
export function zoomOut() { applyZoom(-1); }

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

// ============================================================
// BACKGROUND IMAGE
// ============================================================

let bgTransformer = null;
let bgLocked = true; // locked by default — unlock to reposition

export function setBackgroundImage(dataUrl) {
  removeBackgroundImage();
  if (!dataUrl || !bgLayer) return;

  const img = new Image();
  img.onload = () => {
    const gridW = state.gridWidth * CELL_SIZE;
    const gridH = state.gridHeight * CELL_SIZE;
    console.log(`[floorplan] Background loaded, image: ${img.naturalWidth}x${img.naturalHeight}, grid: ${gridW}x${gridH}`);

    // Scale to fit grid (aspect ratio preserved)
    const imgRatio = img.naturalWidth / img.naturalHeight;
    const gridRatio = gridW / gridH;
    let w, h;
    if (imgRatio > gridRatio) { w = gridW; h = gridW / imgRatio; }
    else { h = gridH; w = gridH * imgRatio; }

    bgImage = new Konva.Image({
      image: img,
      x: 0, y: 0,
      width: w, height: h,
      opacity: 0.3,
      draggable: false, // locked by default
      name: 'backgroundImage'
    });
    bgLayer.add(bgImage);

    // Transformer for resize (hidden when locked)
    bgTransformer = new Konva.Transformer({
      nodes: [bgImage],
      keepRatio: true,
      enabledAnchors: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
      rotateEnabled: false,
      visible: false,
      name: 'bgTransformer'
    });
    bgLayer.add(bgTransformer);
    bgLayer.draw();

    bgLocked = true;
    drawGrid();

    // Save to localStorage
    const key = `fp_bg_${state.expoId}_${state.currentHall?.id}`;
    try { localStorage.setItem(key, dataUrl); } catch (e) { /* quota */ }
  };
  img.src = dataUrl;
}

export function removeBackgroundImage() {
  if (bgTransformer) { bgTransformer.destroy(); bgTransformer = null; }
  if (bgImage) { bgImage.destroy(); bgImage = null; }
  if (bgLayer) { bgLayer.destroyChildren(); bgLayer.draw(); }
  drawGrid();
  const key = `fp_bg_${state.expoId}_${state.currentHall?.id}`;
  localStorage.removeItem(key);
}

export function setBackgroundOpacity(opacity) {
  if (bgImage) { bgImage.opacity(opacity); bgLayer.draw(); }
}

export function toggleBgLock() {
  if (!bgImage) return;
  bgLocked = !bgLocked;
  bgImage.draggable(!bgLocked);
  if (bgTransformer) bgTransformer.visible(!bgLocked);
  bgLayer.draw();
  return bgLocked;
}

export function isBgLocked() { return bgLocked; }

export function fitBgToGrid() {
  if (!bgImage || !bgImage.image()) return;
  const gridW = state.gridWidth * CELL_SIZE;
  const gridH = state.gridHeight * CELL_SIZE;
  const imgRatio = bgImage.image().naturalWidth / bgImage.image().naturalHeight;
  const gridRatio = gridW / gridH;
  let w, h;
  if (imgRatio > gridRatio) { w = gridW; h = gridW / imgRatio; }
  else { h = gridH; w = gridH * imgRatio; }
  bgImage.position({ x: 0, y: 0 });
  bgImage.size({ width: w, height: h });
  bgImage.scaleX(1); bgImage.scaleY(1);
  if (bgTransformer) bgTransformer.forceUpdate();
  bgLayer.draw();
}

export function loadSavedBackground() {
  if (!state.currentHall) return;
  const key = `fp_bg_${state.expoId}_${state.currentHall.id}`;
  const saved = localStorage.getItem(key);
  if (saved) setBackgroundImage(saved);
}
