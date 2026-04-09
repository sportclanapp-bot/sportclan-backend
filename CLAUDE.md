# SportClan — Project Context for Claude Code

## What this project is
SportClan is a multi-sport community app for India. React Native Expo TypeScript frontend. Node.js Express TypeScript backend. Targets Android (primary) and iOS.

## Folder structure
- ~/sportclan/ — React Native Expo app (this folder)
- ~/sportclan-backend/ — Express TypeScript backend
- ~/sportclan/*.html — 9 design files (read these for UI reference)

## Tech stack
Frontend: React Native Expo (TypeScript), React Navigation, Zustand, Axios, MMKV, expo-notifications, expo-image, @react-native-firebase/app
Backend: Node.js Express TypeScript, Supabase (PostgreSQL), JWT auth, Bcrypt, Nodemailer
Database: Supabase (31 tables when complete)
Storage: Cloudflare R2 (images/media)
Payments: Razorpay (Android), Apple IAP (iOS)
Push: Firebase Cloud Messaging
Crash tracking: Sentry
Deep links: Branch.io
Deployments: Railway (backend), EAS Build (app)

## Design files (read these for screen designs)
- SportClan_Design_File1_Auth_Home_Profile.html — 22 screens (auth + home + profile)
- SportClan_File2_Cricket_Module.html — 18 screens (cricket)
- SportClan_File3_Other10Sports.html — 19 screens (other sports)
- SportClan_File4_Community_Chat_Search.html — 16 screens (community + chat + search)
- SportClan_File5_Rewards_Payments_Settings.html — 14 screens (payments + settings)
- SportClan_File6A_MissingScreens_Part1.html — 18 additional screens
- SportClan_File6B_MissingScreens_Part2.html — 18 additional screens
- SportClan_File7_FinalCleanup_100Percent.html — 11 final screens

## 9 confirmed design changes (CRITICAL — always apply these)
1. NO device fingerprint tracking anywhere in the app
2. NO OTP lockout — users can retry freely within 5-minute window
3. NO password reuse prevention — no password history check
4. Profile photos: NO size limit — server compresses automatically, no circular crop
5. Commentator role requires Premium subscription
6. Tournament CREATION requires Premium — but match creation and team creation are FREE for all
7. Gift catalogue has ALL 10 PRD gifts: 🏆15c 🥈10c 🥇12c 🎖️8c ⭐10c 💐5c 🌟12c 👏5c 🔥5c 👑8c
8. Home screen avatar = 40px rounded square with borderRadius 11 (NOT circular)
9. Sports grid = 4 columns (NOT 3)

## Code standards
- All TypeScript — no .js files
- StyleSheet.create() for all React Native styles
- No inline styles except where absolutely necessary
- Zustand for all global state
- Axios for all API calls (via src/api/axiosClient.ts)
- All API base URL from EXPO_PUBLIC_API_URL env variable
- src/screens/ — all screens
- src/components/ — reusable components
- src/api/ — all API functions
- src/hooks/ — custom hooks
- src/stores/ — Zustand stores
- src/utils/ — utility functions
- src/navigation/ — navigation files

## What has been built so far
[UPDATE THIS SECTION AFTER EACH PART]
- Part 1: Foundation + accounts complete. Both projects exist, .env files filled, app on phone.
- Part 4: Full match + tournament system. All 11 sport scoring screens built (Cricket at full fidelity). Teams, tournaments, fixtures, leaderboard, match sharing, umpire assignment, squad lock. Tournament creation requires Premium (Change #6).

## Environment variables
All secrets are in .env files. Never hardcode any key. All frontend env vars use EXPO_PUBLIC_ prefix.

## When you finish each task
Always: git add . && git commit -m "message" && git push
For backend changes: also push to Railway via git push (auto-deploys)
For app changes that need a rebuild: note it — don't run eas build automatically