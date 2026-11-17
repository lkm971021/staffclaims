import sharp from "sharp";
const svg = (pad: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
<rect width="512" height="512" rx="${pad ? 0 : 96}" fill="#1c1f26"/>
<g transform="translate(${256 - (256 - pad) * 0.62}, ${256 - (256 - pad) * 0.7}) scale(${(512 - pad * 2) / 512 * 1.24})">
<path d="M40 20h170l50 50v270l-30-18-30 18-30-18-30 18-30-18-30 18-30-18-30 18z" fill="#fff"/>
<path d="M210 20v50h50" fill="#e5e7eb"/>
<rect x="72" y="100" width="140" height="16" rx="8" fill="#c99a2e"/>
<rect x="72" y="140" width="110" height="12" rx="6" fill="#9ca3af"/>
<rect x="72" y="172" width="130" height="12" rx="6" fill="#9ca3af"/>
<rect x="72" y="224" width="140" height="22" rx="8" fill="#1c1f26"/>
</g></svg>`;
(async () => {
  await sharp(Buffer.from(svg(0))).resize(192).png().toFile("public/icons/icon-192.png");
  await sharp(Buffer.from(svg(0))).resize(512).png().toFile("public/icons/icon-512.png");
  await sharp(Buffer.from(svg(70))).resize(512).png().toFile("public/icons/icon-512-maskable.png");
  await sharp(Buffer.from(svg(0))).resize(180).png().toFile("public/icons/apple-touch-icon.png");
  await sharp(Buffer.from(svg(0))).resize(32).png().toFile("public/favicon.png");
})();
