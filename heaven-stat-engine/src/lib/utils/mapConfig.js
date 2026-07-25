import { AVAILABLE_MAPS } from '../constants/maps';

export function getMapForMatch(mapConfig, day, lobby) {
  if (!mapConfig) return null;
  if (mapConfig.mode === 'rigid') return mapConfig.map || null;
  if (mapConfig.mode === 'flexible') return mapConfig.schedule?.[`day${day}_lobby${lobby}`] || null;
  return null;
}

export function getActiveMapConfig(tournament, group) {
  if (group?.mapConfig) return group.mapConfig;
  return tournament?.mapConfig || null;
}

export function filterResultsByMap(results, mapConfig, targetMap) {
  if (!results) return [];
  return results.filter(r => getMapForMatch(mapConfig, r.day, r.lobby) === targetMap);
}

export function countMatchesByMap(results, mapConfig) {
  const counts = {};
  for (const map of AVAILABLE_MAPS) counts[map] = 0;
  if (!results || !mapConfig) return counts;
  for (const r of results) {
    const m = getMapForMatch(mapConfig, r.day, r.lobby);
    if (m && counts[m] !== undefined) counts[m]++;
  }
  return counts;
}
