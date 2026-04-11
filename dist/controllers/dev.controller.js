"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadTestData = void 0;
const supabase_1 = require("../utils/supabase");
// POST /dev/load-test-data
//
// Comprehensive test data seeder. Creates 50 users, 22 teams, 55 tournaments,
// ~385 matches, 30 posts, 20 notifications, 10 gifts — all linked together.
//
// Auth is required (any logged-in user can trigger it). The frontend gates the
// button behind __DEV__. REMOVE THIS ROUTE before final Store submission.
// ────────────────────────────────────────────────────────────────────────────
// Seed data
// ────────────────────────────────────────────────────────────────────────────
const INDIAN_FIRST_NAMES = [
    'Rahul', 'Priya', 'Arjun', 'Sneha', 'Vikram', 'Ananya', 'Rohit', 'Kavya',
    'Aditya', 'Ishita', 'Karan', 'Pooja', 'Varun', 'Riya', 'Dev', 'Neha',
    'Aryan', 'Sanya', 'Kabir', 'Tanvi', 'Siddharth', 'Meera', 'Nikhil', 'Aisha',
    'Raj', 'Diya', 'Vishal', 'Zara', 'Manish', 'Kiara', 'Ravi', 'Nisha',
    'Akash', 'Aditi', 'Harsh', 'Divya', 'Yash', 'Shreya', 'Rohan', 'Isha',
    'Nitin', 'Simran', 'Abhay', 'Maya', 'Jatin', 'Payal', 'Abhishek', 'Sana',
    'Gautam', 'Lakshmi',
];
const LAST_INITIALS = ['S', 'K', 'P', 'G', 'M', 'T', 'R', 'D', 'B', 'N'];
const CITY_NAMES = [
    'Mumbai', 'Pune', 'Delhi', 'Bengaluru', 'Chennai',
    'Hyderabad', 'Kolkata', 'Ahmedabad', 'Jaipur', 'Surat',
];
const SPORT_NAMES = [
    'Cricket', 'Badminton', 'Football', 'Tennis', 'Table Tennis',
    'Pickleball', 'Chess', 'Carrom', 'Volleyball', 'Basketball', 'Hockey',
];
// Missing sports to backfill (Pickleball and Carrom are not in the default seed)
const MISSING_SPORTS = [
    { name: 'Pickleball', slug: 'pickleball', emoji: '\uD83E\uDD52', color: '#065F46', display_order: 12 },
    { name: 'Carrom', slug: 'carrom', emoji: '\uD83C\uDFAF', color: '#5B21B6', display_order: 13 },
];
const TEAM_DATA = {
    Cricket: ['Mumbai Strikers', 'Delhi Kings'],
    Badminton: ['Pune Shuttlers', 'Chennai Smashers'],
    Football: ['Bengaluru FC Youth', 'Hyderabad United'],
    Tennis: ['Kolkata Aces', 'Delhi Baseline'],
    'Table Tennis': ['Mumbai Spinners', 'Pune Choppers'],
    Pickleball: ['Bengaluru Dinkers', 'Chennai Bangers'],
    Chess: ['Delhi Grandmasters', 'Mumbai Knights'],
    Carrom: ['Kolkata Strikers', 'Pune Potters'],
    Volleyball: ['Hyderabad Spikes', 'Chennai Blockers'],
    Basketball: ['Mumbai Hoops', 'Delhi Dunkers'],
    Hockey: ['Punjab Lions', 'Odisha Warriors'],
};
const BIOS = [
    'Weekend cricket enthusiast \u00B7 Looking for match partners',
    'Badminton player \u00B7 State level \u00B7 Love doubles',
    'Football coach \u00B7 10 years experience',
    'Tennis pro \u00B7 Available for coaching',
    'Chess master \u00B7 Love a good game',
    'Sports lover \u00B7 Available weekends',
    'Tournament organizer \u00B7 DM for collabs',
    'All-rounder \u00B7 Cricket + Badminton',
    'Looking for a team to join',
    'Ex-state player \u00B7 Now coaching youth',
];
const POSTS = [
    { content: 'Looking for a 4th player for weekend cricket! DM me if interested \uD83C\uDFCF', type: 'Player' },
    { content: 'Just finished an amazing badminton session. Who wants to join next time?', type: 'Player' },
    { content: 'Great match today! Final score 145/6 vs 89/2. What a finish!', type: 'Match' },
    { content: 'Any umpires available for Sunday morning tournament?', type: 'Umpire-Referee' },
    { content: 'New football tournament open for registration. 16 team slots available.', type: 'Tournament' },
    { content: 'Tennis coaching available every weekend. Ages 10-18.', type: 'Player' },
    { content: 'Who\'s up for 3-on-3 basketball this Saturday?', type: 'Player' },
    { content: 'Chess club meeting this Friday 6 PM. Beginners welcome!', type: 'Player' },
    { content: 'Volleyball team looking for 2 strong hitters. Practice twice a week.', type: 'Player' },
    { content: 'Match report: Our team won the semifinals! Ready for the finals this weekend \uD83C\uDFC6', type: 'Match' },
    { content: 'Table tennis tournament registration closes tomorrow. Hurry up!', type: 'Tournament' },
    { content: 'Need a doubles partner for mixed badminton. Any takers?', type: 'Player' },
    { content: 'Announcing the Summer Premier Cricket League 2026! Registration open.', type: 'Tournament' },
    { content: 'Hockey practice this evening at 5 PM. Bring water and energy!', type: 'Player' },
    { content: 'Big win today! Thanks to the team for an incredible game \uD83D\uDCAA', type: 'Match' },
    { content: 'Looking for a pickleball partner. Intermediate level preferred.', type: 'Player' },
    { content: 'Carrom tournament this weekend. Entry fee only \u20B9100.', type: 'Tournament' },
    { content: 'Lost my first match but learned so much. Onwards and upwards!', type: 'Match' },
    { content: 'Anyone need an umpire this weekend? Available both days.', type: 'Umpire-Referee' },
    { content: 'New football pitch opened near Koramangala. Great turf!', type: 'Other' },
    { content: 'Who plays at the Powai ground on Sundays? Let\'s connect.', type: 'Player' },
    { content: 'Free cricket coaching for kids under 12 this Saturday.', type: 'Other' },
    { content: 'Tennis ladder match results: congrats to everyone who played!', type: 'Match' },
    { content: 'Scoreboard updated for all Sunday matches. Check the app!', type: 'Match' },
    { content: 'Premier Tennis Masters starting next week. Signups closing soon!', type: 'Tournament' },
    { content: 'Badminton singles tournament Feb 28. Limited slots.', type: 'Tournament' },
    { content: 'Looking for a team to join for the upcoming Cricket league.', type: 'Player' },
    { content: 'Great umpiring at the match today. Clean and fair calls throughout.', type: 'Umpire-Referee' },
    { content: 'Weekend cricket — who\'s in? Mumbai area, T20 format.', type: 'Player' },
    { content: 'Basketball pickup game every Wednesday 7 PM. All skill levels.', type: 'Player' },
];
const GIFT_CATALOGUE = [
    { gift_id: 'gold_trophy', gift_emoji: '\uD83C\uDFC6', gift_name: 'Gold Trophy', coin_cost: 15 },
    { gift_id: 'silver_trophy', gift_emoji: '\uD83E\uDD48', gift_name: 'Silver Trophy', coin_cost: 10 },
    { gift_id: 'gold_medal', gift_emoji: '\uD83E\uDD47', gift_name: 'Gold Medal', coin_cost: 12 },
    { gift_id: 'silver_medal', gift_emoji: '\uD83C\uDF96\uFE0F', gift_name: 'Silver Medal', coin_cost: 8 },
    { gift_id: 'best_player', gift_emoji: '\u2B50', gift_name: 'Best Player', coin_cost: 10 },
    { gift_id: 'flowers', gift_emoji: '\uD83D\uDC90', gift_name: 'Flowers', coin_cost: 5 },
    { gift_id: 'star_player', gift_emoji: '\uD83C\uDF1F', gift_name: 'Star Player', coin_cost: 12 },
    { gift_id: 'appreciation', gift_emoji: '\uD83D\uDC4F', gift_name: 'Appreciation', coin_cost: 5 },
    { gift_id: 'fire', gift_emoji: '\uD83D\uDD25', gift_name: 'Fire', coin_cost: 5 },
    { gift_id: 'crown', gift_emoji: '\uD83D\uDC51', gift_name: 'Crown', coin_cost: 8 },
];
// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
function rand(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}
function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
function makeScoreSample(sportName) {
    switch (sportName) {
        case 'Cricket':
            return {
                team_a: `${randInt(120, 200)}/${randInt(3, 8)}`,
                team_b: `${randInt(80, 190)}/${randInt(2, 7)}`,
                overs_a: '20.0', overs_b: '20.0',
            };
        case 'Football':
            return { team_a: randInt(0, 5), team_b: randInt(0, 5) };
        case 'Badminton':
            return { team_a: [21, 18, 21], team_b: [18, 21, 19] };
        case 'Tennis':
            return { team_a: [6, 4, 7], team_b: [3, 6, 5] };
        case 'Table Tennis':
            return { team_a: [11, 9, 11, 11], team_b: [8, 11, 9, 7] };
        case 'Chess':
            return { result: ['1-0', '0-1', '1/2-1/2'][randInt(0, 2)] };
        case 'Volleyball':
            return { team_a: [25, 23, 25], team_b: [20, 25, 19] };
        case 'Basketball':
            return { team_a: randInt(60, 110), team_b: randInt(55, 105) };
        case 'Hockey':
            return { team_a: randInt(0, 6), team_b: randInt(0, 6) };
        case 'Pickleball':
            return { team_a: [11, 9, 11], team_b: [8, 11, 7] };
        case 'Carrom':
            return { team_a: randInt(15, 25), team_b: randInt(10, 24) };
        default:
            return { team_a: randInt(0, 10), team_b: randInt(0, 10) };
    }
}
// ────────────────────────────────────────────────────────────────────────────
// Handler
// ────────────────────────────────────────────────────────────────────────────
async function loadTestData(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    const summary = {
        users_created: 0,
        users_skipped: 0,
        user_sports_created: 0,
        sport_profiles_created: 0,
        teams_created: 0,
        team_members_created: 0,
        tournaments_created: 0,
        matches_created: 0,
        posts_created: 0,
        notifications_created: 0,
        gifts_created: 0,
        sports_backfilled: 0,
    };
    try {
        // ── STEP 1: Ensure all 11 sports exist ─────────────────────────────
        const { data: existingSports } = await supabase_1.supabase.from('sports').select('id, name');
        const sportsByName = new Map();
        for (const s of existingSports ?? [])
            sportsByName.set(s.name.toLowerCase(), s.id);
        const missingToInsert = MISSING_SPORTS.filter((s) => !sportsByName.has(s.name.toLowerCase()));
        if (missingToInsert.length > 0) {
            const { data: inserted } = await supabase_1.supabase
                .from('sports')
                .insert(missingToInsert)
                .select('id, name');
            for (const s of inserted ?? [])
                sportsByName.set(s.name.toLowerCase(), s.id);
            summary.sports_backfilled = inserted?.length ?? 0;
        }
        // ── STEP 2: Load target cities ─────────────────────────────────────
        const { data: allCities } = await supabase_1.supabase
            .from('cities')
            .select('id, name')
            .in('name', CITY_NAMES);
        const citiesByName = new Map();
        for (const c of allCities ?? [])
            citiesByName.set(c.name, c.id);
        const anyCity = allCities?.[0]?.id ?? null;
        // ── STEP 3: Create 50 test users ───────────────────────────────────
        const NUM_USERS = 50;
        const userRowsToCreate = [];
        for (let i = 1; i <= NUM_USERS; i++) {
            const firstName = INDIAN_FIRST_NAMES[(i - 1) % INDIAN_FIRST_NAMES.length];
            const lastInitial = LAST_INITIALS[(i - 1) % LAST_INITIALS.length];
            const cityName = CITY_NAMES[(i - 1) % CITY_NAMES.length];
            const cityId = citiesByName.get(cityName) ?? anyCity;
            let accountType = 'Player';
            if (i > 40 && i <= 45)
                accountType = 'Umpire';
            else if (i > 45 && i <= 48)
                accountType = 'Coach';
            else if (i > 48)
                accountType = 'Business';
            userRowsToCreate.push({
                phone: `+91dummy${String(i).padStart(3, '0')}`,
                name: `${firstName} ${lastInitial}.`,
                username: `sportclan_test${String(i).padStart(2, '0')}`,
                email: `test${i}@sportclan.test`,
                city_id: cityId,
                account_type: accountType,
                bio: rand(BIOS),
                is_premium: i <= 20,
                coin_balance: randInt(50, 500),
                premium_expires_at: i <= 20
                    ? new Date(Date.now() + 90 * 86400000).toISOString()
                    : null,
            });
        }
        // Check for existing test users by phone (idempotent re-runs)
        const phones = userRowsToCreate.map((u) => u.phone);
        const { data: existingUsers } = await supabase_1.supabase
            .from('users')
            .select('id, phone')
            .in('phone', phones);
        const existingByPhone = new Map();
        for (const u of existingUsers ?? [])
            existingByPhone.set(u.phone, u.id);
        const newUserRows = userRowsToCreate.filter((u) => !existingByPhone.has(u.phone));
        summary.users_skipped = userRowsToCreate.length - newUserRows.length;
        if (newUserRows.length > 0) {
            const { data: inserted } = await supabase_1.supabase
                .from('users')
                .insert(newUserRows)
                .select('id, phone');
            summary.users_created = inserted?.length ?? 0;
            for (const u of inserted ?? [])
                existingByPhone.set(u.phone, u.id);
        }
        const allTestUserIds = userRowsToCreate
            .map((u) => existingByPhone.get(u.phone))
            .filter((id) => !!id);
        // ── STEP 4: Assign 1-3 sports per test user + create sport profiles ─
        const sportIds = Array.from(sportsByName.values());
        const userSportRows = [];
        const sportProfileRows = [];
        for (const uid of allTestUserIds) {
            const count = randInt(1, 3);
            const picked = shuffle(sportIds).slice(0, count);
            for (const sid of picked) {
                userSportRows.push({ user_id: uid, sport_id: sid });
                const matchesPlayed = randInt(5, 50);
                const wins = randInt(2, Math.max(2, Math.floor(matchesPlayed * 0.6)));
                const losses = Math.max(0, matchesPlayed - wins - 1);
                sportProfileRows.push({
                    user_id: uid,
                    sport_id: sid,
                    rating: randInt(800, 1600),
                    matches_played: matchesPlayed,
                    wins,
                    losses,
                    draws: Math.max(0, matchesPlayed - wins - losses),
                    last_match_at: new Date(Date.now() - randInt(1, 30) * 86400000).toISOString(),
                });
            }
        }
        if (userSportRows.length > 0) {
            const { data } = await supabase_1.supabase
                .from('user_sports')
                .upsert(userSportRows, { onConflict: 'user_id,sport_id', ignoreDuplicates: true })
                .select('id');
            summary.user_sports_created = data?.length ?? 0;
        }
        if (sportProfileRows.length > 0) {
            const { data } = await supabase_1.supabase
                .from('user_sport_profiles')
                .upsert(sportProfileRows, { onConflict: 'user_id,sport_id', ignoreDuplicates: true })
                .select('id');
            summary.sport_profiles_created = data?.length ?? 0;
        }
        // ── STEP 5: Create 22 teams (2 per sport) ──────────────────────────
        const teamRowsToInsert = [];
        for (const sportName of SPORT_NAMES) {
            const sid = sportsByName.get(sportName.toLowerCase());
            const names = TEAM_DATA[sportName];
            if (!sid || !names)
                continue;
            for (const teamName of names) {
                teamRowsToInsert.push({
                    sport_id: sid,
                    name: teamName,
                    city_id: anyCity,
                    created_by: userId,
                    is_public: true,
                });
            }
        }
        // Query existing teams by name (teams table has no unique constraint on name)
        const targetTeamNames = teamRowsToInsert.map((t) => t.name);
        const { data: existingTeamsRows } = await supabase_1.supabase
            .from('teams')
            .select('id, name, sport_id')
            .in('name', targetTeamNames);
        const existingTeamNames = new Set((existingTeamsRows ?? []).map((t) => t.name));
        const newTeamRows = teamRowsToInsert.filter((t) => !existingTeamNames.has(t.name));
        if (newTeamRows.length > 0) {
            const { data } = await supabase_1.supabase
                .from('teams')
                .insert(newTeamRows)
                .select('id, name, sport_id');
            summary.teams_created = data?.length ?? 0;
        }
        // Re-fetch ALL target teams (existing + newly created)
        const { data: allTargetTeams } = await supabase_1.supabase
            .from('teams')
            .select('id, name, sport_id')
            .in('name', targetTeamNames);
        const teamRecords = allTargetTeams ?? [];
        // Group teams by sport for tournament/match generation
        const teamsBySport = new Map();
        for (const t of teamRecords) {
            const arr = teamsBySport.get(t.sport_id) ?? [];
            arr.push({ id: t.id, name: t.name });
            teamsBySport.set(t.sport_id, arr);
        }
        // ── STEP 6: Add 5 members to each team ─────────────────────────────
        const teamMemberRows = [];
        if (allTestUserIds.length >= 5) {
            for (const team of teamRecords) {
                const picked = shuffle(allTestUserIds).slice(0, 5);
                picked.forEach((uid, idx) => {
                    teamMemberRows.push({
                        team_id: team.id,
                        user_id: uid,
                        role: idx === 0 ? 'captain' : 'player',
                        jersey_number: idx + 1,
                    });
                });
            }
        }
        if (teamMemberRows.length > 0) {
            const { data } = await supabase_1.supabase
                .from('team_members')
                .upsert(teamMemberRows, { onConflict: 'team_id,user_id', ignoreDuplicates: true })
                .select('id');
            summary.team_members_created = data?.length ?? 0;
        }
        // ── STEP 7: Create 55 tournaments (5 per sport) ────────────────────
        const now = Date.now();
        const day = 86400000;
        const tournamentRowsToInsert = [];
        const tournamentConfigs = [
            { status: 'completed', startOffset: -45, endOffset: -30, prefix: 'Spring' },
            { status: 'live', startOffset: -7, endOffset: 25, prefix: 'Summer' },
            { status: 'live', startOffset: -3, endOffset: 30, prefix: 'Premier' },
            { status: 'upcoming', startOffset: 7, endOffset: 30, prefix: 'Winter' },
            { status: 'upcoming', startOffset: 14, endOffset: 45, prefix: 'Championship' },
        ];
        for (const sportName of SPORT_NAMES) {
            const sid = sportsByName.get(sportName.toLowerCase());
            if (!sid)
                continue;
            for (const cfg of tournamentConfigs) {
                const entryCode = `${sportName.slice(0, 3).toUpperCase()}${cfg.prefix.slice(0, 3).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
                tournamentRowsToInsert.push({
                    sport_id: sid,
                    name: `${cfg.prefix} ${sportName} Cup 2026`,
                    description: `Open ${sportName} tournament \u2014 all levels welcome`,
                    format: 'knockout',
                    city_id: anyCity,
                    venue: `${rand(CITY_NAMES)} Sports Complex`,
                    start_date: new Date(now + cfg.startOffset * day).toISOString(),
                    end_date: new Date(now + cfg.endOffset * day).toISOString(),
                    entry_fee: randInt(0, 2000),
                    max_teams: 8,
                    prize_pool: randInt(5000, 50000),
                    status: cfg.status,
                    entry_code: entryCode,
                    created_by: userId,
                });
            }
        }
        // Check existing tournaments by name+sport (idempotent re-runs)
        const targetTournamentNames = tournamentRowsToInsert.map((t) => t.name);
        const { data: existingTourneys } = await supabase_1.supabase
            .from('tournaments')
            .select('id, name, sport_id, status')
            .in('name', targetTournamentNames);
        const existingTourneyKeys = new Set((existingTourneys ?? []).map((t) => `${t.name}::${t.sport_id}`));
        const newTourneyRows = tournamentRowsToInsert.filter((t) => !existingTourneyKeys.has(`${t.name}::${t.sport_id}`));
        if (newTourneyRows.length > 0) {
            const { data } = await supabase_1.supabase
                .from('tournaments')
                .insert(newTourneyRows)
                .select('id, name, sport_id, status');
            summary.tournaments_created = data?.length ?? 0;
        }
        // Re-fetch all target tournaments
        const { data: allTargetTourneys } = await supabase_1.supabase
            .from('tournaments')
            .select('id, name, sport_id, status')
            .in('name', targetTournamentNames);
        const tournamentRecords = allTargetTourneys ?? [];
        // Build sport_id → sport name reverse map for score generation
        const sportNameById = new Map();
        for (const [name, id] of sportsByName.entries()) {
            // Find the canonical casing
            const canonical = SPORT_NAMES.find((s) => s.toLowerCase() === name) ?? name;
            sportNameById.set(id, canonical);
        }
        // ── STEP 8: Create matches for each tournament ─────────────────────
        const matchRowsToInsert = [];
        for (const t of tournamentRecords) {
            const sportTeams = teamsBySport.get(t.sport_id) ?? [];
            if (sportTeams.length < 2)
                continue;
            const [teamA, teamB] = sportTeams;
            const sportName = sportNameById.get(t.sport_id) ?? 'Cricket';
            if (t.status === 'completed') {
                // 7 matches: 4 QF + 2 SF + 1 Final
                for (let i = 0; i < 7; i++) {
                    matchRowsToInsert.push({
                        sport_id: t.sport_id,
                        tournament_id: t.id,
                        team_a_id: teamA.id,
                        team_b_id: teamB.id,
                        team_a_name: teamA.name,
                        team_b_name: teamB.name,
                        scheduled_at: new Date(now - (40 - i * 2) * day).toISOString(),
                        venue: 'Finals Stadium',
                        status: 'completed',
                        winner_team_id: Math.random() > 0.5 ? teamA.id : teamB.id,
                        score_summary: makeScoreSample(sportName),
                        created_by: userId,
                    });
                }
            }
            else if (t.status === 'live') {
                // 4 completed + 2 live + 4 scheduled
                for (let i = 0; i < 4; i++) {
                    matchRowsToInsert.push({
                        sport_id: t.sport_id,
                        tournament_id: t.id,
                        team_a_id: teamA.id,
                        team_b_id: teamB.id,
                        team_a_name: teamA.name,
                        team_b_name: teamB.name,
                        scheduled_at: new Date(now - (5 - i) * day).toISOString(),
                        status: 'completed',
                        winner_team_id: Math.random() > 0.5 ? teamA.id : teamB.id,
                        score_summary: makeScoreSample(sportName),
                        created_by: userId,
                    });
                }
                for (let i = 0; i < 2; i++) {
                    matchRowsToInsert.push({
                        sport_id: t.sport_id,
                        tournament_id: t.id,
                        team_a_id: teamA.id,
                        team_b_id: teamB.id,
                        team_a_name: teamA.name,
                        team_b_name: teamB.name,
                        scheduled_at: new Date(now).toISOString(),
                        status: 'live',
                        score_summary: makeScoreSample(sportName),
                        created_by: userId,
                    });
                }
                for (let i = 0; i < 4; i++) {
                    matchRowsToInsert.push({
                        sport_id: t.sport_id,
                        tournament_id: t.id,
                        team_a_id: teamA.id,
                        team_b_id: teamB.id,
                        team_a_name: teamA.name,
                        team_b_name: teamB.name,
                        scheduled_at: new Date(now + (i + 2) * day).toISOString(),
                        status: 'scheduled',
                        created_by: userId,
                    });
                }
            }
            else if (t.status === 'upcoming') {
                // 4 scheduled matches for next week
                for (let i = 0; i < 4; i++) {
                    matchRowsToInsert.push({
                        sport_id: t.sport_id,
                        tournament_id: t.id,
                        team_a_id: teamA.id,
                        team_b_id: teamB.id,
                        team_a_name: teamA.name,
                        team_b_name: teamB.name,
                        scheduled_at: new Date(now + (10 + i) * day).toISOString(),
                        status: 'scheduled',
                        created_by: userId,
                    });
                }
            }
        }
        // Only insert matches for NEW tournaments (avoid duplicating matches on re-run)
        const newTourneyIds = new Set(newTourneyRows.map((_, idx) => {
            // Find the inserted tournament by name+sport_id
            const match = tournamentRecords.find((t) => t.name === newTourneyRows[idx].name && t.sport_id === newTourneyRows[idx].sport_id);
            return match?.id;
        }).filter(Boolean));
        const matchesToActuallyInsert = matchRowsToInsert.filter((m) => newTourneyIds.has(m.tournament_id));
        if (matchesToActuallyInsert.length > 0) {
            const { data } = await supabase_1.supabase
                .from('matches')
                .insert(matchesToActuallyInsert)
                .select('id');
            summary.matches_created = data?.length ?? 0;
        }
        // ── STEP 9: Create 30 community posts ──────────────────────────────
        const postAuthorPool = allTestUserIds.length >= 10 ? allTestUserIds : [userId];
        const postRows = POSTS.slice(0, 30).map((p, i) => {
            const sportName = SPORT_NAMES[i % SPORT_NAMES.length];
            const sid = sportsByName.get(sportName.toLowerCase()) ?? null;
            return {
                author_id: postAuthorPool[i % postAuthorPool.length],
                content: p.content,
                image_url: i < 3 ? `https://picsum.photos/seed/${i + 1}/400/300` : null,
                sport_id: sid,
                city_id: anyCity,
                post_type: p.type,
                likes_count: randInt(10, 200),
                comments_count: randInt(1, 30),
            };
        });
        if (postRows.length > 0) {
            const { data } = await supabase_1.supabase
                .from('community_posts')
                .insert(postRows)
                .select('id');
            summary.posts_created = data?.length ?? 0;
        }
        // ── STEP 10: Create 20 notifications for current user ──────────────
        const notifSenderPool = allTestUserIds.length > 0 ? allTestUserIds : [userId];
        const notifRows = [];
        for (let i = 0; i < 4; i++) {
            notifRows.push({
                user_id: userId, type: 'follow',
                title: 'New follower',
                body: `${INDIAN_FIRST_NAMES[i % INDIAN_FIRST_NAMES.length]} ${LAST_INITIALS[i % LAST_INITIALS.length]}. started following you`,
                data: { user_id: notifSenderPool[i % notifSenderPool.length] },
                read: false,
            });
        }
        for (let i = 0; i < 4; i++) {
            notifRows.push({
                user_id: userId, type: 'match_result',
                title: 'Match completed',
                body: 'Mumbai Strikers beat Delhi Kings',
                data: {},
                read: false,
            });
        }
        for (let i = 0; i < 3; i++) {
            const gift = GIFT_CATALOGUE[i];
            notifRows.push({
                user_id: userId, type: 'gift',
                title: 'You received a gift',
                body: `${INDIAN_FIRST_NAMES[(i + 4) % INDIAN_FIRST_NAMES.length]} sent you ${gift.gift_emoji} ${gift.gift_name}`,
                data: { gift_id: gift.gift_id },
                read: false,
            });
        }
        for (let i = 0; i < 3; i++) {
            notifRows.push({
                user_id: userId, type: 'like',
                title: 'Post liked',
                body: `${INDIAN_FIRST_NAMES[(i + 7) % INDIAN_FIRST_NAMES.length]} liked your post`,
                data: {},
                read: false,
            });
        }
        for (let i = 0; i < 3; i++) {
            notifRows.push({
                user_id: userId, type: 'reminder',
                title: 'Match reminder',
                body: `Your match starts in ${i + 1} hour${i > 0 ? 's' : ''}`,
                data: {},
                read: false,
            });
        }
        for (let i = 0; i < 3; i++) {
            notifRows.push({
                user_id: userId, type: 'tournament_update',
                title: 'Tournament update',
                body: `Fixtures published for ${SPORT_NAMES[i]} Summer Cup 2026`,
                data: {},
                read: false,
            });
        }
        if (notifRows.length > 0) {
            const { data } = await supabase_1.supabase
                .from('notifications')
                .insert(notifRows)
                .select('id');
            summary.notifications_created = data?.length ?? 0;
        }
        // ── STEP 11: Create 10 gift_transactions received by current user ──
        const giftRows = GIFT_CATALOGUE.map((g, i) => ({
            sender_id: notifSenderPool[i % notifSenderPool.length],
            receiver_id: userId,
            gift_id: g.gift_id,
            gift_emoji: g.gift_emoji,
            gift_name: g.gift_name,
            coin_cost: g.coin_cost,
            message: ['Great game!', 'You rocked it!', 'Amazing play!', 'Congrats!', 'Keep it up!'][i % 5],
        }));
        if (giftRows.length > 0) {
            const { data } = await supabase_1.supabase
                .from('gift_transactions')
                .insert(giftRows)
                .select('id');
            summary.gifts_created = data?.length ?? 0;
        }
        // ── STEP 12: Update current user stats ─────────────────────────────
        await supabase_1.supabase
            .from('users')
            .update({
            coin_balance: 2000,
            is_premium: true,
            premium_expires_at: new Date(Date.now() + 180 * 86400000).toISOString(),
        })
            .eq('id', userId);
        // Sport profiles for current user in Cricket and Badminton
        const cricketId = sportsByName.get('cricket');
        const badmintonId = sportsByName.get('badminton');
        const currentUserProfiles = [];
        if (cricketId) {
            currentUserProfiles.push({
                user_id: userId, sport_id: cricketId,
                rating: 1200, matches_played: 15, wins: 8, losses: 6, draws: 1,
                last_match_at: new Date().toISOString(),
            });
        }
        if (badmintonId) {
            currentUserProfiles.push({
                user_id: userId, sport_id: badmintonId,
                rating: 1200, matches_played: 15, wins: 8, losses: 6, draws: 1,
                last_match_at: new Date().toISOString(),
            });
        }
        if (currentUserProfiles.length > 0) {
            await supabase_1.supabase
                .from('user_sport_profiles')
                .upsert(currentUserProfiles, { onConflict: 'user_id,sport_id' });
        }
        return res.json({ success: true, summary });
    }
    catch (e) {
        return res.status(500).json({
            error: e?.message ?? 'Failed to load test data',
            summary, // partial progress
        });
    }
}
exports.loadTestData = loadTestData;
//# sourceMappingURL=dev.controller.js.map