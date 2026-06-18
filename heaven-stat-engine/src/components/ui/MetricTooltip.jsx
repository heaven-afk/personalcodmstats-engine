'use client';
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';
import { getMetricDefinition } from '@/lib/metricDefinitions';

export default function MetricTooltip({ metricKey }) {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, showBelow: false });
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);

  const definition = getMetricDefinition(metricKey);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  const updatePosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    
    // Check if the trigger is near the top of the viewport
    const showBelow = rect.top < 150;
    
    // Calculate scroll offset
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;
    
    // Center horizontally relative to trigger
    const left = rect.left + rect.width / 2 + scrollX;
    
    // Position vertically
    let top = 0;
    if (showBelow) {
      top = rect.bottom + 8 + scrollY;
    } else {
      top = rect.top - 8 + scrollY;
    }
    
    setCoords({ top, left, showBelow });
  };

  // Listen to resize and scroll to update tooltip position
  useEffect(() => {
    if (isOpen) {
      updatePosition();
      window.addEventListener('resize', updatePosition);
      // Listen to scroll events in capturing phase to capture scroll inside nested scrollable tables
      window.addEventListener('scroll', updatePosition, true);
    }
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen]);

  // Click outside to close (essential for mobile & desktop click)
  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideClick = (e) => {
      if (
        (triggerRef.current && triggerRef.current.contains(e.target)) ||
        (popoverRef.current && popoverRef.current.contains(e.target))
      ) {
        return;
      }
      setIsOpen(false);
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  if (!definition) return null;

  const handleMouseEnter = () => {
    // Only triggers hover on desktop (devices with hover capability)
    if (window.matchMedia('(pointer: fine)').matches) {
      updatePosition();
      setIsOpen(true);
    }
  };

  const handleMouseLeave = () => {
    if (window.matchMedia('(pointer: fine)').matches) {
      setIsOpen(false);
    }
  };

  const handleToggleClick = (e) => {
    e.preventDefault();
    e.stopPropagation(); // Stop sorting or navigation from triggering
    updatePosition();
    setIsOpen(!isOpen);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`info-tooltip-trigger ${isOpen ? 'active' : ''}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleToggleClick}
        aria-label={`Show info for ${definition.name}`}
      >
        <Info size={12} />
      </button>
      
      {mounted && isOpen && createPortal(
        <div
          ref={popoverRef}
          className="info-tooltip-popover"
          style={{
            position: 'absolute',
            top: `${coords.top}px`,
            left: `${coords.left}px`,
            transform: coords.showBelow 
              ? 'translate(-50%, 0)' 
              : 'translate(-50%, -100%)',
          }}
          onClick={(e) => e.stopPropagation()} // Prevent closing/triggers when clicking inside tooltip
        >
          <div className="info-tooltip-title">{definition.name}</div>
          <div className="info-tooltip-section">
            <div className="info-tooltip-label">Measures</div>
            <div className="info-tooltip-value">{definition.measures}</div>
          </div>
          <div className="info-tooltip-section">
            <div className="info-tooltip-label">How to Interpret</div>
            <div className="info-tooltip-value">{definition.interpretation}</div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
