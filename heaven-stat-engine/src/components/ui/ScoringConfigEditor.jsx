'use client';
import { useState, Fragment } from 'react';
import { Check, Plus, Trash2, ClipboardPaste } from 'lucide-react';
import toast from 'react-hot-toast';

// ─── AI Scoring Paste Parser ────────────────────────────────────────────────
function parseScoringText(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const placementPoints = [];
  let killPointValue = null;

  for (const line of lines) {
    const lower = line.toLowerCase();
    const killMatch = lower.match(/(?:points?\s*per\s*kill|kill\s*points?)\s*[:\=\-]\s*(\d+)/);
    if (killMatch) { killPointValue = parseInt(killMatch[1]); continue; }
    const rangeMatch = line.match(
      /(\d+)\s*(?:st|nd|rd|th)?\s*[-–—to]+\s*(\d+)\s*(?:st|nd|rd|th)?[^:=\d]*[:\=\-]\s*(\d+)/i
    );
    if (rangeMatch) {
      for (let i = parseInt(rangeMatch[1]); i <= parseInt(rangeMatch[2]); i++)
        placementPoints.push({ position: i, points: parseInt(rangeMatch[3]) });
      continue;
    }
    const singleMatch = line.match(
      /(?:#)?(\d+)\s*(?:st|nd|rd|th)?\s*(?:place|position)?[^:=\d]*[:\=\-]\s*(\d+)/i
    );
    if (singleMatch) placementPoints.push({ position: parseInt(singleMatch[1]), points: parseInt(singleMatch[2]) });
  }
  placementPoints.sort((a, b) => a.position - b.position);
  return { placementPoints, killPointValue };
}

function PasteScoringPanel({ onApply }) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState(null);
  const doParse = () => { if (text.trim()) setParsed(parseScoringText(text)); };
  const doApply = () => { if (parsed) { onApply(parsed); setText(''); setParsed(null); } };
  return (
    <div style={{ marginTop: 16 }}>
      <textarea
        className="form-textarea"
        rows={5}
        value={text}
        onChange={(e) => { setText(e.target.value); setParsed(null); }}
        placeholder={`Paste scoring rules, e.g.:\n1st Place: 25 points\n2nd Place: 20 points\n3rd-5th: 10 points each\nPoints Per Kill: 2`}
        style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="btn btn-secondary btn-sm" onClick={doParse} disabled={!text.trim()}>Parse</button>
        {parsed?.placementPoints?.length > 0 && (
          <button className="btn btn-primary btn-sm" onClick={doApply}>
            <Check size={13} /> Apply Scoring
          </button>
        )}
      </div>
      {parsed && (
        <div style={{ marginTop: 10, padding: '10px 14px', background: 'var(--bg-alt-row)', borderRadius: 8, fontSize: '0.8rem' }}>
          {parsed.killPointValue != null && (
            <div style={{ color: 'var(--gold)', marginBottom: 6 }}>
              Kill Points: <strong>{parsed.killPointValue}</strong> per kill
            </div>
          )}
          {parsed.placementPoints.length > 0 ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {parsed.placementPoints.map((pp) => (
                <span
                  key={pp.position}
                  style={{ padding: '3px 8px', background: 'var(--bg-header)', borderRadius: 5, color: 'var(--text-primary)' }}
                >
                  #{pp.position}: <strong style={{ color: 'var(--gold)' }}>{pp.points}</strong>
                </span>
              ))}
            </div>
          ) : (
            <div style={{ color: 'var(--danger)' }}>Could not parse placement points. Check format.</div>
          )}
        </div>
      )}
    </div>
  );
}

export const SCORING_PRESETS = {
  top5: {
    label: 'Top 5 (Standard)',
    placementPoints: [
      { position: 1, points: 25 }, { position: 2, points: 20 },
      { position: 3, points: 15 }, { position: 4, points: 10 },
      { position: 5, points: 5 },
    ],
    killPointValue: 2,
  },
  standard25: {
    label: 'Placements 1-25 (Standard)',
    placementPoints: [
      { position: 1, points: 25 }, { position: 2, points: 20 },
      { position: 3, points: 15 }, { position: 4, points: 10 },
      { position: 5, points: 5 },
      ...Array.from({ length: 20 }, (_, i) => ({ position: i + 6, points: 0 })),
    ],
    killPointValue: 2,
  },
  apex20: {
    label: 'Apex Legends (Official)',
    placementPoints: [
      { position: 1, points: 12 }, { position: 2, points: 9 },
      { position: 3, points: 7 }, { position: 4, points: 5 },
      { position: 5, points: 4 }, { position: 6, points: 3 },
      { position: 7, points: 3 }, { position: 8, points: 2 },
      { position: 9, points: 2 }, { position: 10, points: 2 },
      { position: 11, points: 1 }, { position: 12, points: 1 },
      { position: 13, points: 1 }, { position: 14, points: 1 },
      { position: 15, points: 1 }, { position: 16, points: 0 },
      { position: 17, points: 0 }, { position: 18, points: 0 },
      { position: 19, points: 0 }, { position: 20, points: 0 },
    ],
    killPointValue: 1,
  },
  pubg16: {
    label: 'PUBG Esports (Official)',
    placementPoints: [
      { position: 1, points: 10 }, { position: 2, points: 6 },
      { position: 3, points: 5 }, { position: 4, points: 4 },
      { position: 5, points: 3 }, { position: 6, points: 2 },
      { position: 7, points: 1 }, { position: 8, points: 1 },
      ...Array.from({ length: 8 }, (_, i) => ({ position: i + 9, points: 0 })),
    ],
    killPointValue: 1,
  },
};

