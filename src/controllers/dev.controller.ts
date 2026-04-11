import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';

// POST /dev/load-full-data
//
// Comprehensive realistic seeder — simulates a Pune-centred sports community
// spanning all 11 sports with tournaments in every lifecycle stage.
//
// Scope:
//   150 users (realistic Indian names, 60% Pune, 30 premium)
//   44 teams (4 per sport)
//   55 tournaments (5 per sport: 2 completed, 2 ongoing, 1 upcoming)
//   ~450 matches across every lifecycle stage
//   60 community posts · 30 notifications · 20 kudos · 15 gifts · 10 venues
//   Follow graph (20 out / 15 in) + challenge progress for the caller
//
// Idempotent: users keyed on phone, teams on (sport, name), tournaments on
// (sport, name). Posts / notifications / kudos / gifts always insert fresh —
// they're event-like and the frontend lists accumulate them.
//
// REMOVE THIS ROUTE before the production Store build.

// ────────────────────────────────────────────────────────────────────────────
// Seed pools
// ────────────────────────────────────────────────────────────────────────────

const MALE_NAMES = [
  'Rohit Sharma', 'Vikas Patil', 'Arjun Mehta', 'Suresh Kumar', 'Amit Singh',
  'Rajesh Gupta', 'Pradeep Nair', 'Kiran Desai', 'Sanjay Yadav', 'Manoj Tiwari',
  'Vivek Reddy', 'Ganesh Iyer', 'Ravi Shankar', 'Deepak Joshi', 'Nitin Kulkarni',
  'Aditya Rao', 'Karthik Menon', 'Harsh Vardhan', 'Sandeep Bhat', 'Anil Kapoor',
  'Rahul Verma', 'Vishal Shah', 'Pranav Iyer', 'Mohit Agarwal', 'Siddharth Jain',
  'Ashish Chauhan', 'Nikhil Saxena', 'Gaurav Malhotra', 'Sameer Khanna', 'Varun Bhatia',
  'Aakash Mishra', 'Tushar Pandey', 'Yash Deshmukh', 'Karan Thakur', 'Rohan Sethi',
  'Abhishek Das', 'Kunal Oberoi', 'Tarun Goel', 'Saurabh Singhania', 'Akshay Chopra',
  'Pratik Paranjpe', 'Shekhar Dixit', 'Rakesh Pillai', 'Ajay Ganguly', 'Chirag Trivedi',
  'Bhavesh Shetty', 'Omkar Bhide', 'Hemant Mahajan', 'Devendra Kale', 'Girish Nene',
  'Milind Karve', 'Ashwin Krishnan', 'Lalit Srivastava', 'Vinay Chatterjee', 'Rupesh Padhi',
  'Jignesh Vyas', 'Farhan Ali', 'Zaid Ansari', 'Imran Shaikh', 'Salman Khan',
  'Arvind Gokhale', 'Mangesh Jagtap', 'Dhanush Varma', 'Ishaan Pillai', 'Parth Bansal',
  'Rohit Kamath', 'Vaibhav Phadke', 'Shantanu Naik', 'Satish More', 'Prashant Gadgil',
  'Tanmay Bhide', 'Ajinkya Limaye', 'Rushikesh Sawant', 'Yogesh Pawar', 'Sameer Gokhale',
  'Chetan Bhosale', 'Gautam Raut', 'Madhav Ranade', 'Sagar Mohite', 'Nilesh Shinde',
  'Dev Gadgil', 'Prem Joshi', 'Ishan Karve', 'Aryaman Bhoir', 'Riddhesh Dalvi',
  'Nihal Prabhu', 'Shashank Vaidya', 'Uday Rane', 'Vineet Agnihotri', 'Bhargav Pandit',
  'Darshan Shetty', 'Tejas Kulkarni', 'Mayur Jadhav', 'Sahil Chavan', 'Aditya Ghorpade',
  'Rajat Wagle', 'Nachiket Phadnis', 'Aniruddh Vaidya', 'Sunny Bhatnagar', 'Kabir Malhotra',
  'Vedant Apte', 'Pushkar Kale', 'Aakarsh Gore', 'Aseem Bakshi', 'Abhinav Ghosh',
  'Zubair Qureshi', 'Naveed Patel', 'Vikrant Salunke', 'Samarth Dhume', 'Hrishikesh Bapat',
  'Paras Joshi', 'Rajiv Bhatia', 'Kaustubh Rane', 'Swapnil Gokhale', 'Hitesh Kotak',
  'Umesh Tendulkar', 'Salil Sabnis', 'Yatin Tambe', 'Anurag Lele', 'Bharat Pande',
];

const FEMALE_NAMES = [
  'Priya Patel', 'Sneha Sharma', 'Ananya Roy', 'Kavita Reddy', 'Pooja Singh',
  'Meera Nair', 'Divya Kumar', 'Rekha Joshi', 'Sunita Yadav', 'Lakshmi Iyer',
  'Shreya Desai', 'Ishita Bansal', 'Neha Kulkarni', 'Riya Shah', 'Tanvi Gupta',
  'Aditi Menon', 'Pallavi Bhatt', 'Swati Agarwal', 'Nandini Rao', 'Vaishnavi Jadhav',
  'Manisha Pawar', 'Rupa Saxena', 'Kalpana Chavan', 'Deepa Ghosh', 'Anjali Nene',
  'Payal Oberoi', 'Shruti Apte', 'Madhavi Bhide', 'Gauri Limaye', 'Yamini Patil',
];

const PUNE_BIOS = [
  'Cricket enthusiast from Pune. Playing for 10 years. Love batting.',
  'Weekend badminton player. Deccan area. Looking for sparring partners.',
  'Football fanatic. Midfielder. Balewadi regular.',
  'Tennis player · intermediate · Pune Hills Club',
  'Table tennis coach · 15 years experience · Kothrud',
  'Chess player · 1600+ rating · open to rated games',
  'Pickleball beginner · super keen to learn · Kalyani Nagar',
  'Carrom champion · 5-year winning streak',
  'Volleyball setter · Khadki team · free weekends',
  'Basketball point guard · college level · Viman Nagar',
  'Hockey forward · ex-university player · Pimpri',
  'All-rounder · cricket + badminton · always up for a game',
  'Sports junkie · Pune Marathon finisher · fitness first',
  'Ex-state level bowler · now coaching kids in Aundh',
  'Tournament organiser · DM for collabs',
];

const SPORT_NAMES = [
  'Cricket', 'Badminton', 'Football', 'Tennis', 'Table Tennis',
  'Pickleball', 'Chess', 'Carrom', 'Volleyball', 'Basketball', 'Hockey',
] as const;

type SportName = typeof SPORT_NAMES[number];

const MISSING_SPORTS = [
  { name: 'Pickleball', slug: 'pickleball', emoji: '🥒', color: '#065F46', display_order: 12 },
  { name: 'Carrom',     slug: 'carrom',     emoji: '🎯', color: '#5B21B6', display_order: 13 },
];

const TEAM_DATA: Record<SportName, string[]> = {
  Cricket:       ['Pune Warriors', 'Mumbai Strikers', 'Bengaluru Kings', 'Delhi Capitals'],
  Badminton:     ['Pune Smashers', 'Mumbai Shuttlers', 'Bengaluru Aces', 'Delhi Flyers'],
  Football:      ['Pune FC', 'Mumbai United', 'Bengaluru Rovers', 'Delhi Dynamos'],
  Tennis:        ['Pune Aces', 'Mumbai Baseline', 'Bengaluru Volleys', 'Delhi Rackets'],
  'Table Tennis':['Pune Spinners', 'Mumbai Choppers', 'Bengaluru Slicers', 'Delhi Topspin'],
  Pickleball:    ['Pune Dinkers', 'Mumbai Bangers', 'Bengaluru Slammers', 'Delhi Dribblers'],
  Chess:         ['Pune Grandmasters', 'Mumbai Knights', 'Bengaluru Bishops', 'Delhi Rooks'],
  Carrom:        ['Pune Strikers', 'Mumbai Potters', 'Bengaluru Flickers', 'Delhi Sliders'],
  Volleyball:    ['Pune Spikes', 'Mumbai Blockers', 'Bengaluru Setters', 'Delhi Liberos'],
  Basketball:    ['Pune Hoops', 'Mumbai Dunkers', 'Bengaluru Ballers', 'Delhi Shooters'],
  Hockey:        ['Pune Tigers', 'Mumbai Lions', 'Bengaluru Eagles', 'Delhi Panthers'],
};

