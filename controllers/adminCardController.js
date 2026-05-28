import * as cardService from '../services/cardService.js';
import { supabase } from '../config/supabase.js';

export async function listAdminCards(req, res, next) {
  try {
    const { data: cards, error: cardsError } = await supabase
      .from('cards')
      .select('id, card_uid, balance_rwf, is_active, user_id, rfid_uid, registration_status')
      .order('created_at', { ascending: false });

    if (cardsError) throw new Error(cardsError.message);

    const userIds = [...new Set((cards || []).map((card) => card.user_id).filter(Boolean))];
    const profileMap = new Map();

    if (userIds.length) {
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', userIds);

      if (profilesError) throw new Error(profilesError.message);

      for (const profile of profiles || []) {
        profileMap.set(profile.user_id, profile.full_name);
      }
    }

    const enrichedCards = (cards || []).map((card) => ({
      id: card.id,
      card_uid: card.card_uid,
      balance_rwf: card.balance_rwf,
      is_active: card.is_active,
      user_id: card.user_id,
      rfid_uid: card.rfid_uid,
      registration_status: card.registration_status,
      customer_name: profileMap.get(card.user_id) || null,
    }));

    res.json({ success: true, cards: enrichedCards });
  } catch (err) {
    next(err);
  }
}

export async function createAdminCard(req, res, next) {
  try {
    const { user_id = null, card_uid = null, initial_balance = 0 } = req.body;

    const card = await cardService.createCard(user_id || null, card_uid || null, {
      initialBalance: Number(initial_balance) || 0,
    });

    res.status(201).json({ success: true, card });
  } catch (err) {
    next(err);
  }
}

export async function assignAdminCardToUser(req, res, next) {
  try {
    const { cardId } = req.params;
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ success: false, error: 'user_id required' });
    }

    const card = await cardService.assignCardToUser(cardId, user_id);
    res.json({ success: true, card });
  } catch (err) {
    next(err);
  }
}

export async function setAdminCardActive(req, res, next) {
  try {
    const { cardId } = req.params;
    const { is_active } = req.body;
    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ success: false, error: 'is_active boolean required' });
    }

    // Update card active status
    const { data, error } = await supabase
      .from('cards')
      .update({ is_active, updated_at: new Date().toISOString() })
      .eq('id', cardId)
      .select('id, card_uid, is_active, balance_rwf, user_id')
      .single();

    if (error) throw new Error(error.message);

    res.json({ success: true, card: data });
  } catch (err) {
    next(err);
  }
}

export async function rechargeAdminCard(req, res, next) {
  try {
    const { cardId } = req.params;
    const { amount_rwf } = req.body;
    if (!amount_rwf || Number(amount_rwf) <= 0) {
      return res.status(400).json({ success: false, error: 'Valid amount_rwf required' });
    }

    const card = await cardService.rechargeCard(cardId, Number(amount_rwf), null);

    res.json({ success: true, card, message: 'Recharge successful' });
  } catch (err) {
    next(err);
  }
}

export async function deleteAdminCard(req, res, next) {
  try {
    const { cardId } = req.params;
    const card = await cardService.deleteCard(cardId);
    res.json({ success: true, card, message: 'Card deleted' });
  } catch (err) {
    next(err);
  }
}

