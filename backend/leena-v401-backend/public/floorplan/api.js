/**
 * Floor Plan Builder — API Module
 * All backend API calls for floorplan operations.
 */

const API_BASE = '/api/floorplan';

function getHeaders() {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
}

async function apiCall(method, path, body = null) {
  const opts = { method, headers: getHeaders() };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${API_BASE}${path}`, opts);
  const data = await res.json();

  if (!res.ok || data.success === false) {
    throw new Error(data.message || `API error ${res.status}`);
  }
  return data;
}

// --- Halls ---

export async function fetchHalls(expoId) {
  const data = await apiCall('GET', `/halls?expo_id=${expoId}`);
  return data.halls;
}

export async function createHall(expoId, name, gridWidth, gridHeight, cellSizeM2 = 1.0) {
  const data = await apiCall('POST', '/halls', {
    expo_id: parseInt(expoId),
    name,
    grid_width: gridWidth,
    grid_height: gridHeight,
    cell_size_m2: cellSizeM2
  });
  return data.hall;
}

export async function updateHall(hallId, fields) {
  const data = await apiCall('PUT', `/halls/${hallId}`, fields);
  return data.hall;
}

// --- Versions ---

export async function fetchVersions(hallId) {
  const data = await apiCall('GET', `/halls/${hallId}/versions`);
  return data.versions;
}

export async function createVersion(hallId, label, notes) {
  const data = await apiCall('POST', `/halls/${hallId}/versions`, {
    version_label: label || undefined,
    notes: notes || undefined
  });
  return data.version;
}

export async function cloneVersion(versionId, clearAssignments = false) {
  const data = await apiCall('POST', `/versions/${versionId}/clone`, { clear_assignments: clearAssignments });
  return data.version;
}

export async function activateVersion(versionId) {
  const data = await apiCall('POST', `/versions/${versionId}/activate`);
  return data.version;
}

// --- Stands ---

export async function fetchStands(versionId) {
  const data = await apiCall('GET', `/versions/${versionId}/stands`);
  return { version: data.version, stands: data.stands };
}

export async function createStand(versionId, standData) {
  const data = await apiCall('POST', `/versions/${versionId}/stands`, standData);
  return data.stand;
}

export async function updateStand(standId, fields) {
  const data = await apiCall('PUT', `/stands/${standId}`, fields);
  return data.stand;
}

export async function updateStandStatus(standId, commercialStatus) {
  const data = await apiCall('PUT', `/stands/${standId}/status`, { commercial_status: commercialStatus });
  return data.stand;
}

export async function mergeStands(standIds, mergedStandCode) {
  const data = await apiCall('POST', '/stands/merge', {
    stand_ids: standIds,
    merged_stand_code: mergedStandCode || undefined
  });
  return data.stand;
}

export async function splitStand(standId, newStands) {
  const data = await apiCall('POST', `/stands/${standId}/split`, { new_stands: newStands });
  return data.stands;
}

export async function deleteStand(standId) {
  return apiCall('DELETE', `/stands/${standId}`);
}
