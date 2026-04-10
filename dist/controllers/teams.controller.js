"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateTeam = exports.removeTeamMember = exports.addTeamMember = exports.getTeam = exports.listTeams = exports.createTeam = void 0;
const supabase_1 = require("../utils/supabase");
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
        const { data: team, error } = await supabase_1.supabase
            .from('teams')
            .insert({ sport_id, name, logo_url: logo_url || null, city_id: city_id || null, created_by: userId })
            .select('*')
            .single();
        if (error || !team)
            return res.status(500).json({ error: error?.message || 'Failed to create team' });
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
        let query = supabase_1.supabase.from('teams').select('*').order('created_at', { ascending: false }).limit(100);
        if (sport_id)
            query = query.eq('sport_id', sport_id);
        if (city_id)
            query = query.eq('city_id', city_id);
        if (q)
            query = query.ilike('name', `%${q}%`);
        if (teamIdsFilter)
            query = query.in('id', teamIdsFilter);
        const { data, error } = await query;
        if (error)
            return res.status(500).json({ error: error.message });
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
            return res.status(500).json({ error: error.message });
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
            return res.status(500).json({ error: error.message });
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
            return res.status(500).json({ error: error.message });
        return res.json({ team: data });
    }
    catch (e) {
        return res.status(500).json({ error: 'Internal server error' });
    }
}
exports.updateTeam = updateTeam;
//# sourceMappingURL=teams.controller.js.map