/** Server-rendered SVG charts. Palette validated (blue #2a78d6 / orange #eb6834, light surface, CVD-safe). */
const INK = "#1c1f26", MUTE = "#6b7280", GRID = "#e5e7eb", S1 = "#2a78d6", S2 = "#eb6834";
const rmShort = (sen: number) => {
  const v = sen / 100;
  return v >= 1_000_000 ? `${(v / 1e6).toFixed(1)}M` : v >= 10_000 ? `${(v / 1e3).toFixed(0)}k` : v >= 1000 ? `${(v / 1e3).toFixed(1)}k` : v >= 10 ? v.toFixed(0) : v.toFixed(1);
};
const rmFull = (sen: number) => `RM ${(sen / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Rounded-top bar path anchored to the baseline (4px radius on the data end only). */
function barPath(x: number, y: number, w: number, h: number) {
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function niceMax(v: number) {
  if (v <= 10_000) return 10_000; // axis never below RM 100
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v)!;
}

/** Grouped monthly bars: this period vs same month last year (one axis, two series, legend + table). */
export function TrendChart({ data }: { data: { label: string; cur: number; prev: number }[] }) {
  if (data.every((d) => d.cur === 0 && d.prev === 0))
    return <div className="grid h-40 place-items-center rounded-xl bg-gray-50 text-sm text-gray-500">No approved reimbursements in this 12-month window yet.</div>;
  const W = 1000, H = 240, L = 48, B = 28, T = 16;
  const max = niceMax(Math.max(...data.map((d) => Math.max(d.cur, d.prev)), 1));
  const plotW = W - L - 8, plotH = H - B - T;
  const gw = plotW / data.length;
  const bw = Math.max(4, Math.min(16, (gw - 10) / 2));
  const y = (v: number) => T + plotH - (v / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => k * max);
  return (
    <figure>
      <div className="mb-2 flex gap-4 text-xs text-gray-600">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: S1 }} />This period</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: S2 }} />Same month, previous year</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-5xl" role="img" aria-label="Monthly approved reimbursements, this year vs previous year">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - 8} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={L - 6} y={y(t) + 3} fontSize={10} fill={MUTE} textAnchor="end">{rmShort(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x0 = L + i * gw + (gw - (bw * 2 + 2)) / 2;
          return (
            <g key={d.label}>
              <rect x={L + i * gw} y={T} width={gw} height={plotH} fill="transparent"><title>{`${d.label}\nThis period: ${rmFull(d.cur)}\nPrevious year: ${rmFull(d.prev)}`}</title></rect>
              <path d={barPath(x0, y(d.cur), bw, T + plotH - y(d.cur))} fill={S1} pointerEvents="none" />
              <path d={barPath(x0 + bw + 2, y(d.prev), bw, T + plotH - y(d.prev))} fill={S2} pointerEvents="none" />
              <text x={L + i * gw + gw / 2} y={H - 10} fontSize={10} fill={MUTE} textAnchor="middle">{d.label}</text>
            </g>
          );
        })}
        <line x1={L} x2={W - 8} y1={T + plotH} y2={T + plotH} stroke="#9ca3af" />
      </svg>
      <details className="mt-1 text-xs text-gray-600">
        <summary className="cursor-pointer">Table view</summary>
        <table className="mt-1 w-full"><thead><tr><th className="text-left">Month</th><th className="text-right">This period</th><th className="text-right">Previous year</th></tr></thead>
          <tbody>{data.map((d) => <tr key={d.label}><td>{d.label}</td><td className="text-right num">{rmFull(d.cur)}</td><td className="text-right num">{rmFull(d.prev)}</td></tr>)}</tbody></table>
      </details>
    </figure>
  );
}

/** Ranked horizontal bars (single series - no legend; title names it). */
export function RankBars({ data, max: maxRows = 10 }: { data: { label: string; sen: number; sub?: string }[]; max?: number }) {
  const rows = [...data].sort((a, b) => b.sen - a.sen);
  const top = rows.slice(0, maxRows);
  const rest = rows.slice(maxRows);
  if (rest.length) top.push({ label: `Other (${rest.length})`, sen: rest.reduce((a, r) => a + r.sen, 0) });
  const max = Math.max(...top.map((r) => r.sen), 1);
  if (!top.length) return <div className="text-sm text-gray-500">No data.</div>;
  return (
    <ul className="space-y-1.5">
      {top.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 text-xs" title={`${r.label}: ${rmFull(r.sen)}`}>
          <span className="truncate" style={{ color: INK }}>{r.label}</span>
          <span className="h-3 rounded-r" style={{ width: `${Math.max(1, (r.sen / max) * 100)}%`, background: S1, borderRadius: "0 4px 4px 0" }} />
          <span className="num text-right text-gray-600">{rmFull(r.sen)}</span>
        </li>
      ))}
    </ul>
  );
}
