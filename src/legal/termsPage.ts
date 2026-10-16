/**
 * N-RWG2-15 (launch test plan) · /terms.html built from the same text as the
 * app's Terms of service screen (src/legal/termsOfService.ts, byte-identical in
 * both repos), as F011 did for /privacy-policy.html. The page used to be a
 * separate static file that still described paid Premium through Razorpay and a
 * 5-post monthly limit, which the app no longer has.
 */
import { TERMS_OF_SERVICE } from './termsOfService';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function termsOfServiceHtml(): string {
  const sections = TERMS_OF_SERVICE.sections
    .map((s, i) => `  <h2>${i + 1}. ${esc(s.label)}</h2>\n${s.paragraphs.map((p) => `  <p>${esc(p)}</p>`).join('\n')}`)
    .join('\n\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(TERMS_OF_SERVICE.title)} — SportClan</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #F5F7FA; color: #212121; line-height: 1.7; }
  .header { background: linear-gradient(135deg, #0A1628, #1A3A5C, #1565C0); color: #fff; padding: 40px 20px; text-align: center; }
  .header h1 { font-size: 28px; font-weight: 800; margin-bottom: 6px; }
  .header p { font-size: 13px; opacity: 0.6; }
  .container { max-width: 720px; margin: 0 auto; padding: 24px 20px 60px; }
  .updated { font-size: 12px; color: #757575; margin-bottom: 24px; }
  h2 { font-size: 18px; font-weight: 800; color: #1A3A5C; margin: 28px 0 10px; }
  p { font-size: 14px; color: #424242; margin-bottom: 8px; }
  a { color: #1565C0; }
</style>
</head>
<body>
<div class="header">
  <h1>${esc(TERMS_OF_SERVICE.title)}</h1>
  <p>SportClan &mdash; the same terms as in the app (Settings &rarr; Terms of service).</p>
</div>
<div class="container">
  <p class="updated">Effective ${esc(TERMS_OF_SERVICE.effectiveDate)}</p>

${sections}

  <p>How we handle your data: <a href="/privacy-policy.html">Privacy policy</a>.</p>
</div>
</body>
</html>
`;
}
