'use client';
import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * EditableCell — click-to-edit inline cell.
 * Supports Tab/Enter navigation and auto-save on blur.
 */
export default function EditableCell({
  value,
  onChange,
  onBlur,
  type = 'number',
  placeholder = '—',
  className = '',
  min,
  max,
  step,
  disabled = false,
  cellId,
}) {
  const [editing, setEditing] = useState(false);
  const [localVal, setLocalVal] = useState(value ?? '');
  const inputRef = useRef(null);

  useEffect(() => { setLocalVal(value ?? ''); }, [value]);

  const startEdit = () => {
    if (disabled) return;
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commit = useCallback(() => {
    setEditing(false);
    if (onBlur) onBlur(localVal);
  }, [localVal, onBlur]);

  const handleKey = (e) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      commit();
      // Find next editable cell by tabIndex
      const cells = [...document.querySelectorAll('[data-editable]')];
      const idx = cells.indexOf(e.currentTarget.closest('[data-editable]'));
      if (idx >= 0 && idx < cells.length - 1) {
        cells[idx + 1].click();
      }
    }
    if (e.key === 'Escape') { setLocalVal(value ?? ''); setEditing(false); }
  };

  const displayVal = (localVal !== '' && localVal !== null && localVal !== undefined)
    ? localVal
    : <span className="cell-empty">—</span>;

  if (editing) {
    return (
      <input
        ref={inputRef}
        type={type}
        value={localVal}
        min={min}
        max={max}
        step={step}
        autoFocus
        className={`editable-input ${className}`}
        onChange={(e) => { setLocalVal(e.target.value); if (onChange) onChange(e.target.value); }}
        onBlur={commit}
        onKeyDown={handleKey}
      />
    );
  }

  return (
    <div
      data-editable={cellId || true}
      className={`editable-cell-display ${disabled ? 'computed-cell' : ''} ${className}`}
      onClick={startEdit}
      tabIndex={disabled ? -1 : 0}
      onFocus={startEdit}
      role="button"
    >
      {displayVal}
    </div>
  );
}
