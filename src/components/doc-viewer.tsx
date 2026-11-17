"use client";
import { useState } from "react";

export interface ViewDoc { id: string; label: string; mime: string; enhancedId: string | null }

/** Document viewer: zoom, rotate, original vs enhanced, multi-page PDFs (browser viewer), download. */
export function DocViewer({ docs, title, height = "70vh", onClose }: { docs: ViewDoc[]; title: string; height?: string; onClose?: () => void }) {
  const [i, setI] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [rot, setRot] = useState(0);
  const [enh, setEnh] = useState(false);
  const d = docs[Math.min(i, docs.length - 1)];
  const isPdf = d?.mime === "application/pdf";
  const src = d ? `/api/documents/${d.id}${enh && d.enhancedId ? "?enhanced=1" : ""}` : "";
  return (
    <div className="card flex flex-col overflow-hidden" style={{ height }}>
      <div className="flex flex-wrap items-center gap-1 border-b border-gray-100 px-3 py-2">
        <div className="mr-auto text-sm font-semibold">{title}</div>
        {!isPdf && d ? (
          <>
            <button className="btn-ghost btn-sm" onClick={() => setZoom((z) => Math.max(0.25, z / 1.25))} aria-label="Zoom out">−</button>
            <span className="w-12 text-center text-xs num">{Math.round(zoom * 100)}%</span>
            <button className="btn-ghost btn-sm" onClick={() => setZoom((z) => Math.min(6, z * 1.25))} aria-label="Zoom in">+</button>
            <button className="btn-ghost btn-sm" onClick={() => { setZoom(1); setRot(0); }}>Fit</button>
            <button className="btn-ghost btn-sm" onClick={() => setRot((r) => (r + 90) % 360)} aria-label="Rotate">⟳</button>
            {d.enhancedId ? (
              <button className={`btn-sm ${enh ? "btn-primary" : "btn-ghost"}`} onClick={() => setEnh((v) => !v)}>{enh ? "Enhanced" : "Original"}</button>
            ) : null}
          </>
        ) : null}
        {d ? (
          <>
            <a className="btn-ghost btn-sm" href={src} target="_blank" rel="noreferrer">Open</a>
            <a className="btn-ghost btn-sm" href={`/api/documents/${d.id}?download=1`}>Download original</a>
          </>
        ) : null}
        {onClose ? <button className="btn-ghost btn-sm" onClick={onClose}>✕</button> : null}
      </div>
      {docs.length > 1 ? (
        <div className="flex gap-1 overflow-x-auto border-b border-gray-100 px-3 py-1.5">
          {docs.map((x, k) => (
            <button key={x.id} onClick={() => { setI(k); setZoom(1); setRot(0); setEnh(false); }} className={`shrink-0 rounded-md px-2 py-1 text-xs ${k === i ? "bg-gray-900 text-white" : "bg-gray-100"}`}>
              {k + 1}. {x.label.slice(0, 32)}
            </button>
          ))}
        </div>
      ) : null}
      <div className="relative flex-1 overflow-auto bg-gray-100">
        {!d ? <div className="grid h-full place-items-center text-sm text-gray-500">No documents attached.</div> : null}
        {d && isPdf ? <iframe title={d.label} src={src} className="h-full w-full bg-white" /> : null}
        {d && !isPdf ? (
          <div className="flex min-h-full min-w-full items-start justify-center p-3">
            <img
              src={src}
              alt={d.label}
              style={{ width: `${zoom * 100}%`, maxWidth: zoom <= 1 ? "100%" : "none", transform: `rotate(${rot}deg)`, transformOrigin: "center center" }}
              className="select-none bg-white shadow"
              draggable={false}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
