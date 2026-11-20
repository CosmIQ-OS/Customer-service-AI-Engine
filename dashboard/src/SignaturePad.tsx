import { useEffect, useRef, useState } from 'react';

interface SignaturePadProps {
  value: string;
  onChange: (dataUrl: string) => void;
  label?: string;
}

export function SignaturePad({ value, onChange, label = 'Signature (Draw or Upload)' }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasStroke, setHasStroke] = useState(false);

  useEffect(() => {
    if (!value) {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      setHasStroke(false);
    }
  }, [value]);

  function getPoint(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function startDraw(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    canvas.setPointerCapture(e.pointerId);
    const { x, y } = getPoint(e);
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    setDrawing(true);
    setHasStroke(true);
  }

  function moveDraw(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPoint(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function endDraw() {
    if (!drawing) return;
    setDrawing(false);
    const canvas = canvasRef.current;
    if (canvas && hasStroke) {
      onChange(canvas.toDataURL('image/png'));
    }
  }

  function handleClear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    setHasStroke(false);
    onChange('');
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = typeof reader.result === 'string' ? reader.result : '';
      if (!src) return;
      const img = new Image();
      img.onload = () => {
        const offscreen = document.createElement('canvas');
        const maxW = 360;
        const maxH = 120;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        offscreen.width = Math.max(1, Math.round(img.width * scale));
        offscreen.height = Math.max(1, Math.round(img.height * scale));
        const ctx = offscreen.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, offscreen.width, offscreen.height);
        onChange(offscreen.toDataURL('image/png'));
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="field-label">{label}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label
            className="btn secondary"
            style={{
              minHeight: 28,
              padding: '2px 10px',
              fontSize: '10.5px',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            Upload Image
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
          </label>
          {value && (
            <button
              type="button"
              className="btn secondary"
              style={{ minHeight: 28, padding: '2px 10px', fontSize: '10.5px' }}
              onClick={handleClear}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {value ? (
        <div
          style={{
            background: '#ffffff',
            border: '1px solid var(--border-default)',
            padding: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <img
            src={value}
            alt="Signature preview"
            style={{ maxHeight: 68, maxWidth: 260, objectFit: 'contain' }}
          />
          <span className="mono muted" style={{ fontSize: '10px' }}>
            SAVED SIGNATURE READY FOR PDF
          </span>
        </div>
      ) : (
        <div style={{ background: '#ffffff', border: '1px dashed var(--border-strong)', padding: 6 }}>
          <canvas
            ref={canvasRef}
            width={420}
            height={96}
            onPointerDown={startDraw}
            onPointerMove={moveDraw}
            onPointerUp={endDraw}
            onPointerCancel={endDraw}
            style={{
              width: '100%',
              height: 96,
              display: 'block',
              cursor: 'crosshair',
              touchAction: 'none',
            }}
          />
          <div className="mono" style={{ fontSize: '10px', color: '#78716c', textAlign: 'right', paddingTop: 2 }}>
            Draw signature above or click Upload Image
          </div>
        </div>
      )}
    </div>
  );
}
