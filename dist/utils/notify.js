"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyUsers = exports.notifyUser = void 0;
// Notification helpers — insert into the notifications table AND fire a push
// to the target user's devices. Best-effort: a failure in one path never
// blocks the caller (and never throws) because push is always optional.
const supabase_1 = require("./supabase");
const fcm_1 = require("./fcm");
// Send to one user — inserts a row and pushes.
async function notifyUser(args) {
    try {
        await supabase_1.supabase.from('notifications').insert({
            user_id: args.userId,
            type: args.type,
            title: args.title,
            body: args.body,
            data: args.data ?? {},
        });
        const { data: tokens } = await supabase_1.supabase
            .from('push_tokens')
            .select('token')
            .eq('user_id', args.userId);
        if (tokens && tokens.length > 0) {
            await (0, fcm_1.sendPushToTokens)(tokens.map((t) => t.token), {
                title: args.title,
                body: args.body,
                data: { type: args.type, ...(args.data ?? {}) },
            });
        }
    }
    catch (err) {
        // eslint-disable-next-line no-console
        console.error('[notify] failed', args.type, err);
    }
}
exports.notifyUser = notifyUser;
// Fan-out to many users. Inserts rows in one batch, pushes in one batch.
async function notifyUsers(userIds, payload) {
    const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
    if (uniqueIds.length === 0)
        return;
    try {
        const rows = uniqueIds.map((userId) => ({
            user_id: userId,
            type: payload.type,
            title: payload.title,
            body: payload.body,
            data: payload.data ?? {},
        }));
        await supabase_1.supabase.from('notifications').insert(rows);
        const { data: tokens } = await supabase_1.supabase
            .from('push_tokens')
            .select('token')
            .in('user_id', uniqueIds);
        if (tokens && tokens.length > 0) {
            await (0, fcm_1.sendPushToTokens)(tokens.map((t) => t.token), {
                title: payload.title,
                body: payload.body,
                data: { type: payload.type, ...(payload.data ?? {}) },
            });
        }
    }
    catch (err) {
        // eslint-disable-next-line no-console
        console.error('[notify] fanout failed', payload.type, err);
    }
}
exports.notifyUsers = notifyUsers;
//# sourceMappingURL=notify.js.map