"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSentGifts = exports.getReceivedGifts = exports.sendGift = exports.getCatalogue = void 0;
const supabase_1 = require("../utils/supabase");
// ─── Change #7 CRITICAL: ALL 10 PRD gifts ──────────────────────────────────────
const GIFT_CATALOGUE = [
    { id: 'gold_trophy', emoji: '\u{1F3C6}', name: 'Gold Trophy', cost: 15 },
    { id: 'silver_trophy', emoji: '\u{1F948}', name: 'Silver Trophy', cost: 10 },
    { id: 'gold_medal', emoji: '\u{1F947}', name: 'Gold Medal', cost: 12 },
    { id: 'silver_medal', emoji: '\u{1F396}\uFE0F', name: 'Silver Medal', cost: 8 },
    { id: 'best_player', emoji: '\u2B50', name: 'Best Player', cost: 10 },
    { id: 'flowers', emoji: '\u{1F490}', name: 'Flowers', cost: 5 },
    { id: 'star_player', emoji: '\u{1F31F}', name: 'Star Player', cost: 12 },
    { id: 'appreciation', emoji: '\u{1F44F}', name: 'Appreciation', cost: 5 },
    { id: 'fire', emoji: '\u{1F525}', name: 'Fire', cost: 5 },
    { id: 'crown', emoji: '\u{1F451}', name: 'Crown', cost: 8 },
];
// GET /gifts/catalogue
async function getCatalogue(_req, res) {
    return res.json({ gifts: GIFT_CATALOGUE });
}
exports.getCatalogue = getCatalogue;
// POST /gifts/send  { receiverId, giftId, message? }
async function sendGift(req, res) {
    const senderId = req.userId;
    const { receiverId, giftId, message } = req.body || {};
    if (!receiverId || !giftId)
        return res.status(400).json({ error: 'receiverId and giftId required' });
    if (senderId === receiverId)
        return res.status(400).json({ error: 'Cannot send gift to yourself' });
    const gift = GIFT_CATALOGUE.find((g) => g.id === giftId);
    if (!gift)
        return res.status(400).json({ error: 'Invalid gift' });
    // Check sender's premium status
    const { data: sender } = await supabase_1.supabase
        .from('users')
        .select('coin_balance, is_premium')
        .eq('id', senderId)
        .single();
    if (!sender)
        return res.status(404).json({ error: 'Sender not found' });
    if (!sender.is_premium)
        return res.status(403).json({ error: 'Premium required to send gifts' });
    if (sender.coin_balance < gift.cost) {
        return res.status(400).json({
            error: 'Insufficient coins',
            required: gift.cost,
            current: sender.coin_balance,
        });
    }
    // Check receiver exists
    const { data: receiver } = await supabase_1.supabase.from('users').select('id').eq('id', receiverId).single();
    if (!receiver)
        return res.status(404).json({ error: 'Receiver not found' });
    // Deduct coins
    await supabase_1.supabase
        .from('users')
        .update({ coin_balance: sender.coin_balance - gift.cost })
        .eq('id', senderId);
    // Record gift transaction
    const { data: giftTx, error } = await supabase_1.supabase
        .from('gift_transactions')
        .insert({
        sender_id: senderId,
        receiver_id: receiverId,
        gift_id: giftId,
        gift_emoji: gift.emoji,
        gift_name: gift.name,
        coin_cost: gift.cost,
        message: message || null,
    })
        .select()
        .single();
    if (error)
        return res.status(500).json({ error: error.message });
    // Record in transactions table
    await supabase_1.supabase.from('transactions').insert([
        {
            user_id: senderId,
            type: 'gift_sent',
            coins: -gift.cost,
            description: `Sent ${gift.name} ${gift.emoji}`,
            reference_id: giftTx.id,
            status: 'completed',
        },
        {
            user_id: receiverId,
            type: 'gift_received',
            coins: 0,
            description: `Received ${gift.name} ${gift.emoji}`,
            reference_id: giftTx.id,
            status: 'completed',
        },
    ]);
    return res.json({
        success: true,
        giftTransaction: giftTx,
        remainingBalance: sender.coin_balance - gift.cost,
    });
}
exports.sendGift = sendGift;
// GET /gifts/received?userId=
async function getReceivedGifts(req, res) {
    const userId = req.query.userId || req.userId;
    const { data, error } = await supabase_1.supabase
        .from('gift_transactions')
        .select('*, sender:sender_id(id, full_name, username, profile_picture_url)')
        .eq('receiver_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);
    if (error)
        return res.status(500).json({ error: error.message });
    return res.json({ gifts: data ?? [] });
}
exports.getReceivedGifts = getReceivedGifts;
// GET /gifts/sent
async function getSentGifts(req, res) {
    const userId = req.userId;
    const { data, error } = await supabase_1.supabase
        .from('gift_transactions')
        .select('*, receiver:receiver_id(id, full_name, username, profile_picture_url)')
        .eq('sender_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);
    if (error)
        return res.status(500).json({ error: error.message });
    return res.json({ gifts: data ?? [] });
}
exports.getSentGifts = getSentGifts;
//# sourceMappingURL=gifts.controller.js.map