/**
 * F010 / F011 (launch test plan, Round 1) · SportClan's privacy policy — ONE text
 * for the app's Privacy policy screen and the server's /privacy-policy.html page.
 *
 * This file is byte-identical in both repos:
 *   app     src/legal/privacyPolicy.ts
 *   server  src/legal/privacyPolicy.ts
 * and the app's privacyPolicyParity test fails if they differ. Edit both, or
 * neither. The two used to be separate copies and both drifted from the app:
 * the screen said a deleted account is kept for 30 days (deletion is immediate),
 * and the web page promised an emailed export within 72 hours (the export is an
 * instant file in Settings) and named services the app doesn't use.
 */
export type PolicySection = { label: string; paragraphs: string[] };

export const PRIVACY_POLICY: { title: string; effectiveDate: string; sections: PolicySection[] } = {
  title: 'Privacy policy',
  effectiveDate: '14 October 2026',
  sections: [
    {
      label: 'What we collect',
      paragraphs: [
        'Your phone number (to sign you in with a code), name, username, date of birth, and anything else you choose to add: email, password, gender, city, bio, link, photo and your sports.',
        'What you do in SportClan: matches you play or score, teams and tournaments, posts, comments, messages, follows, gifts and coins.',
        'When and from which device you sign in (device model and app version), so you can see and end your sign-ins in Settings → Active sessions.',
        'Crash reports with basic device details (model, Android version), so we can fix bugs.',
      ],
    },
    {
      label: 'What we don’t collect or do',
      paragraphs: [
        'We don’t ask for your location, contacts, SMS or microphone. The camera is used only to read QR codes and take a photo you choose; nothing from it is recorded or uploaded except that photo.',
        'We don’t track you across other apps, we don’t sell your data, and there are no ads in SportClan.',
        'There are no payments: coins can’t be bought and have no cash value.',
      ],
    },
    {
      label: 'Who sees what',
      paragraphs: [
        'Your profile (name, username, photo, bio, sports and public stats) can be seen by anyone using SportClan.',
        'Your phone number is never shown to other people. Your date of birth stays hidden unless you turn on “Show date of birth”.',
        'Messages and group chats are seen only by the people in them.',
        'You can make your profile private, choose who may message you or tag you, and block people (Settings → Privacy, Settings → Blocklist).',
      ],
    },
    {
      label: 'Who processes it for us',
      paragraphs: [
        'Render (runs our server), Supabase (stores the database), Cloudflare R2 (stores photos), Sentry (crash reports), Expo and Firebase (push notifications) and 2Factor (sends sign-in codes by SMS). They process data only to provide these services to SportClan.',
      ],
    },
    {
      label: 'Your controls',
      paragraphs: [
        'Change your details any time in Profile → Edit profile.',
        'Settings → Export my data gives you a file with everything we hold about you, straight away.',
        'Settings → Delete account deletes your account straight away. Your name, photo, bio, email, gender and date of birth are erased and you are signed out everywhere. Your posts, messages and match scores stay, shown as “Deleted User”, so other people’s chats and results don’t change. Your phone number is held for 30 days so nobody can sign back in to the account; after that it is erased and can be used for a brand-new account.',
      ],
    },
    {
      label: 'Contact',
      paragraphs: [
        'Questions about your data: Settings → Send feedback in the app.',
      ],
    },
  ],
};
