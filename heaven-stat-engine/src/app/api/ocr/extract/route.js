import { NextResponse } from 'next/server';

const TEAM_SYSTEM_PROMPT = `You are a CODM (Call of Duty Mobile) Battle Royale scoreboard parser.

You will receive one screenshot of a match results screen. Your ONLY job is to extract 
structured player/team data from the visible scoreboard table. Ignore all UI chrome, 
watermarks, logos, background art, HUD elements, and decorative text that is not part 
of the results table.

For each visible row in the results table extract:
- rank: placement number (integer)
- kills: kill count shown for that row (integer, use 0 if blank or not visible)
- slot: squad slot label if visible (string, or null if not present)

Rules:
- Return ONLY valid JSON, no explanation, no markdown, no preamble
- If a field is unreadable or genuinely ambiguous, return null for that field only — do not guess
- rank values should be sequential integers starting at 1
- If the image is not a CODM scoreboard return: { "error": "not a scoreboard" }

Response schema:
{
  "lobby": <lobby_number passed in via the user message>,
  "rows": [
    { "rank": 1, "kills": 5, "slot": "A" },
    { "rank": 2, "kills": 3, "slot": null }
  ]
}`;

const PLAYER_SYSTEM_PROMPT = `You are a CODM (Call of Duty Mobile) Battle Royale scoreboard parser.

You will receive one screenshot of a match results screen. Your ONLY job is to extract 
structured player data from the visible scoreboard table. Ignore all UI chrome, 
watermarks, logos, background art, HUD elements, and decorative text that is not part 
of the results table.

For each visible row in the results table extract:
- name: player name or IGN (string)
- kills: kill count shown for that row (integer, use 0 if blank or not visible)

Rules:
- Return ONLY valid JSON, no explanation, no markdown, no preamble
- If a field is unreadable or genuinely ambiguous, return null for that field only — do not guess
- If the image is not a CODM scoreboard return: { "error": "not a scoreboard" }

Response schema:
{
  "lobby": <lobby_number passed in via the user message>,
  "rows": [
    { "name": "PlayerOne", "kills": 5 },
    { "name": "PlayerTwo", "kills": 3 }
  ]
}`;

// Helper to call Groq Vision API
async function callGroqVisionAPI(apiKey, systemPrompt, userText, base64Image) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      temperature: 0,
      response_format: { type: 'json_object' },
      max_tokens: 1000,
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: userText
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`
              }
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API returned ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const rawJsonText = data.choices?.[0]?.message?.content;
  if (!rawJsonText) {
    throw new Error('Groq Vision API returned an empty message content');
  }

  return JSON.parse(rawJsonText);
}

// Helper to retry with conversation history
async function callGroqVisionAPIWithHistory(apiKey, systemPrompt, userText, base64Image, firstAssistantMsg, followUpText) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      temperature: 0,
      response_format: { type: 'json_object' },
      max_tokens: 1000,
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: userText
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`
              }
            }
          ]
        },
        {
          role: 'assistant',
          content: firstAssistantMsg
        },
        {
          role: 'user',
          content: followUpText
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API retry returned ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const rawJsonText = data.choices?.[0]?.message?.content;
  if (!rawJsonText) {
    throw new Error('Groq Vision API retry returned an empty message content');
  }

  return JSON.parse(rawJsonText);
}

// Check if ranks are sequential from 1
function isRankAnomaly(rows) {
  if (!rows || rows.length === 0) return true;
  const ranks = rows
    .map(r => parseInt(r.rank))
    .filter(r => !isNaN(r))
    .sort((a, b) => a - b);

  if (ranks.length === 0) return true;
  if (ranks[0] !== 1) return true;

  for (let i = 0; i < ranks.length - 1; i++) {
    if (ranks[i + 1] !== ranks[i] + 1) {
      return true;
    }
  }
  return false;
}

export async function POST(req) {
  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'groq_failed', message: 'GROQ_API_KEY is not configured on the server.' }, { status: 500 });
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
      extractedData = await callGroqVisionAPI(apiKey, systemPrompt, userText, base64Image);
    } catch (err) {
      return NextResponse.json({ error: 'groq_failed', message: err.message }, { status: 500 });
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
        extractedData = await callGroqVisionAPIWithHistory(
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
