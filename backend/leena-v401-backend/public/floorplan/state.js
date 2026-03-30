/**
 * Floor Plan Builder — State Module
 * Central state management with event emitter pattern.
 */

class FloorPlanState {
  constructor() {
    this._listeners = {};

    // App state
    this.expoId = null;
    this.expoName = '';

    // Hall
    this.halls = [];
    this.currentHall = null;

    // Version
    this.versions = [];
    this.currentVersion = null;

    // Grid info (from version load)
    this.gridWidth = 0;
    this.gridHeight = 0;
    this.cellSizeM2 = 1.0;

    // Stands
    this.stands = [];
    this._cellMap = {};  // "x,y" -> stand (rebuilt on stands change)

    // Selection / interaction
    this.tool = 'select';          // select, draw, erase
    this.selectedCells = new Set(); // Set of "x,y" strings during draw
    this.selectedStand = null;      // Currently selected stand object
    this.hoveredCell = null;        // {x, y} or null

    // Filters
    this.visibilityFilters = {
      available: true,
      hold: true,
      reserved: true,
      pending_contract: true,
      sold: true,
      special: true,
      blocked: true
    };
  }

  // --- Event emitter ---

  on(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
  }

  off(event, fn) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(f => f !== fn);
  }

  emit(event, data) {
    if (!this._listeners[event]) return;
    for (const fn of this._listeners[event]) {
      fn(data);
    }
  }

  // --- State mutations (emit events) ---

  setTool(tool) {
    this.tool = tool;
    this.selectedCells.clear();
    this.selectedStand = null;
    this.emit('toolChanged', tool);
  }

  setHalls(halls) {
    this.halls = halls;
    this.emit('hallsLoaded', halls);
  }

  setCurrentHall(hall) {
    this.currentHall = hall;
    this.currentVersion = null;
    this.stands = [];
    this.selectedCells.clear();
    this.selectedStand = null;
    if (hall) {
      this.gridWidth = hall.grid_width;
      this.gridHeight = hall.grid_height;
      this.cellSizeM2 = parseFloat(hall.cell_size_m2) || 1.0;
    }
    this.emit('hallChanged', hall);
  }

  setVersions(versions) {
    this.versions = versions;
    this.emit('versionsLoaded', versions);
  }

  setCurrentVersion(version) {
    this.currentVersion = version;
    this.stands = [];
    this.selectedCells.clear();
    this.selectedStand = null;
    this.emit('versionChanged', version);
  }

  setStands(stands) {
    this.stands = stands;
    this._rebuildCellMap();
    this.emit('standsLoaded', stands);
  }

  addStand(stand) {
    this.stands.push(stand);
    this._addStandToCellMap(stand);
    this.selectedCells.clear();
    this.emit('standAdded', stand);
  }

  updateStand(updatedStand) {
    const idx = this.stands.findIndex(s => s.id === updatedStand.id);
    if (idx !== -1) {
      this.stands[idx] = updatedStand;
    }
    if (this.selectedStand && this.selectedStand.id === updatedStand.id) {
      this.selectedStand = updatedStand;
    }
    this.emit('standUpdated', updatedStand);
  }

  removeStand(standId) {
    this._removeStandFromCellMap(standId);
    this.stands = this.stands.filter(s => s.id !== standId);
    if (this.selectedStand && this.selectedStand.id === standId) {
      this.selectedStand = null;
    }
    this.emit('standRemoved', standId);
  }

  selectStand(stand) {
    this.selectedStand = stand;
    this.emit('standSelected', stand);
  }

  toggleCell(x, y) {
    const key = `${x},${y}`;
    if (this.selectedCells.has(key)) {
      this.selectedCells.delete(key);
    } else {
      this.selectedCells.add(key);
    }
    this.emit('selectionChanged', this.selectedCells);
  }

  clearSelection() {
    this.selectedCells.clear();
    this.selectedStand = null;
    this.emit('selectionChanged', this.selectedCells);
  }

  setHoveredCell(cell) {
    this.hoveredCell = cell;
    this.emit('hoverChanged', cell);
  }

  // --- Cell map maintenance (O(1) lookup) ---

  _rebuildCellMap() {
    this._cellMap = {};
    for (const stand of this.stands) {
      if (!stand.cells) continue;
      for (const c of stand.cells) {
        this._cellMap[`${c.x},${c.y}`] = stand;
      }
    }
  }

  _addStandToCellMap(stand) {
    if (!stand.cells) return;
    for (const c of stand.cells) {
      this._cellMap[`${c.x},${c.y}`] = stand;
    }
  }

  _removeStandFromCellMap(standId) {
    for (const key in this._cellMap) {
      if (this._cellMap[key].id === standId) {
        delete this._cellMap[key];
      }
    }
  }

  // --- Helpers ---

  /** Get set of occupied cells as "x,y" strings — O(n) from map keys */
  getOccupiedCells() {
    return new Set(Object.keys(this._cellMap));
  }

  /** Find stand that owns a cell — O(1) lookup */
  getStandAtCell(x, y) {
    return this._cellMap[`${x},${y}`] || null;
  }

  /** Check if version is editable */
  isDraft() {
    return this.currentVersion && this.currentVersion.status === 'draft';
  }

  /** Compute stats */
  getStats() {
    const totalCells = this.gridWidth * this.gridHeight;
    let standCells = 0;
    let soldCells = 0;
    let availableCells = 0;
    let reservedCells = 0;
    let specialCells = 0;

    for (const stand of this.stands) {
      const count = stand.cells ? stand.cells.length : 0;
      standCells += count;

      if (stand.area_kind === 'special' || stand.area_kind === 'blocked') {
        specialCells += count;
      } else {
        switch (stand.commercial_status) {
          case 'sold': soldCells += count; break;
          case 'available': availableCells += count; break;
          case 'hold':
          case 'reserved':
          case 'pending_contract':
            reservedCells += count; break;
        }
      }
    }

    const corridorCells = totalCells - standCells;

    return {
      totalArea: totalCells * this.cellSizeM2,
      netArea: standCells * this.cellSizeM2,
      corridorArea: corridorCells * this.cellSizeM2,
      soldArea: soldCells * this.cellSizeM2,
      availableArea: availableCells * this.cellSizeM2,
      reservedArea: reservedCells * this.cellSizeM2,
      specialArea: specialCells * this.cellSizeM2,
      standCount: this.stands.length,
      soldPercent: standCells > 0 ? Math.round((soldCells / (standCells - specialCells)) * 100) || 0 : 0
    };
  }
}

export const state = new FloorPlanState();
