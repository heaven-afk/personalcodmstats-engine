import { NextResponse } from 'next/server';

const TEAM_SYSTEM_PROMPT = `You are a CODM (Call of Duty Mobile) Battle Royale scoreboard parser.

You will receive one screenshot of a match results screen. Your ONLY job is to extract 
structured team data from ALL visible scoreboard tables, side-by-side columns, panels, and stacked sections on the screen. 
Ignore all UI chrome, watermarks, logos, background art, HUD elements, and decorative text that is not part of the results table.

IMPORTANT MULTI-SECTION & MULTI-COLUMN INSTRUCTIONS:
- Scoreboards in CODM screenshots are frequently split into MULTIPLE side-by-side columns (e.g., Column 1 / Panel on the left showing Ranks 1-5, Column 2 / Panel on the right showing Ranks 6-10) or multiple stacked sections.
- You MUST scan the ENTIRE screenshot across ALL columns, panels, and sections. DO NOT stop after extracting the first column or top section.
- Extract ALL visible rows from EVERY section and column visible in the image.

For each visible row in the results table extract:
- rank: exact placement number displayed for that row (integer, e.g., 1, 2, 3, 6, 7, 10...). Do NOT force ranks to start at 1 if the visible image starts at a higher placement.
- kills: total team kill count shown for that row (integer, use 0 if blank or not visible). Be very careful to look specifically for the team kills count column (typically a single or double-digit integer). DO NOT confuse it with the Match Score (typically a 4-digit number like 1500, 2400) or Damage.
- slot: squad slot label/number shown in the row next to rank if present (string, e.g., "TEAM 1", "Slot 3", "04", or null if not present)
- teamName: the full team name, clan name, or team tag visible in that row (string, e.g., "Elevate", "Red Reapers", "BOMABA", or null if not present)

Rules:
- Return ONLY valid JSON, no explanation, no markdown, no preamble
- If a field is unreadable or genuinely ambiguous, return null for that field only — do not guess
- If the image is not a CODM scoreboard return: { "error": "not a scoreboard" }
- Deduplicate by team: If a team slot or team name appears more than once in the screenshot (due to image overlaps, side-by-side panel duplicates, or multi-column repeats), compare the rows and pick EXACTLY ONE row—the clearest, most complete row (preferring rows with non-null kills, valid team name, and explicit rank)—and discard the redundant duplicate row(s).
- Ensure the kills count matches the correct team row. Do not repeat or shift numbers between rows.

Response schema:
{
  "lobby": <lobby_number passed in via the user message>,
  "rows": [
    { "rank": 1, "kills": 5, "slot": "TEAM 1", "teamName": "Elevate Esports" },
    { "rank": 2, "kills": 3, "slot": "TEAM 3", "teamName": "Red Reapers" }
  ]
}`;

