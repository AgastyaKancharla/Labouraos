import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * The large view of an ID-check photo (22 Nov, owner testing): the live selfie or the photo of
 * the ID card opens full screen so a Team Lead, Manager or CEO can compare the face, the name and
 * the date of birth. Zoom with the buttons, the mouse wheel, + / - keys, a double click or a
 * two-finger pinch; drag to move a zoomed photo; Esc, the Close button or a click on the dark
 * backdrop closes it, and focus goes back to the photo that opened it.
 */
const MIN_SCALE = 1;
const MAX_SCALE = 6;
const STEP = 1.5;

const clamp = (v: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v));

export function PhotoLightbox({ src, alt, open, onClose }: { src: string; alt: string; open: boolean; onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [broken, setBroken] = useState(false);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const zoomTo = useCallback((next: number) => {
    const s = clamp(next);
    setScale(s);
    if (s === 1) setOffset({ x: 0, y: 0 });
  }, []);
  const reset = useCallback(() => zoomTo(1), [zoomTo]);

  useEffect(() => {
    if (!open) return;
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setBroken(false);
    const previous = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        onCloseRef.current();
      } else if (e.key === '+' || e.key === '=') {
        setScale((s) => clamp(s * STEP));
      } else if (e.key === '-' || e.key === '_') {
        setScale((s) => {
          const n = clamp(s / STEP);
          if (n === 1) setOffset({ x: 0, y: 0 });
          return n;
        });
      } else if (e.key === '0') {
        setScale(1);
        setOffset({ x: 0, y: 0 });
      }
    };
    // Capture: the lightbox may sit above a dialog, and Esc closes only the top one.
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open, src]);

  if (!open) return null;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale };
      drag.current = null;
    } else if (pointers.current.size === 1) {
      drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      zoomTo(pinch.current.scale * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.dist));
    } else if (drag.current && scale > 1) {
      setOffset({ x: drag.current.ox + (e.clientX - drag.current.x), y: drag.current.oy + (e.clientY - drag.current.y) });
    }
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) drag.current = null;
  };

  return createPortal(
    <div
      className="lb-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      data-testid="photo-lightbox"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="lb-lightbox__bar">
        <span className="lb-lightbox__title">{alt}</span>
        <div className="lb-lightbox__tools">
          <button type="button" onClick={() => zoomTo(scale / STEP)} disabled={scale <= MIN_SCALE} aria-label="Zoom out">−</button>
          <button type="button" onClick={reset} aria-label="Actual size">{Math.round(scale * 100)}%</button>
          <button type="button" onClick={() => zoomTo(scale * STEP)} disabled={scale >= MAX_SCALE} aria-label="Zoom in">+</button>
          <button type="button" ref={closeBtn} onClick={onClose} className="lb-lightbox__close" aria-label="Close">
            Close ✕
          </button>
        </div>
      </div>
      <div
        className="lb-lightbox__stage"
        onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        onWheel={(e) => zoomTo(scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15))}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => zoomTo(scale > 1 ? 1 : 2.5)}
        style={{ cursor: scale > 1 ? 'grab' : 'zoom-in' }}
      >
        {broken ? (
          <p className="lb-lightbox__error" role="alert">
            The photo could not be loaded. Its private link lasts 5 minutes: close this and open the photos again.
          </p>
        ) : (
          <img
            src={src}
            alt={alt}
            draggable={false}
            onError={() => setBroken(true)}
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
          />
        )}
      </div>
      <p className="lb-lightbox__hint">Pinch or scroll to zoom · drag to move · Esc to close</p>
    </div>,
    document.body,
  );
}

/**
 * A photo that opens large when tapped or clicked (keyboard: Enter or Space). `children` is the
 * thumbnail the screen already draws; without it a plain <img> fills the box.
 */
export function ZoomablePhoto({ src, alt, children, className }: { src: string; alt: string; children?: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`lb-zoomable${className ? ` ${className}` : ''}`}
        onClick={() => setOpen(true)}
        aria-label={`Open large: ${alt}`}
        title="Tap to open large"
      >
        {children ?? <img src={src} alt={alt} />}
        <span className="lb-zoomable__hint" aria-hidden="true">
          ⤢ Tap to enlarge
        </span>
      </button>
      <PhotoLightbox src={src} alt={alt} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
