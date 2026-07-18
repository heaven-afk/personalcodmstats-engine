import { NextResponse } from 'next/server';

const TEAM_SYSTEM_PROMPT = `You are a CODM (Call of Duty Mobile) Battle Royale scoreboard parser.

You will receive one screenshot of a match results screen. Your ONLY job is to extract 
structured player/team data from the visible scoreboard table. Ignore all UI chrome, 
watermarks, logos, background art, HUD elements, and decorative text that is not part 
of the results table.

For each visible row in the results table extract:
- rank: placement number (integer)
- kills: kill count shown for that row (integer, use 0 if blank or not visible). Be very careful to look specifically for the team kills count column (typically a single or double-digit integer). DO NOT confuse it with the Match Score (typically a 4-digit number like 1500, 2400) or other metrics.
- slot: the team name/label or squad slot shown in the row next to the rank (string, e.g. "TEAM1", "TEAM 3", etc., or null if not present)

Rules:
- Return ONLY valid JSON, no explanation, no markdown, no preamble
- If a field is unreadable or genuinely ambiguous, return null for that field only — do not guess
- rank values should be sequential integers starting at 1
- If the image is not a CODM scoreboard return: { "error": "not a scoreboard" }
- Deduplicate by team: If a team slot appears more than once in the scoreboard (due to overlaps or duplicates), pick exactly ONE row (the one with the correct/highest kills or most complete data) and discard the other duplicate row(s). Do NOT drop both rows; you MUST include exactly one row for that team slot.
- Ensure the kills count matches the correct team row. Do not repeat or shift numbers between rows.

Response schema:
{
  "lobby": <lobby_number passed in via the user message>,
  "rows": [
    { "rank": 1, "kills": 5, "slot": "TEAM1" },
    { "rank": 2, "kills": 3, "slot": "TEAM3" }
  ]
}`;

const PLAYER_SYSTEM_PROMPT = `You are a CODM (Call of Duty Mobile) Battle Royale scoreboard parser.

You will receive one screenshot of a match results screen. Your ONLY job is to extract 
structured player data from the visible scoreboard table. Ignore all UI chrome, 
watermarks, logos, background art, HUD elements, and decorative text that is not part 
of the results table.

For each visible row in the results table extract:
- name: player name or IGN (string)
- kills: kill count shown for that row (integer, use 0 if blank or not visible). Be very careful to look specifically for the kills count column (typically a single or double-digit integer, e.g., 0 to 30). DO NOT confuse it with the Match Score (typically a 4-digit number like 1500, 2400) or Damage Dealt (typically a 3 or 4-digit number). The kills count is a separate column. If both are present, extract the actual kills count, not the match score.

Rules:
- Return ONLY valid JSON, no explanation, no markdown, no preamble
- If a field is unreadable or genuinely ambiguous, return null for that field only — do not guess
- If the image is not a CODM scoreboard return: { "error": "not a scoreboard" }
- Deduplicate by player name: If a player appears more than once in the scoreboard (due to overlaps or duplicates), pick exactly ONE row (the one with more complete data or higher kills) and discard the other duplicate row(s). Do NOT drop both rows; you MUST include exactly one row for that player.
- Ensure the kills count matches the correct player row. Do not repeat or shift numbers between rows. Do not confuse the Match Score or Damage with Kills.

Response schema:
{
  "lobby": <lobby_number passed in via the user message>,
  "rows": [
    { "name": "PlayerOne", "kills": 5 },
    { "name": "PlayerTwo", "kills": 3 }
  ]
}`;

// Helper to call Google Gemini Vision API
async function callGeminiVisionAPI(apiKey, systemPrompt, userText, base64Image) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [
          { text: systemPrompt }
        ]
      },
      contents: [
        {
          parts: [
            { text: userText },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: base64Image
              }
            }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API returned ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const rawJsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawJsonText) {
    throw new Error('Gemini Vision API returned an empty message content');
  }

  return JSON.parse(rawJsonText);
}