const PLAYER_SYSTEM_PROMPT = `You are a CODM (Call of Duty Mobile) Battle Royale scoreboard parser.

You will receive one screenshot of a match results screen. Your ONLY job is to extract 
structured player data from ALL visible scoreboard tables, side-by-side columns, panels, and sections. 
Ignore all UI chrome, watermarks, logos, background art, HUD elements, and decorative text that is not part of the results table.

IMPORTANT MULTI-SECTION INSTRUCTIONS:
- You MUST scan the ENTIRE screenshot across ALL columns, panels, and sections (e.g. side-by-side team columns or multi-player lists).
- DO NOT stop after reading the first column or panel. Extract ALL visible player rows across the entire image.

For each visible row in the results table extract:
- name: player name or IGN (string)
- kills: kill count shown for that row (integer, use 0 if blank or not visible). Be very careful to look specifically for the kills count column (typically a single or double-digit integer, e.g., 0 to 30). DO NOT confuse it with the Match Score (typically a 4-digit number like 1500, 2400) or Damage Dealt (typically a 3 or 4-digit number). The kills count is a separate column. If both are present, extract the actual kills count, not the match score.

Rules:
- Return ONLY valid JSON, no explanation, no markdown, no preamble
- If a field is unreadable or genuinely ambiguous, return null for that field only — do not guess
- If the image is not a CODM scoreboard return: { "error": "not a scoreboard" }
- Deduplicate by player name: If a player appears more than once in the screenshot (due to overlaps or side-by-side duplicates), pick EXACTLY ONE row (the one with the clearer, more complete data or higher kills) and discard the other duplicate row(s). Do NOT drop both rows; you MUST include exactly one row for that player.
- Ensure the kills count matches the correct player row. Do not repeat or shift numbers between rows. Do not confuse the Match Score or Damage with Kills.

Response schema:
{
  "lobby": <lobby_number passed in via the user message>,
  "rows": [
    { "name": "PlayerOne", "kills": 5 },
    { "name": "PlayerTwo", "kills": 3 }
  ]
}`;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper to call Google Gemini Vision API with model fallback and robust JSON parsing
async function callGeminiVisionAPI(apiKey, systemPrompt, userText, base64Image, mimeType = 'image/jpeg') {
  const models = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash-8b',
    'gemini-1.5-pro',
    'gemini-flash-latest'
  ];
  let lastError = null;

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
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
                      mimeType: mimeType || 'image/jpeg',
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
          lastError = new Error(`Gemini API (${model}) returned ${response.status}: ${errorText}`);
          // If 503 (high demand) or 429 (rate limit), wait briefly and retry once on this model before moving to next
          if ((response.status === 503 || response.status === 429) && attempt === 0) {
            await delay(800);
            continue;
          }
          break;
        }

        const data = await response.json();
        let rawJsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawJsonText) {
          throw new Error('Gemini Vision API returned empty message content');
        }

        // Clean markdown code fence formatting if present
        rawJsonText = rawJsonText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();

        return JSON.parse(rawJsonText);
      } catch (err) {
        lastError = err;
        if (attempt === 0) {
          await delay(500);
          continue;
        }
        break;
      }
    }
  }

  throw lastError || new Error('Gemini API call failed across all models');
}

// Helper to retry with conversation history
async function callGeminiVisionAPIWithHistory(apiKey, systemPrompt, userText, base64Image, firstAssistantMsg, followUpText, mimeType = 'image/jpeg') {
  const models = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash-8b',
    'gemini-1.5-pro',
    'gemini-flash-latest'
  ];
  let lastError = null;

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
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
                      mimeType: mimeType || 'image/jpeg',
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
          lastError = new Error(`Gemini API retry (${model}) returned ${response.status}: ${errorText}`);
          if ((response.status === 503 || response.status === 429) && attempt === 0) {
            await delay(800);
            continue;
          }
          break;
        }

        const data = await response.json();
        let rawJsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawJsonText) {
          throw new Error('Gemini Vision API retry returned empty message content');
        }

        rawJsonText = rawJsonText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();

        return JSON.parse(rawJsonText);
      } catch (err) {
        lastError = err;
        if (attempt === 0) {
          await delay(500);
          continue;
        }
        break;
      }
    }
  }

  throw lastError || new Error('Gemini API retry failed across all models');
}

