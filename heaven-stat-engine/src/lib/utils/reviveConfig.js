import { REVIVE_TYPES, getReviveType } from '../constants/revives';

export function getReviveTypeForMatch(reviveConfig, day, lobby, resultObj = null) {
  // 1. Check direct reviveType property on match result object if present
  if (resultObj && typeof resultObj === 'object') {
    const explicit = resultObj.reviveType || resultObj.revive_type;
    if (explicit && explicit !== '—') return explicit;
  }

  // 2. Check reviveConfig object configuration
  if (reviveConfig && typeof reviveConfig === 'object') {
    if (reviveConfig.mode === 'rigid') return reviveConfig.reviveType || 'auto';
    if (reviveConfig.schedule) {
      const scheduled = reviveConfig.schedule[`day${day}_lobby${lobby}`];
      if (scheduled) return scheduled;
    }
    if (reviveConfig.reviveType) return reviveConfig.reviveType;
  }

  // 3. Fallback default revive type
  return 'auto';
}

export function getActiveReviveConfig(tournament, group) {
  if (group?.reviveConfig) return group.reviveConfig;
  return tournament?.reviveConfig || null;
}

export function filterResultsByRevive(results, reviveConfig, targetRevive) {
  if (!results || !Array.isArray(results)) return [];
  return results.filter(r => {
    const rev = getReviveTypeForMatch(reviveConfig, r?.day, r?.lobby, r);
    return rev === targetRevive;
  });
}

export function countMatchesByRevive(results, reviveConfig) {
  const counts = { auto: 0, dogtag: 0, none: 0 };
  if (!results || !Array.isArray(results)) return counts;
  for (const r of results) {
    const rev = getReviveTypeForMatch(reviveConfig, r?.day, r?.lobby, r);
    if (counts[rev] !== undefined) {
      counts[rev]++;
    } else {
      counts[rev] = 1;
    }
  }
  return counts;
}
