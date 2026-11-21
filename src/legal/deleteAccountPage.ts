/**
 * Q5 (Dipak, 21 Nov 2026) · /delete-account.html — the "delete my account" web page Play asks
 * for (PLAY_LISTING.md §2/§4), on the backend's own pages until there is a domain. The words
 * follow the app's Delete account screen and the shared privacy policy: deletion is in the
 * app and immediate, the phone number is held 30 days, posts/messages/scores stay as
 * "Deleted User". No payments or premium exist, so there is nothing to cancel or refund.
 */
import { COMPANY_CSS, companyBlockHtml } from './companyDetails';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const DELETE_ACCOUNT_PAGE: { title: string; sections: { label: string; paragraphs: string[] }[] } = {
  title: 'Delete your SportClan account',
  sections: [
    {
      label: 'Delete it in the app',
      paragraphs: [
        'Open SportClan and sign in.',
        'Go to Profile → Settings → Delete account.',
        'Type DELETE, tap “Delete my account”, then confirm it’s you with your password or a sign-in code.',
        'Want a copy of your data first? Settings → Export my data gives you a file straight away.',
      ],
    },
    {
      label: 'What happens',
      paragraphs: [
        'Your account is deleted straight away. Your name, photo, bio, email, gender and date of birth are erased, your profile disappears from search and lists, and you are signed out everywhere.',
        'Your phone number is held for 30 days so nobody can sign back in to the account. After that it is erased, and the number can be used for a brand-new account with no link to this one.',
      ],
    },
    {
      label: 'What stays',
      paragraphs: [
        'Posts and messages you wrote stay, shown as “Deleted User”, so other people’s chats don’t change.',
        'Scores of matches you played stay, so other players’ results don’t change.',
        'Reviews you wrote about other players stay, shown as “Deleted User”.',
        'If you captain a team, the captaincy passes to another member.',
      ],
    },
    {
      label: 'Nothing to cancel',
      paragraphs: [
        'SportClan has no payments and no paid plans: there is nothing to cancel or refund. Coins can’t be bought and have no cash value; they go with the account.',
      ],
    },
    {
      label: 'Can’t open the app?',
      paragraphs: [
        'Ask us to delete it for you: write to the contact email under “Who runs SportClan” below with the phone number of the account. We delete it the same way as the app does.',
      ],
    },
  ],
};

export function deleteAccountHtml(): string {
  const sections = DELETE_ACCOUNT_PAGE.sections
    .map((s, i) => `  <h2>${i + 1}. ${esc(s.label)}</h2>\n${s.paragraphs.map((p) => `  <p>${esc(p)}</p>`).join('\n')}`)
    .join('\n\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(DELETE_ACCOUNT_PAGE.title)} — SportClan</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #F5F7FA; color: #212121; line-height: 1.7; }
  .header { background: linear-gradient(135deg, #0A1628, #1A3A5C, #1565C0); color: #fff; padding: 40px 20px; text-align: center; }
  .header h1 { font-size: 26px; font-weight: 800; margin-bottom: 6px; }
  .header p { font-size: 13px; opacity: 0.6; }
  .container { max-width: 720px; margin: 0 auto; padding: 24px 20px 60px; }
  h2 { font-size: 18px; font-weight: 800; color: #1A3A5C; margin: 28px 0 10px; }
  p { font-size: 14px; color: #424242; margin-bottom: 8px; }
${COMPANY_CSS}
</style>
</head>
<body>
<div class="header">
  <h1>${esc(DELETE_ACCOUNT_PAGE.title)}</h1>
  <p>SportClan &mdash; the same steps as in the app (Settings &rarr; Delete account).</p>
</div>
<div class="container">
${sections}

  <p><a href="/privacy-policy.html">Privacy policy</a></p>
${companyBlockHtml()}
</div>
</body>
</html>
`;
}
