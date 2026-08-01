import { AVAILABLE_MAPS } from '../constants/maps';

export function getMapForMatch(mapConfig, day, lobby, resultObj = null) {
  // 1. Check direct map properties on match result object if present
  if (resultObj && typeof resultObj === 'object') {
    const explicitMap = resultObj.map || resultObj.mapName || resultObj.map_name;
    if (explicitMap && explicitMap !== '—') return explicitMap;
  }

  // 2. Check mapConfig object configuration
  if (mapConfig && typeof mapConfig === 'object') {
    if (mapConfig.mode === 'rigid') return mapConfig.map || mapConfig.defaultMap || 'Isolated';
    if (mapConfig.mode === 'flexible' && mapConfig.schedule) {
      const scheduledMap = mapConfig.schedule[`day${day}_lobby${lobby}`];
      if (scheduledMap) return scheduledMap;
    }
    if (mapConfig.map) return mapConfig.map;
    if (mapConfig.defaultMap) return mapConfig.defaultMap;
  }

  // 3. Fallback default map for CoDM Battle Royale
  return 'Isolated';
}

export function getActiveMapConfig(tournament, group) {
  if (group?.mapConfig) return group.mapConfig;
  return tournament?.mapConfig || null;
}

export function filterResultsByMap(results, mapConfig, targetMap) {
  if (!results || !Array.isArray(results)) return [];
  return results.filter(r => {
    const m = getMapForMatch(mapConfig, r?.day, r?.lobby, r);
    return m === targetMap;
  });
}

export function countMatchesByMap(results, mapConfig) {
  const counts = {};
  for (const map of AVAILABLE_MAPS) counts[map] = 0;
  if (!results || !Array.isArray(results)) return counts;
  for (const r of results) {
    const m = getMapForMatch(mapConfig, r?.day, r?.lobby, r);
    if (m && counts[m] !== undefined) {
      counts[m]++;
    } else if (m) {
      counts[m] = 1;
    }
  }
  return counts;
}
