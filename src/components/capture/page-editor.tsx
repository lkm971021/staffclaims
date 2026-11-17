"use client";
import { useEffect, useRef, useState } from "react";
import {
  bitmapToCanvas, canvasToJpeg, detectQuad, enhance, fullQuad, loadBitmap, rotate90, warpPerspective,
  type EnhanceMode, type Quad,
} from "./image-tools";

export interface EditedPage {
  original: File;
  enhanced: Blob | null;
  previewUrl: string;
}

/** Full-screen receipt page editor: crop corners (auto-detected), rotate, enhance, preview. */
export function PageEditor({ file, onDone, onCancel }: { file: File; onDone: (p: EditedPage) => void; onCancel: () => void }) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [quad, setQuad] = useState<Quad | null>(null);
  const [mode, setMode] = useState<EnhanceMode>("auto");
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [detected, setDetected] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ w: 300, h: 400, k: 1 });
  const drag = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const bmp = await loadBitmap(file);
        const c = bitmapToCanvas(bmp);
        if (!alive) return;
        setCanvas(c);
        const q = detectQuad(c);
        setDetected(Boolean(q));
        setQuad(q ?? fullQuad(c.width, c.height));
      } catch {
        // Browser cannot decode (e.g. HEIC outside Safari): upload the original as-is.
        onDone({ original: file, enhanced: null, previewUrl: "" });
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  useEffect(() => {
    if (!canvas || !wrapRef.current) return;
    const fit = () => {
      const r = wrapRef.current!.getBoundingClientRect();
      const k = Math.min(r.width / canvas.width, r.height / canvas.height);
      setView({ w: canvas.width * k, h: canvas.height * k, k });
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [canvas]);

  const imgUrl = canvas ? canvas.toDataURL("image/jpeg", 0.7) : "";

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (drag.current === null || !quad || !canvas) return;
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const x = Math.min(canvas.width, Math.max(0, (e.clientX - r.left) / view.k));
    const y = Math.min(canvas.height, Math.max(0, (e.clientY - r.top) / view.k));
    const q = [...quad] as Quad;
    q[drag.current] = { x, y };
    setQuad(q);
  }

  function rotate() {
    if (!canvas) return;
    const c = rotate90(canvas);
    setCanvas(c);
    const q = detectQuad(c);
    setQuad(q ?? fullQuad(c.width, c.height));
    setPreview(null);
  }

  async function build(): Promise<Blob> {
    const warped = warpPerspective(canvas!, quad!);
    return canvasToJpeg(enhance(warped, mode));
  }

  async function showPreview() {
    setBusy(true);
    try {
      const b = await build();
      setPreview(URL.createObjectURL(b));
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }

  async function use() {
    setBusy(true);
    try {
      const b = await build();
      onDone({ original: file, enhanced: b, previewUrl: URL.createObjectURL(b) });
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-950 text-white" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={onCancel} className="text-sm font-semibold text-gray-300">Cancel</button>
        <div className="text-sm font-semibold">{preview ? "Preview" : "Adjust receipt"}</div>
        <button onClick={use} disabled={busy || !canvas} className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-bold disabled:opacity-50">
          {busy ? "…" : "Use page"}
        </button>
      </div>
      <div ref={wrapRef} className="relative mx-3 flex flex-1 items-center justify-center overflow-hidden">
        {!canvas ? <div className="text-gray-400">Loading image…</div> : null}
        {canvas && preview ? <img src={preview} alt="Preview" className="max-h-full max-w-full rounded bg-white object-contain" /> : null}
        {canvas && !preview && quad ? (
          <div className="relative" style={{ width: view.w, height: view.h }}>
            <img src={imgUrl} alt="Receipt" className="absolute inset-0 h-full w-full select-none" draggable={false} />
            <svg
              className="absolute inset-0 touch-none"
              width={view.w}
              height={view.h}
              onPointerMove={onPointerMove}
              onPointerUp={() => (drag.current = null)}
              onPointerLeave={() => (drag.current = null)}
            >
              <polygon points={quad.map((p) => `${p.x * view.k},${p.y * view.k}`).join(" ")} fill="rgba(201,154,46,0.15)" stroke="#f5c451" strokeWidth={2} />
              {quad.map((p, i) => (
                <circle
                  key={i}
                  cx={p.x * view.k}
                  cy={p.y * view.k}
                  r={16}
                  fill="rgba(255,255,255,0.25)"
                  stroke="#f5c451"
                  strokeWidth={3}
                  onPointerDown={(e) => {
                    (e.target as Element).setPointerCapture?.(e.pointerId);
                    drag.current = i;
                  }}
                  aria-label={`Corner ${i + 1}`}
                />
              ))}
            </svg>
          </div>
        ) : null}
      </div>
      {err ? <div className="mx-4 mt-2 rounded bg-red-600/80 px-3 py-2 text-sm">{err}</div> : null}
      <div className="space-y-3 px-4 py-3">
        <div className="text-center text-xs text-gray-400">
          {detected ? "Edges detected automatically — drag the corners to adjust." : "Drag the corners to the edges of the receipt."} The original photo is always kept.
        </div>
        <div className="flex justify-center gap-1 rounded-xl bg-gray-800 p-1 text-sm">
          {(["none", "auto", "document"] as EnhanceMode[]).map((m) => (
            <button key={m} onClick={() => { setMode(m); setPreview(null); }} className={`flex-1 rounded-lg px-3 py-2 font-semibold ${mode === m ? "bg-white text-gray-900" : "text-gray-300"}`}>
              {m === "none" ? "Original" : m === "auto" ? "Enhanced" : "B&W document"}
            </button>
          ))}
        </div>
        <div className="flex justify-center gap-2 text-sm">
          <button onClick={rotate} className="rounded-lg bg-gray-800 px-3 py-2 font-semibold">⟳ Rotate</button>
          <button onClick={() => { if (canvas) { const q = detectQuad(canvas); setQuad(q ?? fullQuad(canvas.width, canvas.height)); setDetected(Boolean(q)); setPreview(null); } }} className="rounded-lg bg-gray-800 px-3 py-2 font-semibold">Auto-detect</button>
          <button onClick={() => { if (canvas) { setQuad(fullQuad(canvas.width, canvas.height)); setPreview(null); } }} className="rounded-lg bg-gray-800 px-3 py-2 font-semibold">Full image</button>
          {preview ? (
            <button onClick={() => setPreview(null)} className="rounded-lg bg-gray-800 px-3 py-2 font-semibold">Edit</button>
          ) : (
            <button onClick={showPreview} disabled={busy} className="rounded-lg bg-gray-800 px-3 py-2 font-semibold">Preview</button>
          )}
        </div>
      </div>
    </div>
  );
}
