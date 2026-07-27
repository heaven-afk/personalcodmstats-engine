import { NextResponse } from 'next/server';
import { generateDeterministicTemplate } from '@/lib/engine/insightRules';

const PHRASING_SYSTEM_PROMPT = `You are a sports analyst writing brief, natural commentary about a Battle Royale esports team or player's performance. You will receive a list of structured data facts. Write 1-3 short sentences (broadcast-caster style, confident, concise) that communicate these facts naturally.

CRITICAL RULES:
- You may ONLY reference numbers and facts explicitly given to you in the input
- Never invent, estimate, or round differently than the numbers provided
- Never mention facts not present in the input
- If the input list is empty, return an empty string
- Return ONLY the sentence(s), no preamble, no markdown`;

export async function POST(req) {
  let facts = [];
  let entityName = 'The team';

  try {
    const body = await req.json();
    facts = body.facts || [];
    entityName = body.entityName || 'The team';

    if (!facts || facts.length === 0) {
      return NextResponse.json({ narrative: '', fallback: false });
    }

    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    if (!apiKey) {
      const fallbackNarrative = generateDeterministicTemplate(facts, entityName);
      return NextResponse.json({ narrative: fallbackNarrative, fallback: true });
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: PHRASING_SYSTEM_PROMPT }]
        },
        contents: [
          {
            parts: [{ text: `Entity Name: ${entityName}\nStructured Facts:\n${JSON.stringify(facts, null, 2)}` }]
          }
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 200,
        }
      })
    });

    if (!response.ok) {
      console.warn(`Gemini Insights Phrasing API returned status ${response.status}. Using template fallback.`);
      const fallbackNarrative = generateDeterministicTemplate(facts, entityName);
      return NextResponse.json({ narrative: fallbackNarrative, fallback: true });
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    if (!rawText) {
      const fallbackNarrative = generateDeterministicTemplate(facts, entityName);
      return NextResponse.json({ narrative: fallbackNarrative, fallback: true });
    }

    return NextResponse.json({ narrative: rawText, fallback: false });

  } catch (err) {
    console.error('Insights phrasing route error:', err);
    const fallbackNarrative = generateDeterministicTemplate(facts, entityName);
    return NextResponse.json({ narrative: fallbackNarrative, fallback: true, error: err.message });
  }
}
