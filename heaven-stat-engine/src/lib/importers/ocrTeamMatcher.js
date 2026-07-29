import { cleanTeamName, stringSimilarity } from '@/lib/utils/similarity';

/**
 * Matches a raw OCR row ({ rank, slot, teamName, kills }) to a registered team.
 *
 * Matching Stages:
 * 1. Slot Number match (e.g. "TEAM 3", "Slot 4", "04") matching reg.slot
 * 2. Exact / Cleaned Name match (against teamName, clanName, or tag)
 * 3. Fuzzy Similarity match (using Levenshtein string similarity >= threshold)
 *
 * @param {Object} ocrRow - Row object from OCR output or user edit
 * @param {Array} activeTeamRegs - List of registered team objects for the current tournament/group
 * @param {number} similarityThreshold - Minimum threshold for fuzzy matching (default 0.70)
 * @returns {Object} { teamId, teamName, matchMethod, confidence, isAmbiguous }
 */
export function matchOcrRowToTeam(ocrRow, activeTeamRegs = [], similarityThreshold = 0.70) {
  if (!activeTeamRegs || activeTeamRegs.length === 0) {
    return {
      teamId: null,
      teamName: ocrRow?.teamName || ocrRow?.slot || null,
      matchMethod: null,
      confidence: 0,
      isAmbiguous: true,
    };
  }

  const slotInput = String(ocrRow?.slot || '').trim();
  const nameInput = String(ocrRow?.teamName || '').trim();

  // ─── STAGE 1: Match by Numeric Slot ──────────────────────────────────────────
  // Extract number from slot input (e.g., "TEAM 4" -> 4, "Slot 12" -> 12, "03" -> 3)
  const slotMatch = slotInput.match(/\d+/);
  if (slotMatch) {
    const numericSlot = parseInt(slotMatch[0], 10);
    const teamBySlot = activeTeamRegs.find(t => Number(t.slot) === numericSlot);
    if (teamBySlot) {
      return {
        teamId: teamBySlot.teamId,
        teamName: teamBySlot.teamName,
        matchMethod: 'slot',
        confidence: 1.0,
        isAmbiguous: false,
      };
    }
  }

  // Also check if teamName contains a slot digit fallback if slot string was empty
  if (!slotMatch && nameInput) {
    const nameSlotMatch = nameInput.match(/\d+/);
    if (nameSlotMatch) {
      const numericSlot = parseInt(nameSlotMatch[0], 10);
      const teamBySlot = activeTeamRegs.find(t => Number(t.slot) === numericSlot);
      if (teamBySlot) {
        return {
          teamId: teamBySlot.teamId,
          teamName: teamBySlot.teamName,
          matchMethod: 'slot',
          confidence: 0.95,
          isAmbiguous: false,
        };
      }
    }
  }

  // Helper to normalize strings for comparison
  const normalize = (str) => {
    if (!str) return '';
    return cleanTeamName(str)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]/g, '');
  };

  const normSlot = normalize(slotInput);
  const normName = normalize(nameInput);
  const candidateTexts = [normName, normSlot].filter(Boolean);

  // ─── STAGE 2: Exact / Cleaned Name, Clan Name, or Tag Match ─────────────────
  for (const text of candidateTexts) {
    if (!text) continue;
    const exactTeam = activeTeamRegs.find(t => {
      const tName = normalize(t.teamName);
      const cName = normalize(t.clanName);
      const tag = normalize(t.tag);
      return text === tName || (cName && text === cName) || (tag && text === tag);
    });

    if (exactTeam) {
      return {
        teamId: exactTeam.teamId,
        teamName: exactTeam.teamName,
        matchMethod: 'exact',
        confidence: 0.95,
        isAmbiguous: false,
      };
    }
  }

  // ─── STAGE 3: Fuzzy Similarity Match ─────────────────────────────────────────
  let bestMatch = null;
  let bestScore = 0;

  for (const team of activeTeamRegs) {
    const targets = [team.teamName, team.clanName, team.tag].filter(Boolean);

    for (const rawInput of [nameInput, slotInput].filter(Boolean)) {
      const cleanedInput = cleanTeamName(rawInput);
      if (!cleanedInput) continue;

      for (const target of targets) {
        const score = stringSimilarity(cleanedInput, target);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = team;
        }
      }
    }
  }

  if (bestMatch && bestScore >= similarityThreshold) {
    return {
      teamId: bestMatch.teamId,
      teamName: bestMatch.teamName,
      matchMethod: 'fuzzy',
      confidence: Math.round(bestScore * 100) / 100,
      isAmbiguous: bestScore < 0.85,
    };
  }

  // ─── Fallback: Unmatched ──────────────────────────────────────────────────────
  return {
    teamId: null,
    teamName: nameInput || slotInput || null,
    matchMethod: null,
    confidence: 0,
    isAmbiguous: true,
  };
}
