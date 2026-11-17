"use client";
import { useRef, useState } from "react";
import { ocrAction, removeDocAction, saveLineAction } from "@/app/actions/staff";
import { PageEditor, type EditedPage } from "@/components/capture/page-editor";
import type { DocLite, EditorData, LineData } from "./claim-editor";

type Form = Omit<LineData, "id" | "lineNo" | "categoryName" | "branchName" | "amountSen" | "finStatus" | "finComment" | "documents">;

interface OcrSuggest {
  error: string | null; supplier: string | null; receiptNo: string | null; docDate: string | null; totalSen: number | null; taxSen: number | null;
  supplierTin: string | null; supplierBrn: string | null; supplierSst: string | null; description: string | null; legible: boolean | null;
  documentType: string | null; einvoiceUuid: string | null;
}

const EINV_LABELS: Record<string, string> = {
  supplierTin: "Supplier TIN", supplierBrn: "Supplier BRN / ID No.", supplierSst: "Supplier SST Reg. No.", invoiceNo: "Invoice No.",
  invoiceDate: "Invoice Date", einvoiceUuid: "e-Invoice UUID / Reference", einvoiceStatus: "e-Invoice Validation Status",
};

export function ExpenseForm({ data, line, onClose }: { data: EditorData; line: LineData | null; onClose: (saved: boolean) => void }) {
  const { claim, categories, branches, settings } = data;
  const [f, setF] = useState<Form>(() =>
    line
      ? { ...line }
      : {
          expenseDate: data.today, categoryId: "", branchId: data.defaultBranchId, supplier: "", description: "", businessPurpose: "",
          location: "", receiptNo: "", amount: "", staffPaymentMethod: "CASH", docIsReceipt: true, docIsEinvoice: false, supplierTin: "",
          supplierBrn: "", supplierSst: "", invoiceNo: "", invoiceDate: "", einvoiceUuid: "", einvoiceStatus: "", remarks: "",
        },
  );
  const [docs, setDocs] = useState<DocLite[]>(line ? line.documents : []);
  const [newDocIds, setNewDocIds] = useState<string[]>([]);
  const [queue, setQueue] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocr, setOcr] = useState<OcrSuggest | null>(null);
  const [filled, setFilled] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);

  const cat = categories.find((c) => c.id === f.categoryId);
  const einvoice = Boolean(cat?.einvoiceApplicable && f.expenseDate >= settings.einvoiceEffectiveDate);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  async function upload(files: { file: File | Blob; name: string; enhanced?: Blob | null }[]) {
    setUploading(true);
    setErr("");
    try {
      const fd = new FormData();
      if (line) fd.set("lineId", line.id);
      files.forEach((x, i) => {
        if (x.file.size > settings.maxUploadMb * 1024 * 1024) throw new Error(`${x.name} is larger than ${settings.maxUploadMb} MB.`);
        fd.set(`file_${i}`, x.file, x.name);
        if (x.enhanced) fd.set(`enhanced_${i}`, x.enhanced, `enhanced-${x.name.replace(/\.\w+$/, "")}.jpg`);
      });
      const res = await fetch(`/api/claims/${claim.id}/documents`, { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Upload failed");
      const added: DocLite[] = j.documents.map((d: { id: string; filename: string; mime: string }) => ({ ...d, enhanced: files.some((x) => x.enhanced) }));
      const fresh = added.filter((a) => !docs.some((d) => d.id === a.id));
      setDocs((p) => [...p, ...fresh]);
      if (!line) setNewDocIds((p) => [...p, ...fresh.map((d) => d.id)]);
      if (fresh[0] && docs.length === 0) runOcr(fresh[0].id);
    } catch (e) {
      setErr((e as Error).message || "Upload failed. Check your connection and try again.");
    }
    setUploading(false);
  }

  async function runOcr(docId: string) {
    setOcrBusy(true);
    const r = await ocrAction(docId);
    setOcrBusy(false);
    if (!r.ok || !r.data) return;
    const o = r.data as OcrSuggest;
    setOcr(o);
    if (o.error) return;
    // Fill only EMPTY fields - suggestions never overwrite what the staff member typed.
    const got: string[] = [];
    setF((p) => {
      const n = { ...p };
      const fill = (k: keyof Form, v: string | null | undefined, label: string) => {
        if (v && !String(n[k] ?? "").trim()) {
          (n as Record<string, unknown>)[k] = v;
          got.push(label);
        }
      };
      fill("supplier", o.supplier, "supplier");
      fill("receiptNo", o.receiptNo, "receipt no.");
      if (o.docDate && (!line && p.expenseDate === data.today)) {
        n.expenseDate = o.docDate;
        got.push("date");
      }
      fill("amount", o.totalSen !== null ? (o.totalSen / 100).toFixed(2) : null, "amount");
      fill("description", o.description, "description");
      fill("supplierTin", o.supplierTin, "supplier TIN");
      fill("supplierBrn", o.supplierBrn, "supplier BRN");
      fill("supplierSst", o.supplierSst, "SST no.");
      fill("einvoiceUuid", o.einvoiceUuid, "e-Invoice UUID");
      if (o.documentType === "e_invoice") n.docIsEinvoice = true;
      return n;
    });
    setFilled(got);
  }

  function onPick(list: FileList | null, kind: "image" | "pdf") {
    if (!list?.length) return;
    const files = Array.from(list);
    if (kind === "pdf") upload(files.map((file) => ({ file, name: file.name })));
    else setQueue((q) => [...q, ...files]);
  }

  async function onEdited(p: EditedPage) {
    setQueue((q) => q.slice(1));
    await upload([{ file: p.original, name: p.original.name || "receipt.jpg", enhanced: p.enhanced }]);
  }

  async function removeDoc(d: DocLite) {
    if (!confirm(`Remove ${d.filename}?`)) return;
    const r = await removeDocAction(claim.id, d.id);
    if (!r.ok) return setErr(r.error);
    setDocs((p) => p.filter((x) => x.id !== d.id));
    setNewDocIds((p) => p.filter((x) => x !== d.id));
  }

  async function save() {
    setErr("");
    setSaving(true);
    const r = await saveLineAction(claim.id, { ...f, id: line?.id, attachDocIds: newDocIds });
    setSaving(false);
    if (!r.ok) return setErr(r.error);
    onClose(true);
  }

  async function cancel() {
    // uploaded-but-unsaved documents are removed from the draft (kept in history, never part of the claim)
    for (const id of newDocIds) await removeDocAction(claim.id, id);
    onClose(false);
  }

  const amountSen = Math.round(parseFloat(f.amount || "0") * 100);
  const mismatch = ocr && !ocr.error && ocr.totalSen !== null && f.amount && Math.abs(ocr.totalSen - amountSen) > 1;
  const dateMismatch = ocr && !ocr.error && ocr.docDate && ocr.docDate !== f.expenseDate;

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-gray-50 sm:items-center sm:justify-center sm:bg-black/40 sm:p-6">
      <div className="flex h-full w-full flex-col bg-gray-50 sm:h-auto sm:max-h-[92vh] sm:max-w-2xl sm:rounded-2xl sm:shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 sm:rounded-t-2xl" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
          <button onClick={cancel} className="text-sm font-semibold text-gray-600">Cancel</button>
          <div className="font-semibold">{line ? `Edit expense ${line.lineNo}` : "New expense"}</div>
          <button onClick={save} disabled={saving || uploading} className="text-sm font-bold text-brand-700 disabled:opacity-40">{saving ? "Saving…" : "Save"}</button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {/* 1. Supporting documents */}
          <section className="card p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="font-semibold">Receipt / invoice</div>
              {cat && !cat.requiresReceipt ? <span className="text-xs text-gray-500">optional for this category</span> : <span className="text-xs text-gray-500">required</span>}
            </div>
            {docs.length ? (
              <div className="mb-3 flex flex-wrap gap-2">
                {docs.map((d) => (
                  <div key={d.id} className="relative">
                    <a href={`/api/documents/${d.id}${d.enhanced ? "?enhanced=1" : ""}`} target="_blank" className="block h-24 w-20 overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                      {d.mime === "application/pdf" ? (
                        <span className="grid h-full place-items-center text-xs font-bold text-red-700">PDF</span>
                      ) : (
                        <img src={`/api/documents/${d.id}${d.enhanced ? "?enhanced=1" : ""}`} alt={d.filename} className="h-full w-full object-cover" />
                      )}
                    </a>
                    <button onClick={() => removeDoc(d)} className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-gray-900 text-xs text-white" aria-label="Remove">✕</button>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={() => camRef.current?.click()} className="btn-primary flex-col py-3 text-xs" disabled={uploading}>
                <span className="text-xl">📷</span>Take photo
              </button>
              <button type="button" onClick={() => galRef.current?.click()} className="btn-ghost flex-col py-3 text-xs" disabled={uploading}>
                <span className="text-xl">🖼️</span>Gallery
              </button>
              <button type="button" onClick={() => pdfRef.current?.click()} className="btn-ghost flex-col py-3 text-xs" disabled={uploading}>
                <span className="text-xl">📄</span>PDF file
              </button>
            </div>
            <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { onPick(e.target.files, "image"); e.target.value = ""; }} />
            <input ref={galRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { onPick(e.target.files, "image"); e.target.value = ""; }} />
            <input ref={pdfRef} type="file" accept="application/pdf" multiple className="hidden" onChange={(e) => { onPick(e.target.files, "pdf"); e.target.value = ""; }} />
            <div className="mt-2 text-xs text-gray-500">Add several photos for long or multi-page receipts — they are combined into one PDF. Keep the original hard copy for Finance.</div>
            {uploading ? <div className="mt-2 text-sm text-blue-700">Uploading…</div> : null}
            {ocrBusy ? <div className="mt-2 text-sm text-blue-700">Reading receipt…</div> : null}
            {ocr && !ocr.error && filled.length ? (
              <div className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-900">
                Filled from the receipt: {filled.join(", ")}. <b>Please check every value</b> — automatic reading can make mistakes.
              </div>
            ) : null}
            {ocr?.documentType === "payment_proof_only" ? (
              <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">This looks like a payment screenshot. Payment proof is not expense proof — please attach the receipt or invoice.</div>
            ) : null}
            {ocr?.legible === false ? <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">The photo may be unclear. Consider retaking it in good light.</div> : null}
          </section>

          {/* 2. Details */}
          <section className="card space-y-3 p-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="expenseDate">Expense date *</label>
                <input id="expenseDate" type="date" className="input" value={f.expenseDate} max={data.today} onChange={(e) => set("expenseDate", e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="amount">Amount (RM) *</label>
                <input id="amount" inputMode="decimal" className="input num text-right" placeholder="0.00" value={f.amount} onChange={(e) => set("amount", e.target.value.replace(/[^\d.]/g, ""))} />
              </div>
            </div>
            {mismatch ? (
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Amount mismatch detected. The receipt appears to show RM {(ocr!.totalSen! / 100).toFixed(2)}. Please review the claim amount against the supporting document.
              </div>
            ) : null}
            {dateMismatch ? <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">The receipt date appears to be {ocr!.docDate}. Please check the expense date.</div> : null}
            <div>
              <label className="label" htmlFor="category">Expense category *</label>
              <select id="category" className="input" value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
                <option value="">Choose…</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {cat?.guidance ? <div className="mt-1 text-xs text-gray-500">{cat.guidance}</div> : null}
            </div>
            <div>
              <label className="label" htmlFor="supplier">Merchant / supplier *</label>
              <input id="supplier" className="input" value={f.supplier} onChange={(e) => set("supplier", e.target.value)} autoComplete="off" />
            </div>
            <div>
              <label className="label" htmlFor="description">Description *</label>
              <input id="description" className="input" placeholder="What was bought / paid for" value={f.description} onChange={(e) => set("description", e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="purpose">Business purpose {cat?.requiresPurpose === false ? "" : "*"}</label>
              <input id="purpose" className="input" placeholder="Why the company needed this" value={f.businessPurpose} onChange={(e) => set("businessPurpose", e.target.value)} />
            </div>
            {cat?.requiresLocation ? (
              <div>
                <label className="label" htmlFor="location">Location / route *</label>
                <input id="location" className="input" placeholder="e.g. Sunway Pyramid car park / PJ → KL" value={f.location} onChange={(e) => set("location", e.target.value)} />
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="receiptNo">Receipt no.</label>
                <input id="receiptNo" className="input" value={f.receiptNo} onChange={(e) => set("receiptNo", e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="branch">Branch charged *</label>
                <select id="branch" className="input" value={f.branchId} onChange={(e) => set("branchId", e.target.value)}>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="label" htmlFor="pm">How did you pay?</label>
              <select id="pm" className="input" value={f.staffPaymentMethod} onChange={(e) => set("staffPaymentMethod", e.target.value)}>
                {settings.staffPaymentMethods.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={f.docIsReceipt} onChange={(e) => set("docIsReceipt", e.target.checked)} /> Receipt</label>
              <label className="flex items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={f.docIsEinvoice} onChange={(e) => set("docIsEinvoice", e.target.checked)} /> e-Invoice</label>
            </div>
          </section>

          {einvoice ? (
            <section className="card space-y-3 p-4">
              <div>
                <div className="font-semibold">e-Invoice information</div>
                <div className="text-xs text-gray-500">From {settings.einvoiceEffectiveDate.split("-").reverse().join("/")}. Fill in what is shown on the supplier&apos;s e-Invoice. Leave blank if not available — Finance will review.</div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {Object.entries(settings.einvoiceFields)
                  .filter(([, mode]) => mode !== "hidden")
                  .map(([k, mode]) => (
                    <div key={k}>
                      <label className="label" htmlFor={k}>{EINV_LABELS[k]}{mode === "required" ? " *" : ""}</label>
                      {k === "invoiceDate" ? (
                        <input id={k} type="date" className="input" value={f.invoiceDate} onChange={(e) => set("invoiceDate", e.target.value)} />
                      ) : k === "einvoiceStatus" ? (
                        <select id={k} className="input" value={f.einvoiceStatus} onChange={(e) => set("einvoiceStatus", e.target.value)}>
                          <option value="">Not sure</option>
                          <option value="VALIDATED">Validated (QR code / UUID shown)</option>
                          <option value="NOT_AVAILABLE">Supplier did not issue e-Invoice</option>
                          <option value="PENDING">Requested, not yet received</option>
                        </select>
                      ) : (
                        <input id={k} className="input" value={(f as unknown as Record<string, string>)[k]} onChange={(e) => set(k as keyof Form, e.target.value as never)} />
                      )}
                    </div>
                  ))}
              </div>
            </section>
          ) : null}

          <section className="card p-4">
            <label className="label" htmlFor="lremarks">Remarks (optional)</label>
            <textarea id="lremarks" className="input" rows={2} value={f.remarks} onChange={(e) => set("remarks", e.target.value)} />
          </section>

          {err ? <div className="whitespace-pre-line rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div> : null}
        </div>

        <div className="border-t border-gray-200 bg-white px-4 py-3 sm:rounded-b-2xl" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
          <button onClick={save} disabled={saving || uploading} className="btn-brand w-full py-3.5 text-base">{saving ? "Saving…" : "Save expense"}</button>
        </div>
      </div>

      {queue[0] ? <PageEditor key={`${queue[0].name}-${queue.length}`} file={queue[0]} onDone={onEdited} onCancel={() => setQueue((q) => q.slice(1))} /> : null}
    </div>
  );
}
