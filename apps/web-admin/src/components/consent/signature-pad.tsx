'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';

export interface SignaturePadHandle {
  clear: () => void;
  /** PNG, data URL. Mürekkep yoksa `null`. */
  toPng: () => string | null;
}

interface Point {
  x: number;
  y: number;
}

const INK = '#111827';
const LINE_WIDTH = 2.6;

/**
 * Parmak/kalem ile imza alanı — kütüphanesiz, pointer events.
 *
 * Pointer events fare, dokunmatik ve kalemi TEK yoldan geçiriyor. Alanın
 * `touch-action: none` taşıması şart: yoksa tablette imza atarken sayfa
 * kayar ve çizgi kopar.
 *
 * Tuval cihaz piksel oranıyla ölçekleniyor; yoksa retina tablette imza
 * bulanık çıkar ve PDF'e bulanık gömülür.
 */
export const SignaturePad = forwardRef<
  SignaturePadHandle,
  { onInkChange: (hasInk: boolean) => void; label: string; className?: string }
>(function SignaturePad({ onInkChange, label, className }, ref): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<Point | null>(null);
  const inked = useRef(false);

  const context = useCallback((): CanvasRenderingContext2D | null => {
    return canvasRef.current?.getContext('2d') ?? null;
  }, []);

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = context();
    if (ctx === null) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.lineWidth = LINE_WIDTH;
    // Boyut değişimi tuvali siler; mürekkep durumu da buna uymalı.
    if (inked.current) {
      inked.current = false;
      onInkChange(false);
    }
  }, [context, onInkChange]);

  useEffect(() => {
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [resize]);

  useImperativeHandle(
    ref,
    () => ({
      clear: () => {
        const canvas = canvasRef.current;
        const ctx = context();
        if (canvas === null || ctx === null) return;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
        inked.current = false;
        onInkChange(false);
      },
      toPng: () => (inked.current ? (canvasRef.current?.toDataURL('image/png') ?? null) : null),
    }),
    [context, onInkChange],
  );

  function pointOf(event: PointerEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function markInk(): void {
    if (inked.current) return;
    inked.current = true;
    onInkChange(true);
  }

  function handleDown(event: PointerEvent<HTMLCanvasElement>): void {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const point = pointOf(event);
    last.current = point;
    // Tek dokunuş da bir iz bırakır (i'nin noktası).
    const ctx = context();
    if (ctx === null) return;
    ctx.beginPath();
    ctx.arc(point.x, point.y, LINE_WIDTH / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  function handleMove(event: PointerEvent<HTMLCanvasElement>): void {
    if (!drawing.current || last.current === null) return;
    event.preventDefault();
    const ctx = context();
    if (ctx === null) return;
    // Hızlı harekette tarayıcı ara noktaları birleştirir; hepsini çizmek
    // çizgiyi köşeli olmaktan kurtarır.
    const events =
      typeof event.nativeEvent.getCoalescedEvents === 'function'
        ? event.nativeEvent.getCoalescedEvents()
        : [event.nativeEvent];
    const rect = event.currentTarget.getBoundingClientRect();
    for (const sample of events.length > 0 ? events : [event.nativeEvent]) {
      const point = { x: sample.clientX - rect.left, y: sample.clientY - rect.top };
      const from = last.current;
      const mid = { x: (from.x + point.x) / 2, y: (from.y + point.y) / 2 };
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.quadraticCurveTo(from.x, from.y, mid.x, mid.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
      last.current = point;
    }
    markInk();
  }

  function handleUp(event: PointerEvent<HTMLCanvasElement>): void {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    markInk();
  }

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      className={cn(
        'block h-48 w-full cursor-crosshair touch-none rounded-xl border-2 border-dashed border-border bg-white',
        className,
      )}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      onPointerLeave={handleUp}
    />
  );
});
