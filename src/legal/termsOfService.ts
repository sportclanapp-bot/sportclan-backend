/**
 * N-RWG2-15 (launch test plan) · SportClan's terms of service — ONE text for the
 * app's Terms of service screen and the server's /terms.html page.
 *
 * This file is byte-identical in both repos:
 *   app     src/legal/termsOfService.ts
 *   server  src/legal/termsOfService.ts
 * and the app's nRwg215TermsOneText test fails if they differ. Edit both, or
 * neither. The web page used to be a separate static file that still sold
 * Premium through Razorpay, with a 5-post monthly limit — none of which the app
 * has (SC-434: nothing is for sale).
 */
export type TermsSection = { label: string; paragraphs: string[] };

export const TERMS_OF_SERVICE: { title: string; effectiveDate: string; sections: TermsSection[] } = {
  title: 'Terms of service',
  effectiveDate: 'May 2026',
  sections: [
    {
      label: 'Your account',
      paragraphs: [
        'You’re responsible for what happens on your account. Keep your phone number current — it’s how we sign you in.',
        'You must be at least 13 to use SportClan. If you’re under 18, get a parent’s OK.',
      ],
    },
    {
      label: 'Content & behaviour',
      paragraphs: [
        'Be civil. No harassment, no hate speech, no doxxing, no sexual content. We remove posts and accounts that cross these lines.',
        'You own what you post. You give us a non-exclusive licence to display it inside SportClan.',
      ],
    },
    {
      label: 'Tournaments & scores',
      paragraphs: [
        'Scores you record are public. Tournaments you organise are visible to participants and (if you choose) the wider community.',
        'We don’t guarantee scores reflect official results — they reflect what you and your umpire/opponent entered.',
      ],
    },
    {
      label: 'Limits',
      paragraphs: [
        'We do our best to keep SportClan running, but we don’t promise it will always be available. Take backups of anything you really care about.',
        'We’re not liable for losses caused by use of the app beyond what local law requires.',
      ],
    },
    {
      label: 'Changes',
      paragraphs: [
        'We’ll notify you before any material change to these terms.',
      ],
    },
  ],
};
