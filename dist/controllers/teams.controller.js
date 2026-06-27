"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.disbandTeam = exports.joinTeamByCode = exports.updateTeam = exports.removeTeamMember = exports.addTeamMember = exports.getTeam = exports.listTeams = exports.createTeam = void 0;
const supabase_1 = require("../utils/supabase");
const sportId_1 = require("../utils/sportId");
const response_1 = require("../utils/response");
function generateJoinCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < 6; i++)
        out += chars[Math.floor(Math.random() * chars.length)];
    return out;
}
// POST /teams — create a team. FREE for all users (Change #6).
async function createTeam(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { sport_id, name, logo_url, city_id } = req.body || {};
        if (!sport_id || !name) {
            return res.status(400).json({ error: 'sport_id and name are required' });
        }
        // Generate a unique join code
        let join_code = generateJoinCode();
        for (let i = 0; i < 5; i++) {
            const { data: existing } = await supabase_1.supabase.from('teams').select('id').eq('join_code', join_code).maybeSingle();
            if (!existing)
                break;
            join_code = generateJoinCode();
        }
        const { data: team, error } = await supabase_1.supabase
            .from('teams')
            .insert({ sport_id, name, logo_url: logo_url || null, city_id: city_id || null, created_by: userId, join_code })
            .select('*')
            .single();
        if (error || !team)
            return res.status(500).json({ error: (0, response_1.sanitizeError)(error) || 'Failed to create team' });
        const { error: memberErr } = await supabase_1.supabase
            .from('team_members')
            .insert({ team_id: team.id, user_id: userId, role: 'captain' });
        if (memberErr) {
            // best effort — return team anyway
        }
        return res.json({ team });
    }
    catch (e) {
        return res.status(500).json({ error: 'Internal server error' });
    }
}
exports.createTeam = createTeam;
// GET /teams
async function listTeams(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { sport_id, city_id, mine, q } = req.query;
        let teamIdsFilter = null;
        if (mine === '1') {
            const { data: memberships } = await supabase_1.supabase
                .from('team_members')
                .select('team_id')
                .eq('user_id', userId);
            teamIdsFilter = (memberships || []).map((m) => m.team_id);
            if (teamIdsFilter.length === 0)
                return res.json({ teams: [] });
        }
        const resolvedSportId = await (0, sportId_1.resolveSportId)(sport_id);
        let query = supabase_1.supabase.from('teams').select('*').order('created_at', { ascending: false }).limit(100);
        if (resolvedSportId)
            query = query.eq('sport_id', resolvedSportId);
        if (city_id)
            query = query.eq('city_id', city_id);
        if (q)
            query = query.ilike('name', `%${q}%`);
        if (teamIdsFilter)
            query = query.in('id', teamIdsFilter);
        const { data, error } = await query;
        if (error)
            return res.status(500).json({ error: (0, response_1.sanitizeError)(error) });
        return res.json({ teams: data || [] });
    }
    catch (e) {
        return res.status(500).json({ error: 'Internal server error' });
    }
}
exports.listTeams = listTeams;
// GET /teams/:id
async function getTeam(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { id } = req.params;
        const { data: team, error } = await supabase_1.supabase.from('teams').select('*').eq('id', id).maybeSingle();
        if (error || !team)
            return res.status(404).json({ error: 'Team not found' });
        const { data: members } = await supabase_1.supabase
            .from('team_members')
            .select('id, role, jersey_number, joined_at, user:user_id (id, name, username, profile_picture_url)')
            .eq('team_id', id);
        return res.json({ team, members: members || [] });
    }
    catch (e) {
        return res.status(500).json({ error: 'Internal server error' });
    }
}
exports.getTeam = getTeam;
async function isCaptain(teamId, userId) {
    const { data } = await supabase_1.supabase
        .from('team_members')
        .select('role')
        .eq('team_id', teamId)
        .eq('user_id', userId)
        .maybeSingle();
    return data?.role === 'captain';
}
// POST /teams/:id/members — captain only
async function addTeamMember(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    try {
        const id = String(req.params.id);
        const { user_id, role, jersey_number } = req.body || {};
        if (!user_id)
            return res.status(400).json({ error: 'user_id is required' });
        if (!(await isCaptain(id, userId))) {
            return res.status(403).json({ error: 'Only the captain can add members' });
        }
        const { data, error } = await supabase_1.supabase
            .from('team_members')
            .insert({ team_id: id, user_id, role: role || 'player', jersey_number: jersey_number ?? null })
            .select('*')
            .single();
        if (error)
            return res.status(500).json({ error: (0, response_1.sanitizeError)(error) });
        return res.json({ member: data });
    }
    catch (e) {
        return res.status(500).json({ error: 'Internal server error' });
    }
}
exports.addTeamMember = addTeamMember;
// DELETE /teams/:id/members/:userId — captain or self
async function removeTeamMember(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    try {
        const id = String(req.params.id);
        const targetUserId = String(req.params.userId);
        if (targetUserId !== userId && !(await isCaptain(id, userId))) {
            return res.status(403).json({ error: 'Only the captain or the member themselves can remove' });
        }
        const { error } = await supabase_1.supabase
            .from('team_members')
            .delete()
            .eq('team_id', id)
            .eq('user_id', targetUserId);
        if (error)
            return res.status(500).json({ error: (0, response_1.sanitizeError)(error) });
        return res.json({ removed: true });
    }
    catch (e) {
        return res.status(500).json({ error: 'Internal server error' });
    }
}
exports.removeTeamMember = removeTeamMember;
// PATCH /teams/:id — captain only
async function updateTeam(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    try {
        const id = String(req.params.id);
        if (!(await isCaptain(id, userId))) {
            return res.status(403).json({ error: 'Only the captain can update the team' });
        }
        const allowed = {};
        const { name, logo_url, city_id, is_public } = req.body || {};
        if (name !== undefined)
            allowed.name = name;
        if (logo_url !== undefined)
            allowed.logo_url = logo_url;
        if (city_id !== undefined)
            allowed.city_id = city_id;
        if (is_public !== undefined)
            allowed.is_public = is_public;
        allowed.updated_at = new Date().toISOString();
        const { data, error } = await supabase_1.supabase.from('teams').update(allowed).eq('id', id).select('*').single();
        if (error)
            return res.status(500).json({ error: (0, response_1.sanitizeError)(error) });
        return res.json({ team: data });
    }
    catch (e) {
        return res.status(500).json({ error: 'Internal server error' });
    }
}
exports.updateTeam = updateTeam;
// POST /teams/join  { join_code }
async function joinTeamByCode(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { join_code } = req.body || {};
        if (!join_code)
            return res.status(400).json({ error: 'join_code is required' });
        const { data: team } = await supabase_1.supabase
            .from('teams')
            .select('id, name, sport_id')
            .eq('join_code', join_code.toUpperCase())
            .maybeSingle();
        if (!team)
            return res.status(404).json({ error: 'Invalid team code' });
        // Check not already a member
        const { data: existing } = await supabase_1.supabase
            .from('team_members')
            .select('id')
            .eq('team_id', team.id)
            .eq('user_id', userId)
            .maybeSingle();
        if (existing)
            return res.status(400).json({ error: 'Already a member of this team' });
        const { data: member, error } = await supabase_1.supabase
            .from('team_members')
            .insert({ team_id: team.id, user_id: userId, role: 'player' })
            .select('*')
            .single();
        if (error)
            return res.status(500).json({ error: (0, response_1.sanitizeError)(error) });
        return res.json({ team, member });
    }
    catch {
        return res.status(500).json({ error: 'Internal server error' });
    }
}
exports.joinTeamByCode = joinTeamByCode;
// DELETE /teams/:id — disband a team (captain only).
// Removes members + the team row. Refuses if the team has any matches or
// tournament entries tied to it, to avoid orphaning historical records.
async function disbandTeam(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    try {
        const id = String(req.params.id);
        if (!(await isCaptain(id, userId))) {
            return res.status(403).json({ error: 'Only the captain can disband the team' });
        }
        // Block disband if the team is referenced by any match (as A or B).
        const { count: matchCount } = await supabase_1.supabase
            .from('matches')
            .select('id', { count: 'exact', head: true })
            .or(`team_a_id.eq.${id},team_b_id.eq.${id}`);
        if ((matchCount ?? 0) > 0) {
            return res.status(409).json({
                error: 'This team has match history and can\u2019t be disbanded. Remove it from matches first.',
            });
        }
        // Block disband if the team has tournament entries.
        const { count: entryCount } = await supabase_1.supabase
            .from('tournament_entries')
            .select('id', { count: 'exact', head: true })
            .eq('team_id', id);
        if ((entryCount ?? 0) > 0) {
            return res.status(409).json({
                error: 'This team is entered in a tournament and can\u2019t be disbanded yet.',
            });
        }
        // Clean up dependent rows, then the team itself.
        await supabase_1.supabase.from('team_members').delete().eq('team_id', id);
        await supabase_1.supabase.from('team_expenses').delete().eq('team_id', id);
        const { error } = await supabase_1.supabase.from('teams').delete().eq('id', id);
        if (error)
            return res.status(500).json({ error: (0, response_1.sanitizeError)(error) });
        return res.json({ success: true });
    }
    catch {
        return res.status(500).json({ error: 'Internal server error' });
    }
}
exports.disbandTeam = disbandTeam;
//# sourceMappingURL=teams.controller.js.map