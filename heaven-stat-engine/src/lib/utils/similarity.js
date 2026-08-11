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
 * Cleans leading slot numbers, rank prefixes, periods, or symbols from team names.
 * Requires a punctuation separator (. - _ : )) after the number — bare "44 NAME" is left untouched.
 * Example: "6. BOMABA" -> "BOMABA", "4. Legion" -> "Legion", "[04] - Legion" -> "Legion"
 * NOT matched: "44 REGENTS", "44 REAPERS" (number + space only, no punctuation separator)
 */
export function cleanTeamName(name) {
  if (!name || typeof name !== 'string') return name || '';
  return name.trim().replace(/^(?:\[?\d+\]?|#?\d+)[.\-_:)]+\s*/, '').trim();
}

/**
 * Normalizes and calculates string similarity (0.0 to 1.0) between two team names.
 */
export function stringSimilarity(s1, s2) {
  if (!s1 || !s2) return 0;
  
  // Normalize strings: clean team names, lowercase, remove non-alphanumeric
  const clean1 = cleanTeamName(s1).toLowerCase().trim().replace(/[^a-z0-9]/g, '');
  const clean2 = cleanTeamName(s2).toLowerCase().trim().replace(/[^a-z0-9]/g, '');

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
  const term = cleanTeamName(newTeamName.trim());
  
  return globalTeams
    .map(team => ({
      team,
      similarity: stringSimilarity(term, team.teamName)
    }))
    .filter(res => res.similarity >= threshold && cleanTeamName(res.team.teamName).toLowerCase() !== term.toLowerCase())
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

/**
 * Returns all known IGN variants for a player (ign, currentIGN, ignHistory[]).
 * @param {object} player
 * @returns {string[]}
 */
export function getAllPlayerIGNs(player) {
  const ignsSet = new Set();
  if (player.ign?.trim()) ignsSet.add(player.ign.trim().toLowerCase());
  if (player.currentIGN?.trim()) ignsSet.add(player.currentIGN.trim().toLowerCase());
  if (Array.isArray(player.ignHistory)) {
    player.ignHistory.forEach(i => { if (i?.trim()) ignsSet.add(i.trim().toLowerCase()); });
  }
  return [...ignsSet];
}

/**
 * Finds an exact match for a player in the global registry.
 * Checks professional name (case-insensitive) first,
 * then checks ALL known IGNs (ign, currentIGN, ignHistory[]).
 * Returns the matched player or null.
 *
 * @param {string} proName
 * @param {string} ign
 * @param {object[]} globalPlayers
 * @returns {object|null}
 */
export function findExactPlayerMatch(proName, ign, globalPlayers) {
  const proLower = proName?.trim().toLowerCase() || '';
  const ignLower = ign?.trim().toLowerCase() || '';

  if (proLower) {
    const byName = globalPlayers.find(
      p => (p.professionalName || '').trim().toLowerCase() === proLower
    );
    if (byName) return byName;
  }

  if (ignLower) {
    const byIgn = globalPlayers.find(p =>
      getAllPlayerIGNs(p).includes(ignLower)
    );
    if (byIgn) return byIgn;
  }

  return null;
}

/**
 * Filters a list of global players to find any that are similar to newPlayerName or newIGN.
 * Searches ALL known IGN variants (ign, currentIGN, ignHistory[]) for the best IGN score.
 *
 * @param {string} newPlayerName  - Professional name from the CSV row
 * @param {string} newIGN         - IGN from the CSV row
 * @param {object[]} globalPlayers
 * @param {number} threshold      - Minimum similarity score (default 0.70)
 * @returns {{ player: object, similarity: number, matchedOn: 'name'|'ign' }[]}
 */
export function getSimilarPlayers(newPlayerName, newIGN, globalPlayers, threshold = 0.70) {
  const termName = newPlayerName?.trim().toLowerCase() || '';
  const termIGN = newIGN?.trim().toLowerCase() || '';

  const results = globalPlayers.map(player => {
    let bestScore = 0;
    let matchedOn = 'name';

    // Score against professional name
    if (termName && player.professionalName) {
      const nameSim = stringSimilarity(termName, player.professionalName);
      if (nameSim > bestScore) {
        bestScore = nameSim;
        matchedOn = 'name';
      }
    }

    // Score against ALL known IGNs
    if (termIGN) {
      const allIGNs = getAllPlayerIGNs(player);
      for (const knownIgn of allIGNs) {
        const ignSim = stringSimilarity(termIGN, knownIgn);
        if (ignSim > bestScore) {
          bestScore = ignSim;
          matchedOn = 'ign';
        }
      }
    }

    return { player, similarity: bestScore, matchedOn };
  });

  return results
    .filter(r => {
      // Exclude obvious exact self-matches (already caught by findExactPlayerMatch)
      const proLower = (r.player.professionalName || '').trim().toLowerCase();
      const allIgns = getAllPlayerIGNs(r.player);
      const isExactProName = termName && proLower === termName;
      const isExactIgn = termIGN && allIgns.includes(termIGN);
      if (isExactProName || isExactIgn) return false;
      return r.similarity >= threshold;
    })
    .sort((a, b) => b.similarity - a.similarity);
}
