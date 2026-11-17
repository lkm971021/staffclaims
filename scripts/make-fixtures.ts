import sharp from "sharp";
import { promises as fs } from "fs";
/** Generates DUMMY receipt images for automated tests (clearly marked as test data). */
async function receipt(file: string, shop: string, no: string, date: string, total: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="100%" height="100%" fill="#fbfaf5"/>
  <text x="300" y="70" font-size="30" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold">${shop}</text>
  <text x="300" y="105" font-size="16" text-anchor="middle" font-family="DejaVu Sans">TEST RECEIPT - NOT A REAL DOCUMENT</text>
  <text x="40" y="170" font-size="20" font-family="DejaVu Sans">Receipt No: ${no}</text>
  <text x="40" y="205" font-size="20" font-family="DejaVu Sans">Date: ${date}</text>
  <text x="40" y="280" font-size="20" font-family="DejaVu Sans">Parking 2 hours</text><text x="560" y="280" font-size="20" text-anchor="end" font-family="DejaVu Sans">${total}</text>
  <line x1="40" y1="320" x2="560" y2="320" stroke="#333"/>
  <text x="40" y="370" font-size="26" font-family="DejaVu Sans" font-weight="bold">TOTAL RM</text><text x="560" y="370" font-size="26" text-anchor="end" font-family="DejaVu Sans" font-weight="bold">${total}</text>
  </svg>`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toFile(file);
}
(async () => {
  await fs.mkdir("tests/fixtures", { recursive: true });
  await receipt("tests/fixtures/receipt-a.jpg", "DEMO PARKING SDN BHD", "P-10293", "12/10/2026", "85.00");
  await receipt("tests/fixtures/receipt-b.jpg", "DEMO STATIONERY ENTERPRISE", "INV-5521", "14/10/2026", "42.50");
  await receipt("tests/fixtures/receipt-c.jpg", "DEMO HARDWARE TRADING", "HW-7781", "20/10/2026", "120.00");
  console.log("fixtures written");
})();