// Sport → canonical hex for avatar colouring
const SPORT_HEX: Record<SportName, string> = {
  Cricket: '15803D', Badminton: '1D4ED8', Football: '1E3A8A', Tennis: 'C2410C',
  'Table Tennis': '9D174D', Pickleball: '065F46', Chess: '374151', Carrom: '5B21B6',
  Volleyball: '9A3412', Basketball: 'B45309', Hockey: '0E7490',
};

const VENUES = [
  { name: 'Shivaji Park Cricket Ground', city: 'Pune' },
  { name: 'Deccan Gymkhana', city: 'Pune' },
  { name: 'Balewadi Sports Complex', city: 'Pune' },
  { name: 'Wankhede Stadium', city: 'Mumbai' },
  { name: 'Chinnaswamy Stadium', city: 'Bengaluru' },
  { name: 'Nehru Stadium', city: 'Pune' },
  { name: 'YMCA Football Ground', city: 'Mumbai' },
  { name: 'Badminton Association of India Court', city: 'Delhi' },
  { name: 'Sports Authority of India', city: 'Bengaluru' },
  { name: 'DY Patil Stadium', city: 'Mumbai' },
];

const GIFT_CATALOGUE = [
  { gift_id: 'gold_trophy',   gift_emoji: '🏆', gift_name: 'Gold Trophy',   coin_cost: 15 },
  { gift_id: 'silver_trophy', gift_emoji: '🥈', gift_name: 'Silver Trophy', coin_cost: 10 },
  { gift_id: 'gold_medal',    gift_emoji: '🥇', gift_name: 'Gold Medal',    coin_cost: 12 },
  { gift_id: 'silver_medal',  gift_emoji: '🎖️', gift_name: 'Silver Medal',  coin_cost: 8 },
  { gift_id: 'best_player',   gift_emoji: '⭐', gift_name: 'Best Player',   coin_cost: 10 },
  { gift_id: 'flowers',       gift_emoji: '💐', gift_name: 'Flowers',       coin_cost: 5 },
  { gift_id: 'star_player',   gift_emoji: '🌟', gift_name: 'Star Player',   coin_cost: 12 },
  { gift_id: 'appreciation',  gift_emoji: '👏', gift_name: 'Appreciation',  coin_cost: 5 },
  { gift_id: 'fire',          gift_emoji: '🔥', gift_name: 'Fire',          coin_cost: 5 },
  { gift_id: 'crown',         gift_emoji: '👑', gift_name: 'Crown',         coin_cost: 8 },
];

// Community post templates grouped by intent
const POST_TEMPLATES: Array<{ content: string; type: string; image?: boolean }> = [
  // Match result posts (15)
  { content: 'Great match today! Pune Warriors beat Mumbai Strikers by 25 runs 🏏', type: 'Match', image: true },
  { content: 'What a final! Pune Smashers took it 21-18, 21-15 🏸', type: 'Match' },
  { content: 'Pune FC 3-1 Mumbai United. Goals in the 15th, 34th and 67th minutes ⚽', type: 'Match', image: true },
  { content: 'Tough loss today — 6-4, 3-6, 4-6. Came close though.', type: 'Match' },
  { content: 'Bengaluru Kings chased 180 in 18.2 overs. Nail-biter!', type: 'Match', image: true },
  { content: 'Pune Hoops 78 vs Mumbai Dunkers 72. Came back from 15 down 🏀', type: 'Match' },
  { content: 'Carrom league winners — Pune Strikers 3-1 in the final!', type: 'Match' },
  { content: 'Chess rapid tournament: 4.5/5. Only dropped one game 🎯', type: 'Match' },
  { content: 'Volleyball semifinal: Pune Spikes won in straight sets 25-19 25-22', type: 'Match', image: true },
  { content: 'Badminton mixed doubles final was EPIC — 3 games all 21-19', type: 'Match' },
  { content: 'Hockey Pune Tigers beat Mumbai Lions 4-2. Hat-trick from striker #9 🏒', type: 'Match', image: true },
  { content: 'Pickleball doubles tournament: we took bronze. Next year, gold!', type: 'Match' },
  { content: 'Table tennis club finals — won 3-2 in a decider game', type: 'Match' },
  { content: 'Close cricket game: 156/8 vs 155/9. Tied! Super over next 🏏', type: 'Match' },
  { content: 'Just finished a 2-hour football session. Legs are dead but great goals scored ⚽', type: 'Match' },

  // Looking for players (10)
  { content: 'Need 2 batsmen for cricket match this Sunday in Deccan, Pune. DM me!', type: 'Player' },
  { content: 'Looking for a badminton doubles partner. Intermediate level. Kothrud area.', type: 'Player' },
  { content: 'Football 5-a-side tomorrow 6 AM at Balewadi. Need 1 more!', type: 'Player' },
  { content: 'Mixed doubles tennis partner wanted. Weekend mornings. DM for details.', type: 'Player' },
  { content: 'Volleyball beach session at Aundh Ground this Saturday. 4 more spots.', type: 'Player' },
  { content: 'Need a chess sparring partner — around 1400-1600. Online or OTB.', type: 'Player' },
  { content: 'Pickleball beginner looking to join any friendly group in Pune!', type: 'Player' },
  { content: 'Hockey 7s this Sunday at Khadki. 2 forwards needed.', type: 'Player' },
  { content: 'Basketball pickup game every Wednesday evening at Viman Nagar 🏀', type: 'Player' },
  { content: 'Anyone up for carrom tonight? Home setup, Aundh area.', type: 'Player' },

  // Tournament announcements (10)
  { content: 'Registrations open for SportClan Cricket Cup! Entry fee: Free', type: 'Tournament', image: true },
  { content: 'Pune Badminton Open 2026 — 8 teams, 20k prize pool. Closing soon!', type: 'Tournament' },
  { content: 'Inter-society football league starts next month. 12 teams confirmed.', type: 'Tournament', image: true },
  { content: 'Tennis Masters 2026 — singles + doubles. Register by end of week.', type: 'Tournament' },
  { content: 'Table tennis tournament Feb 28. All levels welcome.', type: 'Tournament' },
  { content: 'Pickleball Premier League Season 1 kicks off next Saturday!', type: 'Tournament', image: true },
  { content: 'Chess classical tournament: 5 rounds, entry 500 INR, cash prizes.', type: 'Tournament' },
  { content: 'Carrom tournament this weekend — open to all. Entry just 100!', type: 'Tournament' },
  { content: 'Volleyball Summer Championship — 16 team slots. First come first served.', type: 'Tournament' },
  { content: 'Basketball 3v3 knockout — Sunday 4 PM at SP College ground 🏀', type: 'Tournament', image: true },

  // Training tips (8)
  { content: 'Quick tip for cricket batsmen: Keep your head still while playing the shot.', type: 'Other' },
  { content: 'Badminton footwork drill: 6-point movement, 10 mins daily. Game changer.', type: 'Other' },
  { content: 'Football: Always check your shoulder before receiving the ball. Creates space.', type: 'Other' },
  { content: 'Tennis tip: 80% of points are lost on unforced errors. Consistency > winners.', type: 'Other' },
  { content: 'Chess opening principles > memorising 20 moves deep. Control centre first.', type: 'Other' },
  { content: 'Volleyball setters: Practice your hand position — 10 mins wall work daily.', type: 'Other' },
  { content: 'Basketball free throws: same routine every single time. Muscle memory wins.', type: 'Other' },
  { content: 'Table tennis: Slow down your backswing. Speed comes from the wrist, not the arm.', type: 'Other' },

  // Celebrations (7)
  { content: 'Just crossed 1300 rating in badminton! Thanks to all sparring partners 🏸', type: 'Other' },
  { content: 'First tournament win in cricket! 4 wickets in the final 🏆', type: 'Other' },
  { content: 'Promoted to Intermediate level in pickleball after 3 months of grinding 🥒', type: 'Other' },
  { content: '100 matches played on SportClan! What a journey 🎉', type: 'Other' },
  { content: 'Our football team won the society league! Undefeated season ⚽', type: 'Other' },
  { content: 'FIDE rating crossed 1500 after this month\'s rapid tournament 🎯', type: 'Other' },
  { content: 'Made captain of the Pune Volleyball team for next season 🏐', type: 'Other' },

  // Venue posts (5)
  { content: 'Shivaji Park football ground has great turf. Highly recommend for evening matches', type: 'Other', image: true },
  { content: 'Balewadi Sports Complex badminton courts are world class. 500/hour.', type: 'Other' },
  { content: 'Deccan Gymkhana open to non-members on weekends now!', type: 'Other' },
  { content: 'New pickleball courts at Viman Nagar — 4 courts, lit up at night.', type: 'Other', image: true },
  { content: 'DY Patil Stadium pitch conditions are excellent for batting. Flat deck.', type: 'Other' },

  // General discussion (5)
  { content: 'Who do you think will win the Cricket World Cup final? Dropping my prediction 🏏', type: 'Other' },
  { content: 'Favourite cricket shot? Mine is a proper straight drive — so satisfying.', type: 'Other' },
  { content: 'Rain threatening to wash out tomorrow\'s match. Anyone else affected?', type: 'Other' },
  { content: 'Tennis or badminton? Which requires more fitness? Debate!', type: 'Other' },
  { content: 'Chess vs Carrom — which one is harder to master? Sharing my thoughts.', type: 'Other' },
];

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