// Helper to retry with conversation history
async function callGeminiVisionAPIWithHistory(apiKey, systemPrompt, userText, base64Image, firstAssistantMsg, followUpText) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [
          { text: systemPrompt }
        ]
      },
      contents: [
        {
          role: "user",
          parts: [
            { text: userText },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: base64Image
              }
            }
          ]
        },
        {
          role: "model",
          parts: [
            { text: firstAssistantMsg }
          ]
        },
        {
          role: "user",
          parts: [
            { text: followUpText }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API retry returned ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const rawJsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawJsonText) {
    throw new Error('Gemini Vision API retry returned an empty message content');
  }

  return JSON.parse(rawJsonText);
}

// Check if ranks have duplicates or are not sequential (allowing starting at any number)
function isRankAnomaly(rows) {
  if (!rows || rows.length <= 1) return false;
  const ranks = rows
    .map(r => parseInt(r.rank))
    .filter(r => !isNaN(r))
    .sort((a, b) => a - b);

  if (ranks.length <= 1) return false;

  // Check for duplicates
  const hasDuplicates = new Set(ranks).size !== ranks.length;
  if (hasDuplicates) return true;

  // Check for sequential ordering (allowing starting at any positive integer)
  for (let i = 0; i < ranks.length - 1; i++) {
    if (ranks[i + 1] !== ranks[i] + 1) {
      return true;
    }
  }
  return false;
}

export async function POST(req) {
  try {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'gemini_failed', message: 'No API key configured for Google Gemini on the server. Please set GEMINI_API_KEY or GOOGLE_API_KEY.' }, { status: 500 });
    }

    const formData = await req.formData();
    const file = formData.get('image');
    const lobbyNumberInput = formData.get('lobbyNumber');
    const type = formData.get('type') || 'team'; // 'team' | 'player'

    if (!file) {
      return NextResponse.json({ error: 'missing_file', message: 'No screenshot file uploaded.' }, { status: 400 });
    }

    const lobbyNumber = parseInt(lobbyNumberInput) || 1;

    // Check size limit: 20MB
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: 'file_too_large', message: 'File exceeds 20MB limit.' }, { status: 400 });
    }

    // Convert file to base64
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Image = buffer.toString('base64');

    const systemPrompt = type === 'player' ? PLAYER_SYSTEM_PROMPT : TEAM_SYSTEM_PROMPT;
    const userText = `This is Lobby ${lobbyNumber}. Extract the scoreboard data.`;

    let extractedData;
    try {
      extractedData = await callGeminiVisionAPI(apiKey, systemPrompt, userText, base64Image);
    } catch (err) {
      return NextResponse.json({ error: 'gemini_failed', message: err.message }, { status: 500 });
    }

    if (extractedData.error) {
      return NextResponse.json({ error: 'parse_failed', message: extractedData.error }, { status: 422 });
    }

    let rows = extractedData.rows || [];
    let totalRows = rows.length;
    let nullKills = rows.filter(r => r.kills === null || r.kills === undefined).length;
    let isLowConfidence = totalRows > 0 && (nullKills / totalRows) > 0.3;

    let retried = false;
    // Auto-Retry once if low confidence
    if (isLowConfidence) {
      try {
        const followUpText = "The kills column appears to be a number on the right side of each row. Please re-extract focusing on that column.";
        extractedData = await callGeminiVisionAPIWithHistory(
          apiKey,
          systemPrompt,
          userText,
          base64Image,
          JSON.stringify(extractedData),
          followUpText
        );
        rows = extractedData.rows || [];
        totalRows = rows.length;
        nullKills = rows.filter(r => r.kills === null || r.kills === undefined).length;
        isLowConfidence = totalRows > 0 && (nullKills / totalRows) > 0.3;
        retried = true;
      } catch (err) {
        console.error("Auto-retry Vision extraction failed:", err);
      }
    }

    // Validation Warnings
    const warnings = [];
    if (isLowConfidence) {
      warnings.push('low_confidence');
    }
    if (type === 'team' && isRankAnomaly(rows)) {
      warnings.push('rank_anomaly');
    }

    const responsePayload = {
      lobby: lobbyNumber,
      rows,
      warnings,
      retried
    };

    return NextResponse.json(responsePayload);

  } catch (err) {
    console.error('OCR route error:', err);
    return NextResponse.json({ error: 'server_error', message: err.message }, { status: 500 });
  }
}

