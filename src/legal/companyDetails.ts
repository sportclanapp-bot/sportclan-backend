/**
 * Q5 (Dipak, 21 Nov 2026) · who runs SportClan, for the public web pages (privacy policy, terms,
 * delete my account). The company is not registered yet, so its details are a CLEARLY MARKED
 * placeholder on every page until Dipak fills them in (name, CIN, registered address, contact).
 * When the details are known: set COMPANY_DETAILS_PLACEHOLDER to false and fill in the lines.
 */
export const COMPANY_DETAILS_PLACEHOLDER = true;

export const COMPANY_LINES: string[] = [
  '[PLACEHOLDER — company not registered yet] SportClan ____________ Private Limited',
  '[PLACEHOLDER] CIN: ____________',
  '[PLACEHOLDER] Registered office: ____________, India',
  '[PLACEHOLDER] Contact email: ____________ (until then, use Settings → Send feedback in the app)',
];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The "Who runs SportClan" block every public page ends with. */
export function companyBlockHtml(): string {
  const note = COMPANY_DETAILS_PLACEHOLDER
    ? '\n  <p class="placeholder-note">These company details are a placeholder and will be filled in once the company is registered.</p>'
    : '';
  return `  <div class="company${COMPANY_DETAILS_PLACEHOLDER ? ' placeholder' : ''}">
  <h2>Who runs SportClan</h2>
${COMPANY_LINES.map((l) => `  <p>${esc(l)}</p>`).join('\n')}${note}
  </div>`;
}

/** Styles for the block (a dashed amber box while it is a placeholder). */
export const COMPANY_CSS = `  .company { margin-top: 36px; padding: 14px 16px; border-radius: 10px; background: #fff; }
  .company.placeholder { border: 2px dashed #F59E0B; background: #FFFBEB; }
  .placeholder-note { font-size: 12px; color: #92400E; font-weight: 700; }`;