function teamLogoUrl(teamName: string, sportName: SportName): string {
  const bg = SPORT_HEX[sportName];
  const init = encodeURIComponent(initials(teamName));
  return `https://ui-avatars.com/api/?name=${init}&background=${bg}&color=fff&size=200&bold=true`;
}

function tournamentBannerUrl(i: number): string {
  return `https://picsum.photos/seed/tournament${i}/1200/400`;
}

function postImageUrl(sport: string, i: number): string {
  const seed = sport.toLowerCase().replace(/\s+/g, '') + i;
  return `https://picsum.photos/seed/${seed}/800/600`;
}

function avatarUrl(i: number): string {
  return `https://i.pravatar.cc/300?img=${((i - 1) % 70) + 1}`;
}

function dobFromAge(age: number): string {
  const today = new Date();
  const year = today.getFullYear() - age;
  const month = randInt(1, 12);
  const day = randInt(1, 28);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Bell-curve rating biased toward 1200
function bellRating(): number {
  const r1 = Math.random(), r2 = Math.random(), r3 = Math.random();
  const avg = (r1 + r2 + r3) / 3; // loose approximation of a gaussian
  return Math.round(800 + avg * 1000);
}

function makeScore(sport: SportName, completed: boolean, winnerA: boolean): Record<string, any> {
  if (!completed) {
    // Live / in-progress partial
    switch (sport) {
      case 'Cricket':    return { team_a_score: `89/2`, team_a_overs: '11.3', team_b_score: null };
      case 'Football':   return { team_a_score: 1, team_b_score: 0, minute: 45 };
      case 'Badminton':  return { team_a_games: [21, 14], team_b_games: [18, 11], current_game: 2 };
      case 'Tennis':     return { team_a_sets: [6, 4], team_b_sets: [3, 3], current_set: 2 };
      case 'Basketball': return { team_a_score: 42, team_b_score: 38, quarter: 3 };
      case 'Volleyball': return { team_a_sets: [25, 14], team_b_sets: [22, 11], current_set: 2 };
      case 'Hockey':     return { team_a_score: 1, team_b_score: 1, minute: 30 };
      case 'Chess':      return { move: 28, result: 'in_progress' };
      case 'Table Tennis': return { team_a_games: [11, 8], team_b_games: [9, 6], current_game: 2 };
      case 'Pickleball': return { team_a_games: [11, 5], team_b_games: [8, 3], current_game: 2 };
      case 'Carrom':     return { team_a_score: 15, team_b_score: 10, board: 3 };
    }
  }
  // Completed — inject realistic final scores with A as winner if winnerA
  const hi = () => randInt(18, 25);
  const lo = () => randInt(10, 17);
  switch (sport) {
    case 'Cricket': {
      const aRuns = winnerA ? randInt(160, 210) : randInt(130, 165);
      const bRuns = winnerA ? randInt(120, aRuns - 5) : randInt(aRuns + 5, 210);
      return {
        team_a_score: `${aRuns}/${randInt(3, 8)}`,
        team_b_score: `${bRuns}/${randInt(4, 9)}`,
        team_a_overs: '20.0', team_b_overs: '20.0',
        result: winnerA ? `${SPORT_NAMES[0]} A won by ${aRuns - bRuns} runs` : `Team B won by ${randInt(2, 8)} wickets`,
      };
    }
    case 'Football': {
      const a = winnerA ? randInt(2, 4) : randInt(0, 2);
      const b = winnerA ? randInt(0, a - 1) : randInt(a + 1, 5);
      return { team_a_score: a, team_b_score: b, goals_a: [15, 34, 67].slice(0, a), goals_b: [45].slice(0, b) };
    }
    case 'Badminton': {
      const g1a = winnerA ? 21 : 18, g1b = winnerA ? 18 : 21;
      const g2a = winnerA ? 18 : 21, g2b = winnerA ? 21 : 18;
      const g3a = winnerA ? 21 : 15, g3b = winnerA ? 15 : 21;
      return { team_a_games: [g1a, g2a, g3a], team_b_games: [g1b, g2b, g3b], sets: winnerA ? '2-1' : '1-2' };
    }
    case 'Tennis': {
      const sets = winnerA
        ? [{ a: 6, b: 4 }, { a: 3, b: 6 }, { a: 6, b: 3 }]
        : [{ a: 4, b: 6 }, { a: 6, b: 3 }, { a: 3, b: 6 }];
      return {
        team_a_sets: sets.map((s) => s.a),
        team_b_sets: sets.map((s) => s.b),
        result: winnerA ? 'Team A won 2-1' : 'Team B won 2-1',
      };
    }
    case 'Table Tennis': {
      return {
        team_a_games: winnerA ? [11, 9, 11, 11] : [8, 11, 9, 7],
        team_b_games: winnerA ? [8, 11, 9, 7]  : [11, 9, 11, 11],
        sets: winnerA ? '3-1' : '1-3',
      };
    }
    case 'Pickleball': {
      return {
        team_a_games: winnerA ? [11, 9, 11] : [8, 11, 7],
        team_b_games: winnerA ? [8, 11, 7]  : [11, 9, 11],
        sets: winnerA ? '2-1' : '1-2',
      };
    }
    case 'Chess': {
      const by = rand(['checkmate', 'resignation', 'time']);
      return winnerA
        ? { result: '1-0', moves: randInt(25, 60), by }
        : { result: '0-1', moves: randInt(25, 60), by };
    }
    case 'Carrom': {
      return { team_a_score: winnerA ? 25 : randInt(12, 22), team_b_score: winnerA ? randInt(12, 22) : 25 };
    }
    case 'Volleyball': {
      return {
        team_a_sets: winnerA ? [25, 23, 25] : [20, 25, 19],
        team_b_sets: winnerA ? [20, 25, 19] : [25, 23, 25],
        sets: winnerA ? '3-0' : '0-3',
      };
    }
    case 'Basketball': {
      const a = winnerA ? randInt(85, 110) : randInt(60, 82);
      const b = winnerA ? randInt(60, a - 2) : randInt(a + 2, 110);
      return { team_a_score: a, team_b_score: b, quarters: 4 };
    }
    case 'Hockey': {
      const a = winnerA ? randInt(2, 5) : randInt(0, 2);
      const b = winnerA ? randInt(0, a - 1) : randInt(a + 1, 5);
      return { team_a_score: a, team_b_score: b };
    }
  }
  return {};
}

// Sport-specific preference payload for user_sport_profiles
function sportPrefs(sport: SportName): Record<string, any> {
  const hand = () => rand(['Right', 'Left']);
  const level = () => rand(['Beginner', 'Intermediate', 'Advanced', 'Pro']);
  switch (sport) {
    case 'Cricket':
      return {
        batting_style: rand(['Right', 'Left']),
        bowling_style: rand(['Fast', 'Spin', 'Medium', 'None']),
        role: rand(['Batsman', 'Bowler', 'All-rounder', 'Wicketkeeper']),
      };
    case 'Badminton':
      return {
        dominant_hand: hand(),
        play_type: [rand(['Singles', 'Doubles', 'Mixed'])],
        playing_level: level(),
      };
    case 'Football':
      return {
        preferred_foot: rand(['Right', 'Left', 'Both']),
        position: [rand(['Striker', 'Midfielder', 'Defender', 'Goalkeeper'])],
        play_style: rand(['Attacking', 'Defensive', 'Playmaker']),
      };
    case 'Tennis':
      return {
        dominant_hand: hand(),
        play_type: [rand(['Singles', 'Doubles', 'Mixed'])],
        playing_level: level(),
        backhand_type: rand(['One-handed', 'Two-handed']),
      };
    case 'Table Tennis':
      return {
        dominant_hand: hand(),
        grip_type: rand(['Shakehand', 'Penhold']),
        playing_style: rand(['Attacker', 'Defender', 'All-round']),
      };
    case 'Pickleball':
      return {
        dominant_hand: hand(),
        play_type: [rand(['Singles', 'Doubles', 'Mixed'])],
        playing_level: level(),
      };
    case 'Chess':
      return { playing_level: level(), playing_style: rand(['Aggressive', 'Positional', 'Tactical']) };
    case 'Carrom':
      return { dominant_hand: hand(), preferred_side: rand(['Black', 'White']) };
    case 'Volleyball':
      return { position: [rand(['Setter', 'Spiker', 'Libero', 'Blocker'])], playing_level: level() };
    case 'Basketball':
      return { position: [rand(['Point Guard', 'Shooting Guard', 'Forward', 'Center'])], dominant_hand: hand() };
    case 'Hockey':
      return { stick_type: rand(['Field', 'Indoor']), position: [rand(['Forward', 'Midfielder', 'Defender', 'Goalkeeper'])] };
  }
}

// Cricket ball-by-ball event sample (not 120 per match — a representative 30
// that the commentary feed can replay)
function cricketEvents(matchId: string, userId: string): any[] {
  const over = (o: number, b: number) => ({
    match_id: matchId,
    event_type: 'ball',
    period: o,
    payload: { over: o, ball: b, runs: [0, 0, 1, 1, 2, 4, 1, 0, 6, 1, 0, 0, 2, 1, 4][randInt(0, 14)] },
    created_by: userId,
  });
  const rows: any[] = [];
  for (let o = 1; o <= 5; o++) for (let b = 1; b <= 6; b++) rows.push(over(o, b));
  return rows;
}

// ────────────────────────────────────────────────────────────────────────────
// Handler
// ────────────────────────────────────────────────────────────────────────────

export async function loadFullData(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const summary = {
    sports_backfilled: 0,
    users_created: 0, users_skipped: 0,
    user_sports_created: 0, sport_profiles_created: 0,
    teams_created: 0, team_members_created: 0,
    tournaments_created: 0, matches_created: 0, match_events_created: 0,
    venues_created: 0,
    posts_created: 0, notifications_created: 0,
    kudos_created: 0, gifts_created: 0,
    follows_created: 0,
    challenges_created: 0, user_challenges_created: 0,
    coin_events_created: 0,
    match_participants_created: 0,
  };

  try {
    // ── STEP 1: Ensure all 11 sports exist ───────────────────────────────
    const { data: existingSports } = await supabase.from('sports').select('id, name');
    const sportsByName = new Map<string, string>();
    for (const s of existingSports ?? []) sportsByName.set(s.name, s.id);

    const missingToInsert = MISSING_SPORTS.filter((s) => !sportsByName.has(s.name));
    if (missingToInsert.length > 0) {
      const { data: inserted } = await supabase
        .from('sports')
        .insert(missingToInsert)
        .select('id, name');
      for (const s of inserted ?? []) sportsByName.set(s.name, s.id);
      summary.sports_backfilled = inserted?.length ?? 0;
    }

    const sportIdByName = new Map<SportName, string>();
    for (const name of SPORT_NAMES) {
      const id = sportsByName.get(name);
      if (id) sportIdByName.set(name, id);
    }
    const sportNameById = new Map<string, SportName>();
    for (const [name, id] of sportIdByName.entries()) sportNameById.set(id, name);

    // ── STEP 2: Load cities (Pune is the hub) ────────────────────────────
    const { data: allCities } = await supabase
      .from('cities')
      .select('id, name')
      .in('name', ['Pune', 'Mumbai', 'Bengaluru', 'Delhi', 'Hyderabad', 'Chennai']);
    const cityByName = new Map<string, string>();
    for (const c of allCities ?? []) cityByName.set(c.name, c.id);
    const puneId = cityByName.get('Pune') ?? null;

    // ── STEP 3: Create 150 realistic users ───────────────────────────────
    const NUM_USERS = 150;
    const allNames = [...MALE_NAMES.slice(0, 120), ...FEMALE_NAMES.slice(0, 30)];
    const userRows: any[] = [];
    for (let i = 0; i < NUM_USERS; i++) {
      const name = allNames[i];
      const isFemale = i >= 120;
      // City weights: 60% Pune, 15% Mumbai, 10% Bengaluru, 10% Delhi, 5% rest
      const pick = Math.random();
      let cityName = 'Pune';
      if (pick >= 0.60 && pick < 0.75) cityName = 'Mumbai';
      else if (pick >= 0.75 && pick < 0.85) cityName = 'Bengaluru';
      else if (pick >= 0.85 && pick < 0.95) cityName = 'Delhi';
      else if (pick >= 0.95) cityName = rand(['Hyderabad', 'Chennai']);
      const cityId = cityByName.get(cityName) ?? puneId;

      // Role mix: 120 players, 15 umpires, 8 coaches, 7 businesses
      let accountType = 'Player';
      if (i >= 120 && i < 135) accountType = 'Umpire-Referee';
      else if (i >= 135 && i < 143) accountType = 'Trainer-Coach';
      else if (i >= 143) accountType = 'Business-Vendor';

      userRows.push({
        phone: `+91dummy${String(i + 1).padStart(3, '0')}`,
        name,
        username: `player${String(i + 1).padStart(3, '0')}`,
        email: `dummy${i + 1}@sportclan.test`,
        city_id: cityId,
        account_type: accountType,
        profile_picture_url: avatarUrl(i + 1),
        bio: rand(PUNE_BIOS),
        gender: isFemale ? 'female' : 'male',
        dob: dobFromAge(randInt(18, 45)),
        is_premium: i < 30,
        premium_expires_at: i < 30 ? new Date(Date.now() + 90 * 86400000).toISOString() : null,
        coin_balance: randInt(50, 800),
      });
    }

    // Idempotency: check existing by phone
    const phones = userRows.map((u) => u.phone);
    const { data: existingUsers } = await supabase
      .from('users')
      .select('id, phone')
      .in('phone', phones);
    const existingByPhone = new Map<string, string>();
    for (const u of existingUsers ?? []) existingByPhone.set(u.phone, u.id);

    const newUserRows = userRows.filter((u) => !existingByPhone.has(u.phone));
    summary.users_skipped = userRows.length - newUserRows.length;

    // Insert in chunks of 50 to keep payload size sane
    for (let i = 0; i < newUserRows.length; i += 50) {
      const chunk = newUserRows.slice(i, i + 50);
      const { data: inserted } = await supabase
        .from('users')
        .insert(chunk)
        .select('id, phone');
      for (const u of inserted ?? []) existingByPhone.set(u.phone, u.id);
      summary.users_created += inserted?.length ?? 0;
    }

    const dummyUserIds = userRows
      .map((u) => existingByPhone.get(u.phone))
      .filter((id): id is string => !!id);

    // ── STEP 4: Assign sports + sport profiles ───────────────────────────
    // Target: ~50 players per sport. With 150 dummy users over 11 sports,
    // assign each user 4 random sports → ~54 average per sport.
    const userSportRows: any[] = [];
    const sportProfileRows: any[] = [];
    const sportPlayerIds = new Map<SportName, string[]>();
    for (const s of SPORT_NAMES) sportPlayerIds.set(s, []);

    for (const uid of dummyUserIds) {
      const picked = shuffle([...SPORT_NAMES]).slice(0, randInt(3, 4));
      for (const sportName of picked) {
        const sid = sportIdByName.get(sportName);
        if (!sid) continue;
        userSportRows.push({ user_id: uid, sport_id: sid });
        const matches = randInt(5, 60);
        const wins = randInt(1, Math.max(1, Math.floor(matches * 0.6)));
        const losses = Math.max(0, matches - wins - randInt(0, 2));
        sportProfileRows.push({
          user_id: uid,
          sport_id: sid,
          rating: bellRating(),
          matches_played: matches,
          wins,
          losses,
          draws: Math.max(0, matches - wins - losses),
          last_match_at: new Date(Date.now() - randInt(1, 30) * 86400000).toISOString(),
          ...sportPrefs(sportName),
        });
        sportPlayerIds.get(sportName)!.push(uid);
      }
    }

    // Upsert user_sports and user_sport_profiles in chunks
    for (let i = 0; i < userSportRows.length; i += 200) {
      const chunk = userSportRows.slice(i, i + 200);
      const { data } = await supabase
        .from('user_sports')
        .upsert(chunk, { onConflict: 'user_id,sport_id', ignoreDuplicates: true })
        .select('id');
      summary.user_sports_created += data?.length ?? 0;
    }
    for (let i = 0; i < sportProfileRows.length; i += 200) {
      const chunk = sportProfileRows.slice(i, i + 200);
      const { data } = await supabase
        .from('user_sport_profiles')
        .upsert(chunk, { onConflict: 'user_id,sport_id', ignoreDuplicates: true })
        .select('id');
      summary.sport_profiles_created += data?.length ?? 0;
    }

    // ── STEP 5: Create 44 teams (4 per sport) ────────────────────────────
    const teamRows: any[] = [];
    for (const sportName of SPORT_NAMES) {
      const sid = sportIdByName.get(sportName);
      if (!sid) continue;
      for (const teamName of TEAM_DATA[sportName]) {
        // Map team name → city
        let teamCity: string | null = puneId;
        if (teamName.startsWith('Mumbai')) teamCity = cityByName.get('Mumbai') ?? null;
        else if (teamName.startsWith('Bengaluru')) teamCity = cityByName.get('Bengaluru') ?? null;
        else if (teamName.startsWith('Delhi')) teamCity = cityByName.get('Delhi') ?? null;
        teamRows.push({
          sport_id: sid,
          name: teamName,
          logo_url: teamLogoUrl(teamName, sportName),
          city_id: teamCity,
          created_by: userId,
          is_public: true,
        });
      }
    }

    const targetTeamNames = teamRows.map((t) => t.name);
    const { data: existingTeams } = await supabase
      .from('teams')
      .select('id, name, sport_id')
      .in('name', targetTeamNames);
    const existingTeamKeys = new Set(
      (existingTeams ?? []).map((t) => `${t.sport_id}::${t.name}`),
    );
    const newTeamRows = teamRows.filter(
      (t) => !existingTeamKeys.has(`${t.sport_id}::${t.name}`),
    );

    if (newTeamRows.length > 0) {
      const { data } = await supabase
        .from('teams')
        .insert(newTeamRows)
        .select('id, name, sport_id');
      summary.teams_created = data?.length ?? 0;
    }

    // Re-fetch all target teams (existing + newly created)
    const { data: allTargetTeams } = await supabase
      .from('teams')
      .select('id, name, sport_id')
      .in('name', targetTeamNames);

    // Group by sport_id
    const teamsBySport = new Map<string, Array<{ id: string; name: string }>>();
    for (const t of allTargetTeams ?? []) {
      const arr = teamsBySport.get(t.sport_id) ?? [];
      arr.push({ id: t.id, name: t.name });
      teamsBySport.set(t.sport_id, arr);
    }

    // ── STEP 6: Add 12-15 players to each team ───────────────────────────
    const teamMemberRows: any[] = [];
    for (const team of allTargetTeams ?? []) {
      const sportName = sportNameById.get(team.sport_id);
      if (!sportName) continue;
      const pool = sportPlayerIds.get(sportName) ?? [];
      if (pool.length < 5) continue;
      const picked = shuffle(pool).slice(0, Math.min(randInt(12, 15), pool.length));
      picked.forEach((uid, idx) => {
        teamMemberRows.push({
          team_id: team.id,
          user_id: uid,
          role: idx === 0 ? 'captain' : idx === 1 ? 'vice_captain' : 'player',
          jersey_number: idx + 1,
        });
      });
    }

    for (let i = 0; i < teamMemberRows.length; i += 200) {
      const chunk = teamMemberRows.slice(i, i + 200);
      const { data } = await supabase
        .from('team_members')
        .upsert(chunk, { onConflict: 'team_id,user_id', ignoreDuplicates: true })
        .select('id');
      summary.team_members_created += data?.length ?? 0;
    }

    // ── STEP 7: Create 55 tournaments (5 per sport) ──────────────────────
    const now = Date.now();
    const day = 86400000;
    const tournamentRows: any[] = [];

    // Use a rolling counter for unique entry codes
    let codeCounter = 0;
    const nextCode = (prefix: string) => {
      codeCounter += 1;
      return `${prefix}${String(codeCounter).padStart(3, '0')}`;
    };

    for (const sportName of SPORT_NAMES) {
      const sid = sportIdByName.get(sportName);
      if (!sid) continue;
      const slug = sportName.replace(/\s+/g, '');
      // 1: completed championship (2 months ago)
      tournamentRows.push({
        sport_id: sid,
        name: `Pune ${sportName} Championship 2025`,
        description: `8 team knockout · ${sportName} flagship tournament`,
        format: 'knockout',
        city_id: puneId,
        venue: 'Balewadi Sports Complex',
        start_date: new Date(now - 75 * day).toISOString(),
        end_date:   new Date(now - 60 * day).toISOString(),
        entry_fee: 500, max_teams: 8, prize_pool: 25000,
        banner_url: tournamentBannerUrl(1 + SPORT_NAMES.indexOf(sportName) * 10),
        status: 'completed', entry_code: nextCode(`CHAMP25${slug.slice(0, 2).toUpperCase()}`),
        created_by: userId,
      });
      // 2: completed premier league (1 month ago)
      tournamentRows.push({
        sport_id: sid,
        name: `${sportName} Premier League Season 1`,
        description: `6 team round-robin league`,
        format: 'round_robin',
        city_id: puneId,
        venue: 'Deccan Gymkhana',
        start_date: new Date(now - 45 * day).toISOString(),
        end_date:   new Date(now - 30 * day).toISOString(),
        entry_fee: 1000, max_teams: 6, prize_pool: 50000,
        banner_url: tournamentBannerUrl(2 + SPORT_NAMES.indexOf(sportName) * 10),
        status: 'completed', entry_code: nextCode(`PL1${slug.slice(0, 2).toUpperCase()}`),
        created_by: userId,
      });
      // 3: ongoing groups+KO, 2 weeks old
      tournamentRows.push({
        sport_id: sid,
        name: `Pune ${sportName} Open 2026`,
        description: `Group stage + knockouts · 8 teams`,
        format: 'groups_knockout',
        city_id: puneId,
        venue: 'Shivaji Park',
        start_date: new Date(now - 14 * day).toISOString(),
        end_date:   new Date(now + 30 * day).toISOString(),
        entry_fee: 800, max_teams: 8, prize_pool: 40000,
        banner_url: tournamentBannerUrl(3 + SPORT_NAMES.indexOf(sportName) * 10),
        status: 'live', entry_code: nextCode(`OPEN26${slug.slice(0, 2).toUpperCase()}`),
        created_by: userId,
      });
      // 4: ongoing small knockout, last week
      tournamentRows.push({
        sport_id: sid,
        name: `SportClan ${sportName} Cup`,
        description: `4 team knockout · sponsored by SportClan`,
        format: 'knockout',
        city_id: puneId,
        venue: 'Nehru Stadium',
        start_date: new Date(now - 7 * day).toISOString(),
        end_date:   new Date(now + 14 * day).toISOString(),
        entry_fee: 0, max_teams: 4, prize_pool: 10000,
        banner_url: tournamentBannerUrl(4 + SPORT_NAMES.indexOf(sportName) * 10),
        status: 'live', entry_code: nextCode(`SCCUP${slug.slice(0, 2).toUpperCase()}`),
        created_by: userId,
      });
      // 5: upcoming masters next week
      tournamentRows.push({
        sport_id: sid,
        name: `${sportName} Masters 2026`,
        description: `8 team knockout · registrations open`,
        format: 'knockout',
        city_id: puneId,
        venue: 'Balewadi Sports Complex',
        start_date: new Date(now + 7 * day).toISOString(),
        end_date:   new Date(now + 21 * day).toISOString(),
        entry_fee: 1500, max_teams: 8, prize_pool: 60000,
        banner_url: tournamentBannerUrl(5 + SPORT_NAMES.indexOf(sportName) * 10),
        status: 'upcoming', entry_code: nextCode(`MST26${slug.slice(0, 2).toUpperCase()}`),
        created_by: userId,
      });
    }

    // Idempotency: check existing tournaments by (sport_id, name)
    const targetTournamentNames = tournamentRows.map((t) => t.name);
    const { data: existingTourneys } = await supabase
      .from('tournaments')
      .select('id, name, sport_id, status')
      .in('name', targetTournamentNames);
    const existingTourneyKeys = new Set(
      (existingTourneys ?? []).map((t) => `${t.sport_id}::${t.name}`),
    );
    const newTourneyRows = tournamentRows.filter(
      (t) => !existingTourneyKeys.has(`${t.sport_id}::${t.name}`),
    );

    if (newTourneyRows.length > 0) {
      for (let i = 0; i < newTourneyRows.length; i += 20) {
        const chunk = newTourneyRows.slice(i, i + 20);
        const { data } = await supabase
          .from('tournaments')
          .insert(chunk)
          .select('id');
        summary.tournaments_created += data?.length ?? 0;
      }
    }

    // Re-fetch all target tournaments
    const { data: allTourneys } = await supabase
      .from('tournaments')
      .select('id, name, sport_id, status')
      .in('name', targetTournamentNames);

    // ── STEP 8: Create matches ───────────────────────────────────────────
    // Track newly-created tournament IDs so we only seed matches for those
    const newTourneyKeys = new Set(newTourneyRows.map((t) => `${t.sport_id}::${t.name}`));
    const newTourneyIds = new Set(
      (allTourneys ?? [])
        .filter((t) => newTourneyKeys.has(`${t.sport_id}::${t.name}`))
        .map((t) => t.id),
    );

    const matchRows: any[] = [];
    const completedMatchBuckets: Array<{ tournament: any; sportName: SportName; teams: Array<{ id: string; name: string }> }> = [];

    for (const t of allTourneys ?? []) {
      if (!newTourneyIds.has(t.id)) continue;
      const sportName = sportNameById.get(t.sport_id);
      if (!sportName) continue;
      const sportTeams = teamsBySport.get(t.sport_id) ?? [];
      if (sportTeams.length < 2) continue;

      // Make a 4-team rotation
      const [A, B, C, D] = [sportTeams[0], sportTeams[1], sportTeams[2 % sportTeams.length], sportTeams[3 % sportTeams.length]];

      if (t.name.includes('Championship 2025')) {
        // 8-team knockout: 4 QF + 2 SF + 1 F = 7 matches
        const pairs: Array<[typeof A, typeof B]> = [
          [A, B], [C, D], [A, C], [B, D], // QFs
          [A, D], [B, C],                  // SFs
          [A, B],                          // Final
        ];
        pairs.forEach((p, idx) => {
          const winnerA = Math.random() > 0.45;
          matchRows.push({
            sport_id: t.sport_id, tournament_id: t.id,
            team_a_id: p[0].id, team_b_id: p[1].id,
            team_a_name: p[0].name, team_b_name: p[1].name,
            scheduled_at: new Date(now - (72 - idx * 2) * day).toISOString(),
            venue: 'Balewadi Sports Complex', city_id: puneId,
            status: 'completed',
            winner_team_id: winnerA ? p[0].id : p[1].id,
            score_summary: makeScore(sportName, true, winnerA),
            created_by: userId,
          });
        });
        completedMatchBuckets.push({ tournament: t, sportName, teams: sportTeams });
      } else if (t.name.includes('Premier League Season 1')) {
        // 6-team round robin = 15 matches; we simulate with 4 team rotation ×4 = up to 12 for simplicity
        for (let idx = 0; idx < 12; idx++) {
          const a = sportTeams[idx % sportTeams.length];
          const b = sportTeams[(idx + 1) % sportTeams.length];
          if (a.id === b.id) continue;
          const winnerA = Math.random() > 0.5;
          matchRows.push({
            sport_id: t.sport_id, tournament_id: t.id,
            team_a_id: a.id, team_b_id: b.id,
            team_a_name: a.name, team_b_name: b.name,
            scheduled_at: new Date(now - (42 - idx) * day).toISOString(),
            venue: 'Deccan Gymkhana', city_id: puneId,
            status: 'completed',
            winner_team_id: winnerA ? a.id : b.id,
            score_summary: makeScore(sportName, true, winnerA),
            created_by: userId,
          });
        }
      } else if (t.name.includes('Open 2026')) {
        // 12 matches: 6 completed group stage, 2 live, 4 upcoming
        for (let idx = 0; idx < 6; idx++) {
          const a = sportTeams[idx % sportTeams.length];
          const b = sportTeams[(idx + 2) % sportTeams.length];
          if (a.id === b.id) continue;
          const winnerA = Math.random() > 0.5;
          matchRows.push({
            sport_id: t.sport_id, tournament_id: t.id,
            team_a_id: a.id, team_b_id: b.id,
            team_a_name: a.name, team_b_name: b.name,
            scheduled_at: new Date(now - (13 - idx) * day).toISOString(),
            venue: 'Shivaji Park', city_id: puneId,
            status: 'completed',
            winner_team_id: winnerA ? a.id : b.id,
            score_summary: makeScore(sportName, true, winnerA),
            created_by: userId,
          });
        }
        for (let idx = 0; idx < 2; idx++) {
          matchRows.push({
            sport_id: t.sport_id, tournament_id: t.id,
            team_a_id: sportTeams[idx].id, team_b_id: sportTeams[idx + 2].id,
            team_a_name: sportTeams[idx].name, team_b_name: sportTeams[idx + 2].name,
            scheduled_at: new Date(now).toISOString(),
            venue: 'Shivaji Park', city_id: puneId,
            status: 'live',
            score_summary: makeScore(sportName, false, true),
            created_by: userId,
          });
        }
        for (let idx = 0; idx < 4; idx++) {
          matchRows.push({
            sport_id: t.sport_id, tournament_id: t.id,
            team_a_id: sportTeams[idx % sportTeams.length].id,
            team_b_id: sportTeams[(idx + 1) % sportTeams.length].id,
            team_a_name: sportTeams[idx % sportTeams.length].name,
            team_b_name: sportTeams[(idx + 1) % sportTeams.length].name,
            scheduled_at: new Date(now + (idx + 2) * day).toISOString(),
            venue: 'Shivaji Park', city_id: puneId,
            status: 'scheduled',
            created_by: userId,
          });
        }
      } else if (t.name.includes('SportClan')) {
        // 4-team knockout: 2 completed (SF), 2 upcoming (other SF + F)
        for (let idx = 0; idx < 2; idx++) {
          const a = sportTeams[idx];
          const b = sportTeams[idx + 2] ?? sportTeams[0];
          const winnerA = Math.random() > 0.5;
          matchRows.push({
            sport_id: t.sport_id, tournament_id: t.id,
            team_a_id: a.id, team_b_id: b.id,
            team_a_name: a.name, team_b_name: b.name,
            scheduled_at: new Date(now - (6 - idx) * day).toISOString(),
            venue: 'Nehru Stadium', city_id: puneId,
            status: 'completed',
            winner_team_id: winnerA ? a.id : b.id,
            score_summary: makeScore(sportName, true, winnerA),
            created_by: userId,
          });
        }
        for (let idx = 0; idx < 2; idx++) {
          matchRows.push({
            sport_id: t.sport_id, tournament_id: t.id,
            team_a_id: sportTeams[idx].id, team_b_id: sportTeams[(idx + 1) % sportTeams.length].id,
            team_a_name: sportTeams[idx].name, team_b_name: sportTeams[(idx + 1) % sportTeams.length].name,
            scheduled_at: new Date(now + (idx + 3) * day).toISOString(),
            venue: 'Nehru Stadium', city_id: puneId,
            status: 'scheduled',
            created_by: userId,
          });
        }
      } else if (t.name.includes('Masters 2026')) {
        // 7 upcoming scheduled matches
        for (let idx = 0; idx < 7; idx++) {
          const a = sportTeams[idx % sportTeams.length];
          const b = sportTeams[(idx + 1) % sportTeams.length];
          matchRows.push({
            sport_id: t.sport_id, tournament_id: t.id,
            team_a_id: a.id, team_b_id: b.id,
            team_a_name: a.name, team_b_name: b.name,
            scheduled_at: new Date(now + (8 + idx) * day).toISOString(),
            venue: 'Balewadi Sports Complex', city_id: puneId,
            status: 'scheduled',
            created_by: userId,
          });
        }
      }
    }

    // Insert matches in chunks
    const insertedMatchIds: string[] = [];
    for (let i = 0; i < matchRows.length; i += 100) {
      const chunk = matchRows.slice(i, i + 100);
      const { data } = await supabase
        .from('matches')
        .insert(chunk)
        .select('id, sport_id, tournament_id, status');
      if (data) {
        summary.matches_created += data.length;
        for (const m of data) insertedMatchIds.push(m.id);
      }
    }

    // ── STEP 9: Match events for first 3 completed cricket matches ───────
    const cricketSportId = sportIdByName.get('Cricket');
    if (cricketSportId && insertedMatchIds.length > 0) {
      const { data: cricketCompleted } = await supabase
        .from('matches')
        .select('id')
        .eq('sport_id', cricketSportId)
        .eq('status', 'completed')
        .in('id', insertedMatchIds)
        .limit(3);
      const eventRows: any[] = [];
      for (const m of cricketCompleted ?? []) eventRows.push(...cricketEvents(m.id, userId));
      if (eventRows.length > 0) {
        for (let i = 0; i < eventRows.length; i += 100) {
          const chunk = eventRows.slice(i, i + 100);
          const { data } = await supabase.from('match_events').insert(chunk).select('id');
          summary.match_events_created += data?.length ?? 0;
        }
      }
    }

    // ── STEP 10: Venues (10 named) ───────────────────────────────────────
    const venueRows = VENUES.map((v) => ({
      name: v.name,
      city_id: cityByName.get(v.city) ?? puneId,
      use_count: randInt(5, 50),
      created_by: userId,
    }));
    // Idempotency: lookup by name
    const venueNames = venueRows.map((v) => v.name);
    const { data: existingVenues } = await supabase
      .from('venues')
      .select('id, name')
      .in('name', venueNames);
    const existingVenueNames = new Set((existingVenues ?? []).map((v) => v.name));
    const newVenues = venueRows.filter((v) => !existingVenueNames.has(v.name));
    if (newVenues.length > 0) {
      const { data } = await supabase.from('venues').insert(newVenues).select('id');
      summary.venues_created = data?.length ?? 0;
    }

    // ── STEP 11: Community posts (60, always fresh) ──────────────────────
    const authorPool = dummyUserIds.length >= 10 ? dummyUserIds : [userId];
    const postRows = POST_TEMPLATES.slice(0, 60).map((p, i) => {
      const sport = SPORT_NAMES[i % SPORT_NAMES.length];
      const sid = sportIdByName.get(sport) ?? null;
      const city = i % 3 === 0 ? cityByName.get('Pune') : cityByName.get('Mumbai') ?? puneId;
      return {
        author_id: authorPool[i % authorPool.length],
        content: p.content.slice(0, 500),
        image_url: p.image ? postImageUrl(sport, i + 1) : null,
        sport_id: sid,
        city_id: city,
        post_type: p.type,
        likes_count: randInt(5, 150),
        comments_count: randInt(1, 25),
      };
    });

    if (postRows.length > 0) {
      for (let i = 0; i < postRows.length; i += 30) {
        const chunk = postRows.slice(i, i + 30);
        const { data } = await supabase.from('community_posts').insert(chunk).select('id');
        summary.posts_created += data?.length ?? 0;
      }
    }

    // ── STEP 12: Notifications for caller (30 total) ─────────────────────
    const notifSenders = dummyUserIds.slice(0, 40);
    const notifRows: any[] = [];
    for (let i = 0; i < 5; i++) {
      notifRows.push({
        user_id: userId, type: 'follow',
        title: 'New follower',
        body: `${allNames[i % allNames.length]} started following you`,
        data: { user_id: notifSenders[i % notifSenders.length] }, read: false,
      });
    }
    for (let i = 0; i < 5; i++) {
      notifRows.push({
        user_id: userId, type: 'match_result',
        title: 'Match completed',
        body: rand(['Pune Warriors beat Mumbai Strikers by 25 runs', 'Pune FC 3-1 Delhi Dynamos', 'Bengaluru Aces won 2-1']),
        data: {}, read: false,
      });
    }
    for (let i = 0; i < 4; i++) {
      notifRows.push({
        user_id: userId, type: 'reminder',
        title: 'Match reminder',
        body: `Your match starts in ${i + 1} hour${i > 0 ? 's' : ''}`,
        data: {}, read: false,
      });
    }
    for (let i = 0; i < 4; i++) {
      const gift = GIFT_CATALOGUE[i];
      notifRows.push({
        user_id: userId, type: 'gift',
        title: 'You received a gift',
        body: `${allNames[(i + 5) % allNames.length]} sent you ${gift.gift_emoji} ${gift.gift_name}`,
        data: { gift_id: gift.gift_id }, read: false,
      });
    }
    for (let i = 0; i < 3; i++) {
      const delta = rand([45, -12, 28, 17, -8]);
      notifRows.push({
        user_id: userId, type: 'rating',
        title: `Rating ${delta > 0 ? 'up' : 'down'}`,
        body: `Your cricket rating changed by ${delta > 0 ? '+' : ''}${delta}`,
        data: { delta }, read: false,
      });
    }
    for (let i = 0; i < 3; i++) {
      notifRows.push({
        user_id: userId, type: 'kudos',
        title: 'Kudos received',
        body: `${allNames[(i + 10) % allNames.length]} gave you kudos: "Great bowling today!"`,
        data: {}, read: false,
      });
    }
    for (let i = 0; i < 3; i++) {
      notifRows.push({
        user_id: userId, type: 'challenge',
        title: 'Challenge completed',
        body: `You finished ${rand(['April Warrior', 'Cricket Master', 'Community Star'])} challenge!`,
        data: {}, read: false,
      });
    }
    for (let i = 0; i < 3; i++) {
      notifRows.push({
        user_id: userId, type: 'comment',
        title: 'New comment',
        body: `${allNames[(i + 15) % allNames.length]} commented on your post`,
        data: {}, read: false,
      });
    }

    if (notifRows.length > 0) {
      const { data } = await supabase.from('notifications').insert(notifRows).select('id');
      summary.notifications_created = data?.length ?? 0;
    }

    // ── STEP 13: Kudos (20 between random users tied to completed matches)
    const { data: completedMatches } = await supabase
      .from('matches')
      .select('id')
      .eq('status', 'completed')
      .limit(20);
    const kudosMessages = [
      'Great bowling today!', 'Amazing catches!', 'Well played!', 'Class act!',
      'MVP performance!', 'Incredible game!', 'Legend!', 'Tactical genius!',
    ];
    const kudosRows: any[] = [];
    for (let i = 0; i < Math.min(20, (completedMatches ?? []).length); i++) {
      const m = completedMatches![i];
      const from = dummyUserIds[i % dummyUserIds.length];
      const to = dummyUserIds[(i + 5) % dummyUserIds.length];
      if (from === to) continue;
      kudosRows.push({
        from_user_id: from,
        to_user_id: to,
        match_id: m.id,
        message: rand(kudosMessages),
      });
    }
    if (kudosRows.length > 0) {
      const { data } = await supabase.from('kudos').insert(kudosRows).select('id');
      summary.kudos_created = data?.length ?? 0;
    }

    // ── STEP 14: Gifts received by caller (15) ───────────────────────────
    const giftRows: any[] = [];
    for (let i = 0; i < 15; i++) {
      const g = GIFT_CATALOGUE[i % GIFT_CATALOGUE.length];
      giftRows.push({
        sender_id: dummyUserIds[i % dummyUserIds.length],
        receiver_id: userId,
        gift_id: g.gift_id,
        gift_emoji: g.gift_emoji,
        gift_name: g.gift_name,
        coin_cost: g.coin_cost,
        message: rand(['Great game!', 'You rocked it!', 'Amazing play!', 'Congrats!', 'Keep it up!']),
      });
    }
    if (giftRows.length > 0) {
      const { data } = await supabase.from('gift_transactions').insert(giftRows).select('id');
      summary.gifts_created = data?.length ?? 0;
    }

    // ── STEP 15: Follow graph for caller ─────────────────────────────────
    // 20 outgoing + 15 incoming
    const followRows: any[] = [];
    const outgoing = dummyUserIds.slice(0, 20);
    const incoming = dummyUserIds.slice(20, 35);
    for (const uid of outgoing) followRows.push({ follower_id: userId, following_id: uid });
    for (const uid of incoming) followRows.push({ follower_id: uid, following_id: userId });
    if (followRows.length > 0) {
      const { data } = await supabase
        .from('follow_relationships')
        .upsert(followRows, { onConflict: 'follower_id,following_id', ignoreDuplicates: true })
        .select('id');
      summary.follows_created = data?.length ?? 0;
    }

    // ── STEP 16: Challenges + user_challenges progress ───────────────────
    // Create 3 challenge definitions if missing, then user_challenges rows.
    const challengeDefs = [
      {
        title: 'April Warrior',
        description: 'Play 5 matches in April',
        sport_id: null,
        target_count: 5, reward_coins: 100,
        starts_at: new Date(now - 12 * day).toISOString(),
        ends_at:   new Date(now + 20 * day).toISOString(),
        active: true,
      },
      {
        title: 'Cricket Master',
        description: 'Win 1 cricket tournament',
        sport_id: cricketSportId ?? null,
        target_count: 1, reward_coins: 200,
        starts_at: new Date(now - 30 * day).toISOString(),
        ends_at:   new Date(now + 60 * day).toISOString(),
        active: true,
      },
      {
        title: 'Community Star',
        description: 'Make 3 community posts',
        sport_id: null,
        target_count: 3, reward_coins: 50,
        starts_at: new Date(now - 10 * day).toISOString(),
        ends_at:   new Date(now + 30 * day).toISOString(),
        active: true,
      },
    ];
    const challengeTitles = challengeDefs.map((c) => c.title);
    const { data: existingChallenges } = await supabase
      .from('challenges')
      .select('id, title')
      .in('title', challengeTitles);
    const existingChallengeTitles = new Set((existingChallenges ?? []).map((c) => c.title));
    const newChallenges = challengeDefs.filter((c) => !existingChallengeTitles.has(c.title));
    if (newChallenges.length > 0) {
      const { data } = await supabase.from('challenges').insert(newChallenges).select('id, title');
      summary.challenges_created = data?.length ?? 0;
    }
    const { data: allChallenges } = await supabase
      .from('challenges')
      .select('id, title')
      .in('title', challengeTitles);
    const challengeByTitle = new Map<string, string>();
    for (const c of allChallenges ?? []) challengeByTitle.set(c.title, c.id);

    const userChallengeRows: any[] = [];
    if (challengeByTitle.has('April Warrior')) {
      userChallengeRows.push({
        user_id: userId, challenge_id: challengeByTitle.get('April Warrior'),
        progress: 3, completed: false,
      });
    }
    if (challengeByTitle.has('Cricket Master')) {
      userChallengeRows.push({
        user_id: userId, challenge_id: challengeByTitle.get('Cricket Master'),
        progress: 0, completed: false,
      });
    }
    if (challengeByTitle.has('Community Star')) {
      userChallengeRows.push({
        user_id: userId, challenge_id: challengeByTitle.get('Community Star'),
        progress: 2, completed: false,
      });
    }
    if (userChallengeRows.length > 0) {
      const { data } = await supabase
        .from('user_challenges')
        .upsert(userChallengeRows, { onConflict: 'user_id,challenge_id', ignoreDuplicates: false })
        .select('id');
      summary.user_challenges_created = data?.length ?? 0;
    }

    // ── STEP 17: Coin events for caller ──────────────────────────────────
    const coinEventRows = [
      { user_id: userId, event_type: 'first_registration', coins: 100 },
      { user_id: userId, event_type: 'complete_profile',   coins: 50  },
    ];
    const { data: coinData } = await supabase
      .from('coin_events')
      .upsert(coinEventRows, { onConflict: 'user_id,event_type', ignoreDuplicates: true })
      .select('id');
    summary.coin_events_created = coinData?.length ?? 0;

    // ── STEP 18: Update caller state + add to Pune Warriors cricket ──────
    const callerPatch: any = {
      coin_balance: 2500,
      is_premium: true,
      premium_expires_at: new Date(Date.now() + 180 * day).toISOString(),
    };
    // Preserve existing referral_code if set, otherwise seed one
    const { data: callerExisting } = await supabase
      .from('users')
      .select('referral_code')
      .eq('id', userId)
      .maybeSingle();
    if (!callerExisting?.referral_code) callerPatch.referral_code = 'SC-DIPAK1';
    await supabase.from('users').update(callerPatch).eq('id', userId);

    // Add caller to Pune Warriors cricket team
    if (cricketSportId) {
      const { data: puneWarriors } = await supabase
        .from('teams')
        .select('id')
        .eq('sport_id', cricketSportId)
        .eq('name', 'Pune Warriors')
        .maybeSingle();
      if (puneWarriors) {
        await supabase
          .from('team_members')
          .upsert({ team_id: puneWarriors.id, user_id: userId, role: 'player', jersey_number: 7 }, {
            onConflict: 'team_id,user_id', ignoreDuplicates: true,
          });
      }
    }

    // Add caller as participant in 3 completed matches
    const { data: completedForCaller } = await supabase
      .from('matches')
      .select('id')
      .eq('status', 'completed')
      .in('id', insertedMatchIds.slice(0, 3));
    const participantRows = (completedForCaller ?? []).map((m, idx) => ({
      match_id: m.id,
      user_id: userId,
      team_side: idx % 2 === 0 ? 'A' : 'B',
      role: 'player',
      batting_order: idx + 1,
      jersey_number: 7,
    }));
    if (participantRows.length > 0) {
      const { data } = await supabase.from('match_participants').insert(participantRows).select('id');
      summary.match_participants_created = data?.length ?? 0;
    }

    return res.json({
      success: true,
      message: 'Loaded comprehensive dummy data across all sports',
      summary,
    });
  } catch (e: any) {
    return res.status(500).json({
      error: e?.message ?? 'Failed to load dummy data',
      summary,
    });
  }
}
