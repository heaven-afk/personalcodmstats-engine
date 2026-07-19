/**
 * csvParser.js
 * Parses CSV/Excel data for all 4 import schemas.
 * Uses Papa Parse for CSV, SheetJS for Excel.
 */
import Papa from 'papaparse';

// ─── Generic CSV parse ────────────────────────────────────────────────────────
export function parseCSV(text) {
  // Trim trailing columns that are empty across ALL rows (header + data).
  // We must look at every row — not just the header — so that spreadsheets
  // with merged/grouped headers (e.g. "L1","","","L2","","","L3","","")
  // don't have their Lobby-3 sub-columns mistakenly stripped.
  const lines = text.trim().split('\n');
  if (lines.length > 0) {
    const delimiter = lines[0].includes('\t') ? '\t' : (lines[0].includes(';') ? ';' : ',');
    // Find the maximum column index that has any non-empty value across all rows
    let lastValid = -1;
    for (const line of lines) {
      const cols = line.split(delimiter);
      for (let i = cols.length - 1; i > lastValid; i--) {
        if (cols[i].trim()) {
          lastValid = i;
          break;
        }
      }
    }
    if (lastValid >= 0) {
      // Determine the number of columns from the header to know if trimming is needed
      const headerCols = lines[0].split(delimiter);
      if (lastValid < headerCols.length - 1) {
        text = lines.map(line => {
          const cols = line.split(delimiter);
          return cols.slice(0, lastValid + 1).join(delimiter);
        }).join('\n');
      }
    }
  }

  const result = Papa.parse(text.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => {
      let clean = h.trim().toLowerCase();
      if (clean === '#') return 'slot';
      return clean.replace(/[^a-z0-9]/g, '');
    },
  });
  return { data: result.data, errors: result.errors };
}

// ─── Column normalizers ───────────────────────────────────────────────────────
function num(val) { return parseFloat(val) || 0; }
function int(val) { return parseInt(val) || 0; }
function str(val) { return String(val || '').trim(); }

// ─── Player Registration CSV ──────────────────────────────────────────────────
// Columns: slot, professionalName, ign, teamName, clanName, class, gender, region, country, device, deviceModel
export function parsePlayerRegistrationCSV(text) {
  const { data, errors } = parseCSV(text);
  return {
    rows: data.map((row, i) => {
      let rawDevice = str(row.device || row.platform || row.dev || '');
      let rawModel = str(row.devicemodel || row.model || row.phone || '');

      // Normalize device vs deviceModel if one is provided
      if (rawDevice && !rawModel) {
        const lowerDev = rawDevice.toLowerCase();
        if (!['iphone', 'ipad', 'tablet', 'phone'].includes(lowerDev)) {
          rawModel = rawDevice;
          rawDevice = '';
        }
      }

      return {
        rowIndex: i,
        slot: int(row.slot || row.id || row.no || row.index || i + 1),
        professionalName: str(row.professionalname || row.proname || row.playername || row.name || row.fullname || ''),
        ign: str(row.ign || row.ingamename || row.playerign || row.ingame || row.igningamename || ''),
        teamName: str(row.teamname || row.team || row.clan || ''),
        clanName: str(row.clanname || row.clan || row.originalorg || row.org || ''),
        class: str(row.class || row.playerclass || row.category || row.tier || row.group || 'Class 1'),
        gender: str(row.gender || row.sex || ''),
        region: str(row.region || row.zone || row.reg || ''),
        country: str(row.country || row.nation || row.cntry || ''),
        device: rawDevice,
        deviceModel: rawModel,
      };
    }),
    errors,
  };
}

// ─── Team Registration CSV ────────────────────────────────────────────────────
// Columns: slot, teamName, clanName, tier
export function parseTeamRegistrationCSV(text) {
  const { data, errors } = parseCSV(text);
  return {
    rows: data.map((row, i) => ({
      rowIndex: i,
      slot: int(row.slot || row.id || row.no || row.index || i + 1),
      teamName: str(row.teamname || row.team || row.name || ''),
      clanName: str(row.clanname || row.clan || ''),
      tier: str(row.tier || row.class || row.group || ''),
    })),
    errors,
  };
}