export const DEFAULT_PLACEMENT_POINTS = [
  { position: 1, points: 25 }, { position: 2, points: 20 },
  { position: 3, points: 15 }, { position: 4, points: 10 },
  { position: 5, points: 5 },
];

/**
 * ScoringConfigEditor — reusable scoring configuration UI.
 *
 * Props:
 *   killPointValue   {number}    Controlled kill point value
 *   setKillPointValue {fn}       Setter
 *   placementPoints  {object[]}  [{ position, points }]
 *   setPlacementPoints {fn}      Setter
 *   compact          {boolean}   If true, hides the card title / reduces padding
 */
export default function ScoringConfigEditor({
  killPointValue,
  setKillPointValue,
  placementPoints,
  setPlacementPoints,
  compact = false,
}) {
  const [showPaste, setShowPaste] = useState(false);

  const addPlacement = () => {
    const next = (placementPoints[placementPoints.length - 1]?.position || 0) + 1;
    setPlacementPoints((p) => [...p, { position: next, points: 0 }]);
  };
  const removePlacement = (i) => setPlacementPoints((p) => p.filter((_, j) => j !== i));
  const updatePlacement = (i, field, val) =>
    setPlacementPoints((p) => p.map((pp, j) => (j === i ? { ...pp, [field]: Number(val) } : pp)));

  return (
    <div className="flex-col">
      {!compact && (
        <h2 className="card-title" style={{ marginBottom: 4 }}>
          Scoring Configuration
        </h2>
      )}

      <div className="form-field">
        <label className="form-label">Kill Point Value</label>
        <input
          className="form-input"
          type="number"
          min={0}
          step={0.5}
          value={killPointValue}
          onChange={(e) => setKillPointValue(e.target.value)}
          style={{ maxWidth: 160 }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <label className="form-label">Placement Points Table</label>
        <div style={{ display: 'flex', gap: 8 }}>
          {!showPaste && (
            <select
              className="form-select text-xs py-1 px-2"
              style={{ width: 180, height: 30 }}
              defaultValue=""
              onChange={(e) => {
                const val = e.target.value;
                if (val && SCORING_PRESETS[val]) {
                  setPlacementPoints(SCORING_PRESETS[val].placementPoints);
                  setKillPointValue(SCORING_PRESETS[val].killPointValue);
                  toast.success(`Loaded preset: ${SCORING_PRESETS[val].label}`);
                }
                e.target.value = '';
              }}
            >
              <option value="" disabled>-- Load Preset --</option>
              <option value="top5">Top 5 Standard</option>
              <option value="standard25">Standard Placements 1-25</option>
              <option value="apex20">Apex Legends Official</option>
              <option value="pubg16">PUBG Esports Official</option>
            </select>
          )}
          <button className="btn btn-secondary btn-sm" onClick={() => setShowPaste((v) => !v)}>
            <ClipboardPaste size={13} /> {showPaste ? 'Manual' : 'Paste Rules'}
          </button>
          {!showPaste && (
            <button className="btn btn-secondary btn-sm" onClick={addPlacement}>
              <Plus size={13} /> Add Row
            </button>
          )}
        </div>
      </div>

      {showPaste ? (
        <PasteScoringPanel
          onApply={({ placementPoints: pp, killPointValue: kp }) => {
            if (pp.length > 0) setPlacementPoints(pp);
            if (kp != null) setKillPointValue(kp);
            setShowPaste(false);
            toast.success('Scoring rules applied!');
          }}
        />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr auto',
            gap: '6px 10px',
            alignItems: 'center',
            maxWidth: 360,
          }}
        >
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>POSITION</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>POINTS</div>
          <div />
          {placementPoints.map((pp, i) => (
            <Fragment key={`row-${i}`}>
              <input
                type="number"
                className="form-input"
                value={pp.position}
                onChange={(e) => updatePlacement(i, 'position', e.target.value)}
              />
              <input
                type="number"
                className="form-input"
                value={pp.points}
                onChange={(e) => updatePlacement(i, 'points', e.target.value)}
              />
              <button className="btn btn-ghost" onClick={() => removePlacement(i)}>
                <Trash2 size={13} />
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
