/**
 * Calculates the Levenshtein distance between two strings.
 */
export function levenshteinDistance(a, b) {
  const tmp = [];
  const alen = a.length;
  const blen = b.length;
  if (alen === 0) return blen;
  if (blen === 0) return alen;

  for (let i = 0; i <= alen; i++) tmp[i] = [i];
  for (let j = 0; j <= blen; j++) tmp[0][j] = j;

  for (let i = 1; i <= alen; i++) {
    for (let j = 1; j <= blen; j++) {
      tmp[i][j] = Math.min(
        tmp[i - 1][j] + 1,
        tmp[i][j - 1] + 1,
        tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return tmp[alen][blen];
}

/**
 * Normalizes and calculates string similarity (0.0 to 1.0) between two team names.
 */
export function stringSimilarity(s1, s2) {
  if (!s1 || !s2) return 0;
  
  // Normalize strings: lowercase, remove non-alphanumeric, collapse spaces
  const clean1 = s1.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
  const clean2 = s2.toLowerCase().trim().replace(/[^a-z0-9]/g, '');

  if (clean1 === clean2) return 1.0;
  
  // Containment check booster (e.g. "Main Characters OG" vs "Main Characters")
  if (clean1.length > 3 && clean2.length > 3) {
    if (clean1.includes(clean2) || clean2.includes(clean1)) {
      return 0.85;
    }
  }

  const maxLen = Math.max(clean1.length, clean2.length);
  if (maxLen === 0) return 1.0;

  const dist = levenshteinDistance(clean1, clean2);
  return 1.0 - dist / maxLen;
}

/**
 * Filters a list of global teams to find any that are similar to newTeamName.
 */
export function getSimilarTeams(newTeamName, globalTeams, threshold = 0.75) {
  if (!newTeamName || !newTeamName.trim()) return [];
  const term = newTeamName.trim();
  
  return globalTeams
    .map(team => ({
      team,
      similarity: stringSimilarity(term, team.teamName)
    }))
    .filter(res => res.similarity >= threshold && res.team.teamName.toLowerCase() !== term.toLowerCase())
    .sort((a, b) => b.similarity - a.similarity)
    .map(res => res.team);
}

/**
 * Scans all global teams for potential duplicate pairs.
 */
export function scanForDuplicates(globalTeams, threshold = 0.75) {
  const pairs = [];
  for (let i = 0; i < globalTeams.length; i++) {
    for (let j = i + 1; j < globalTeams.length; j++) {
      const t1 = globalTeams[i];
      const t2 = globalTeams[j];
      const sim = stringSimilarity(t1.teamName, t2.teamName);
      if (sim >= threshold) {
        pairs.push({
          team1: t1,
          team2: t2,
          similarity: sim
        });
      }
    }
  }
  return pairs.sort((a, b) => b.similarity - a.similarity);
}
