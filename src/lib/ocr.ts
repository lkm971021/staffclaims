import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { parseToSen } from "./money";

/**
 * Receipt / invoice OCR using Claude vision with a strict JSON schema.
 * Results are SUGGESTIONS ONLY: staff confirm every field and Finance remains responsible
 * for verification. The raw result is stored unchanged (OcrResult.raw) for Finance to compare.
 *
 * Config: ANTHROPIC_API_KEY (required to enable), OCR_MODEL (default claude-opus-5-5),
 * OCR_EFFORT (default "low" - simple extraction; raise to "medium" if accuracy needs it).
 */
export const OCR_MODEL = process.env.OCR_MODEL || "claude-opus-5-5";
const EFFORT = (process.env.OCR_EFFORT as "low" | "medium" | "high" | undefined) || "low";

export const ocrAvailable = () => Boolean(process.env.ANTHROPIC_API_KEY);

const ReceiptSchema = z.object({
  is_receipt_or_invoice: z.boolean().describe("false if the image is not a receipt/invoice (e.g. a payment screenshot only)"),
  document_type: z.enum(["receipt", "tax_invoice", "e_invoice", "invoice", "payment_proof_only", "other"]),
  legible: z.boolean().describe("false if the document is too blurry/cropped to read reliably"),
  appears_complete: z.boolean().describe("false if parts of the document (e.g. totals, top or bottom) appear cut off"),
  supplier_name: z.string().nullable(),
  supplier_brn: z.string().nullable().describe("Business registration number, e.g. 202301051828 or 1545742-H"),
  supplier_tin: z.string().nullable().describe("Tax identification number, e.g. C12345678090"),
  supplier_sst_no: z.string().nullable(),
  receipt_or_invoice_no: z.string().nullable(),
  document_date: z.string().nullable().describe("YYYY-MM-DD"),
  description: z.string().nullable().describe("Short summary of items/services purchased, max 100 chars"),
  currency: z.string().nullable().describe("ISO code, usually MYR"),
  subtotal: z.string().nullable().describe("Amount before tax as shown, digits and dot only, e.g. 232.00"),
  tax_amount: z.string().nullable().describe("SST/tax amount as shown, e.g. 18.56"),
  total_amount: z.string().nullable().describe("Final total paid, e.g. 250.56"),
  einvoice_uuid: z.string().nullable().describe("MyInvois e-Invoice UUID / validation ID if printed"),
  confidence: z.number().describe("0 to 1 overall confidence in the extracted total and date"),
  notes: z.string().nullable().describe("Anything Finance should know (handwritten changes, multiple receipts, etc.)"),
});
export type ReceiptExtraction = z.infer<typeof ReceiptSchema>;

const SYSTEM = `You extract data from Malaysian receipts, tax invoices and e-Invoices for a staff expense claim system.
Read only what is printed or handwritten on the document; never guess or invent values. Use null when a field is absent or unreadable.
Dates: Malaysian documents usually print day before month (dd/mm/yyyy). Return YYYY-MM-DD.
Amounts: return the figures exactly as printed, without currency symbols or thousands separators.
If the image only shows a bank/e-wallet transfer or payment screenshot, set document_type to "payment_proof_only".`;

export interface OcrOutcome {
  engine: string;
  data: ReceiptExtraction | null;
  error: string | null;
  normalised: {
    supplier: string | null;
    supplierBrn: string | null;
    supplierTin: string | null;
    supplierSst: string | null;
    receiptNo: string | null;
    docDate: string | null;
    subtotalSen: number | null;
    taxSen: number | null;
    totalSen: number | null;
    currency: string | null;
    description: string | null;
    legible: boolean | null;
    confidence: number | null;
  };
}

const EMPTY: OcrOutcome["normalised"] = {
  supplier: null, supplierBrn: null, supplierTin: null, supplierSst: null, receiptNo: null, docDate: null,
  subtotalSen: null, taxSen: null, totalSen: null, currency: null, description: null, legible: null, confidence: null,
};

let client: Anthropic | null = null;

/** input: JPEG bytes of a receipt image, or PDF bytes. */
export async function extractReceipt(input: { jpeg?: Buffer; pdf?: Buffer }): Promise<OcrOutcome> {
  const engine = `claude:${OCR_MODEL}`;
  if (!ocrAvailable()) return { engine, data: null, error: "OCR not configured (ANTHROPIC_API_KEY not set)", normalised: EMPTY };
  client ??= new Anthropic({ maxRetries: 2, timeout: 90_000 });
  const media: Anthropic.Beta.BetaContentBlockParam = input.pdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: input.pdf.toString("base64") } }
    : { type: "image", source: { type: "base64", media_type: "image/jpeg", data: input.jpeg!.toString("base64") } };
  try {
    const res = await client.beta.messages.parse({
      model: OCR_MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      // Server-side refusal fallback: if the model declines a document, the API retries on its default fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: EFFORT, format: betaZodOutputFormat(ReceiptSchema) },
      messages: [{ role: "user", content: [media, { type: "text", text: "Extract the receipt / invoice details." }] }],
    });
    if (res.stop_reason === "refusal") return { engine, data: null, error: "OCR declined this document", normalised: EMPTY };
    const d = res.parsed_output;
    if (!d) return { engine, data: null, error: "OCR returned no structured result", normalised: EMPTY };
    const date = d.document_date && /^\d{4}-\d{2}-\d{2}$/.test(d.document_date) ? d.document_date : null;
    return {
      engine,
      data: d,
      error: null,
      normalised: {
        supplier: d.supplier_name,
        supplierBrn: d.supplier_brn,
        supplierTin: d.supplier_tin,
        supplierSst: d.supplier_sst_no,
        receiptNo: d.receipt_or_invoice_no,
        docDate: date,
        subtotalSen: parseToSen(d.subtotal),
        taxSen: parseToSen(d.tax_amount),
        totalSen: parseToSen(d.total_amount),
        currency: d.currency,
        description: d.description,
        legible: d.legible,
        confidence: d.confidence,
      },
    };
  } catch (e) {
    let msg = "OCR failed";
    if (e instanceof Anthropic.RateLimitError) msg = "OCR busy (rate limited) - please fill in manually or retry";
    else if (e instanceof Anthropic.AuthenticationError) msg = "OCR API key invalid";
    else if (e instanceof Anthropic.APIConnectionError) msg = "OCR service unreachable";
    else if (e instanceof Anthropic.APIError) msg = `OCR error ${e.status ?? ""}`.trim();
    console.error("[ocr]", e);
    return { engine, data: null, error: msg, normalised: EMPTY };
  }
}
