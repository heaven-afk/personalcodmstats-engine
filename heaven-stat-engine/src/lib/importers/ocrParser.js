import Tesseract from 'tesseract.js';

/**
 * Runs OCR on an uploaded image file and returns raw extracted text.
 * Used by both team-entry and player-entry OCR flows.
 */
export async function extractTextFromImage(file, onProgress) {
  const result = await Tesseract.recognize(file, 'eng', {
    logger: (m) => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(Math.round(m.progress * 100));
      }
    },
  });
  return result.data.text;
}

/**
 * Parses team match results from OCR raw text.
 * Expects lines with at least 3 numbers: Rank, Slot, Kills.
 */
export function parseTeamOCRResult(rawText, teamRegs) {
  const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const results = [];
  const errors = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Extract all numbers found on this line — OCR output for a scoreboard row
    // is expected to contain exactly 3 numeric values: Rank, Team Slot, Total Kills,
    // in that order, possibly separated by inconsistent whitespace/OCR noise.
    const numbers = line.match(/\d+/g);

    if (!numbers || numbers.length < 3) {
      // Skip lines that don't look like a scoreboard row (headers, noise, etc.)
      // rather than erroring — OCR output often includes stray non-data lines.
      continue;
    }

    const [rankStr, slotStr, killsStr] = numbers;
    const rank = parseInt(rankStr);
    const slot = parseInt(slotStr);
    const kills = parseInt(killsStr);

    const team = teamRegs.find(t => t.slot === slot);

    results.push({
      teamId: team?.teamId || null,
      teamName: team?.teamName || null,
      slot,
      placement: rank,
      kills,
      sourceLine: line,
    });

    if (!team) {
      errors.push(`Line ${i + 1}: No registered team found at Slot ${slot} (read from: "${line}").`);
    }
  }

  return { results, errors };
}

/**
 * Parses player match results from OCR raw text.
 * Expects lines of format: [Player Name/IGN] [Kills]
 */
export function parsePlayerOCRResult(rawText, playerRegs) {
  const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const results = [];
  const errors = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Expect a name (IGN) followed by a kills number on the same line.
    // Pull the trailing number off the line as kills; treat the remainder as the name.
    const match = line.match(/^(.+?)\s+(\d+)\s*$/);
    if (!match) continue; // skip non-data lines (headers, noise)

    const [, namePart, killsStr] = match;
    const kills = parseInt(killsStr);
    const nameInput = namePart.trim();
    const normalized = nameInput.toLowerCase().replace(/\s+/g, '');

    // Primary match: IGN
    let player = playerRegs.find(p => p.ign?.toLowerCase().replace(/\s+/g, '') === normalized);
    let matchType = 'ign';

    // Fallback match: Professional Name, only attempted if IGN match failed
    if (!player) {
      player = playerRegs.find(p => p.professionalName?.toLowerCase().replace(/\s+/g, '') === normalized);
      matchType = 'proName';
    }

    results.push({
      playerId: player?.playerId || null,
      playerName: player?.professionalName || player?.ign || nameInput,
      ign: player?.ign || nameInput,
      teamName: player?.teamName || '',
      matchType: player ? matchType : null,
      kills,
      sourceLine: line,
      originalParsedName: nameInput,
    });

    if (!player) {
      errors.push(`Line ${i + 1}: "${nameInput}" did not match any registered IGN or Professional Name.`);
    }
  }

  return { results, errors };
}