// Groq Vision API fallback — used when all Gemini models are unavailable
async function callGroqVisionAPI(groqApiKey, systemPrompt, userText, base64Image, mimeType = 'image/jpeg') {
  // Groq vision models in order of preference
  const models = [
    'meta-llama/llama-4-scout-17b-16e-instruct',
    'llama-3.2-11b-vision-preview',
    'llama-3.2-90b-vision-preview',
  ];
  let lastError = null;

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${groqApiKey}`,
          },
          body: JSON.stringify({
            model,
            temperature: 0,
            max_tokens: 4096,
            messages: [
              {
                role: 'system',
                content: systemPrompt,
              },
              {
                role: 'user',
                content: [
                  {
                    type: 'image_url',
                    image_url: {
                      url: `data:${mimeType || 'image/jpeg'};base64,${base64Image}`,
                    },
                  },
                  {
                    type: 'text',
                    text: userText,
                  },
                ],
              },
            ],
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          lastError = new Error(`Groq API (${model}) returned ${response.status}: ${errorText}`);
          if ((response.status === 503 || response.status === 429) && attempt === 0) {
            await delay(800);
            continue;
          }
          break;
        }

        const data = await response.json();
        let rawJsonText = data.choices?.[0]?.message?.content;
        if (!rawJsonText) {
          throw new Error('Groq Vision API returned empty message content');
        }

        // Clean markdown code fence formatting if present
        rawJsonText = rawJsonText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

        return JSON.parse(rawJsonText);
      } catch (err) {
        lastError = err;
        if (attempt === 0) {
          await delay(500);
          continue;
        }
        break;
      }
    }
  }

  throw lastError || new Error('Groq Vision API call failed across all models');
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
    const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    const groqApiKey = process.env.GROQ_API_KEY;

    if (!geminiApiKey && !groqApiKey) {
      return NextResponse.json({ error: 'ocr_failed', message: 'No API key configured for OCR. Please set GEMINI_API_KEY or GROQ_API_KEY.' }, { status: 500 });
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

    const mimeType = file.type || 'image/jpeg';

    let extractedData;
    let usedProvider = 'gemini';

    // Try Gemini first, fall back to Groq if all Gemini models fail
    if (geminiApiKey) {
      try {
        extractedData = await callGeminiVisionAPI(geminiApiKey, systemPrompt, userText, base64Image, mimeType);
      } catch (geminiErr) {
        console.warn('All Gemini models failed, falling back to Groq Vision:', geminiErr.message);
        if (groqApiKey) {
          try {
            extractedData = await callGroqVisionAPI(groqApiKey, systemPrompt, userText, base64Image, mimeType);
            usedProvider = 'groq';
          } catch (groqErr) {
            return NextResponse.json({ error: 'ocr_failed', message: `Gemini: ${geminiErr.message} | Groq: ${groqErr.message}` }, { status: 500 });
          }
        } else {
          return NextResponse.json({ error: 'gemini_failed', message: geminiErr.message }, { status: 500 });
        }
      }
    } else {
      // No Gemini key — go straight to Groq
      try {
        extractedData = await callGroqVisionAPI(groqApiKey, systemPrompt, userText, base64Image, mimeType);
        usedProvider = 'groq';
      } catch (groqErr) {
        return NextResponse.json({ error: 'ocr_failed', message: groqErr.message }, { status: 500 });
      }
    }

    if (extractedData.error) {
      return NextResponse.json({ error: 'parse_failed', message: extractedData.error }, { status: 422 });
    }

    let rows = extractedData.rows || [];
    let totalRows = rows.length;
    let nullKills = rows.filter(r => r.kills === null || r.kills === undefined).length;
    let isLowConfidence = totalRows > 0 && (nullKills / totalRows) > 0.3;

    let retried = false;
    // Auto-Retry once if low confidence (Gemini multi-turn only; skip for Groq)
    if (isLowConfidence && usedProvider === 'gemini' && geminiApiKey) {
      try {
        const followUpText = "The kills column appears to be a number on the right side of each row. Please re-extract focusing on that column.";
        extractedData = await callGeminiVisionAPIWithHistory(
          geminiApiKey,
          systemPrompt,
          userText,
          base64Image,
          JSON.stringify(extractedData),
          followUpText,
          mimeType
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
      retried,
      provider: usedProvider
    };

    return NextResponse.json(responsePayload);

  } catch (err) {
    console.error('OCR route error:', err);
    return NextResponse.json({ error: 'server_error', message: err.message }, { status: 500 });
  }
}