// ─── Team Match Results CSV ───────────────────────────────────────────────────
// Columns: day, lobby, teamName, placement, kills
export function parseTeamMatchCSV(text) {
  const { data, errors } = parseCSV(text);
  return {
    rows: data.map((row, i) => ({
      rowIndex: i,
      day: int(row.day || row.d || row.dayno || row.daynumber || 0),
      lobby: int(row.lobby || row.l || row.lobbynumber || row.lobbynum || row.lobbyno || row.match || row.matchno || row.matchnumber || row.game || row.gameno || row.gamenumber || row.round || row.roundno || row.roundnumber || 0),
      teamName: str(row.teamname || row.team || row.name || ''),
      placement: int(row.placement || row.position || row.place || row.pos || row.rank || row.rnk || 0),
      kills: int(row.kills || row.kill || row.k || 0),
    })),
    errors,
  };
}

// ─── Player Match Results CSV ─────────────────────────────────────────────────
// Columns: day, lobby, playerIGN, teamName, kills, damage, accuracy
export function parsePlayerMatchCSV(text) {
  const { data, errors } = parseCSV(text);
  return {
    rows: data.map((row, i) => ({
      rowIndex: i,
      day: int(row.day || row.d || row.dayno || row.daynumber || 0),
      lobby: int(row.lobby || row.l || row.lobbynumber || row.lobbynum || row.lobbyno || row.match || row.matchno || row.matchnumber || row.game || row.gameno || row.gamenumber || row.round || row.roundno || row.roundnumber || 0),
      playerIGN: str(row.playerign || row.ign || row.player || row.playername || row.name || row.proname || ''),
      teamName: str(row.teamname || row.team || ''),
      kills: int(row.kills || row.kill || row.k || 0),
      damage: num(row.damage || row.dmg || row.damagedealt || 0),
      accuracy: num(row.accuracy || row.acc || row.accuracypct || row.accuracypercent || 0),
    })),
    errors,
  };
}

// ─── Excel import (SheetJS) ───────────────────────────────────────────────────
export async function parseExcelFile(file) {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  return workbook;
}

export async function extractSheetAsCSV(file, sheetName) {
  const XLSX = await import('xlsx');
  const workbook = await parseExcelFile(file);
  const sheet = workbook.Sheets[sheetName] || workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_csv(sheet);
}

export async function getSheetNames(file) {
  const workbook = await parseExcelFile(file);
  return workbook.SheetNames;
}

/**
 * Returns all sheets from an Excel file as { sheetName: csvText } map.
 * For CSV files, returns { 'Sheet1': csvText }.
 */
export async function getAllSheetsAsCSV(file) {
  const isCSV = /\.csv$/i.test(file.name);
  if (isCSV) {
    const text = await file.text();
    return { Sheet1: text };
  }
  const XLSX = await import('xlsx');
  const workbook = await parseExcelFile(file);
  const result = {};
  for (const name of workbook.SheetNames) {
    result[name] = XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
  }
  return result;
}

/**
 * Read file as CSV text — handles both plain CSV and Excel (.xlsx/.xls).
 * For Excel files with multiple sheets, returns the specified sheet (or first sheet).
 */
export async function readSheetAsCSV(file, sheetName = null) {
  const isCSV = /\.csv$/i.test(file.name);
  if (isCSV) return file.text();
  const XLSX = await import('xlsx');
  const workbook = await parseExcelFile(file);
  const name = sheetName && workbook.Sheets[sheetName]
    ? sheetName
    : workbook.SheetNames[0];
  return XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
}

// ─── Excel export ─────────────────────────────────────────────────────────────
export async function exportToExcel(data, filename, sheetName = 'Sheet1') {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

// ─── Smart Grid Parsers ───────────────────────────────────────────────────────
export async function readExcelAsGrid(file, sheetName = null) {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const name = sheetName && workbook.Sheets[sheetName] ? sheetName : workbook.SheetNames[0];
  const sheet = workbook.Sheets[name];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
}

export function parseCSVToGrid(text) {
  const result = Papa.parse(text.trim(), {
    header: false,
    skipEmptyLines: true
  });
  return result.data;
}
