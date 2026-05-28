import * as cardService from '../services/cardService.js';
import QRCode from 'qrcode';
import { getPricingInfo } from '../services/pricingService.js';
import { supabase } from '../config/supabase.js';

export async function identifyCard(req, res, next) {
  try {
    const uid = req.params.uid || req.body.card_uid || req.body.qr_token;
    const card = await cardService.getCardByUid(uid);
    if (!card) return res.status(404).json({ success: false, error: 'Card not found' });
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('user_id', card.user_id)
      .single();

    res.json({
      success: true,
      card: {
        id: card.id,
        card_uid: card.card_uid,
        balance_rwf: card.balance_rwf,
        user_id: card.user_id,
        is_active: card.is_active,
      },
      user: profile,
      pricing: getPricingInfo(),
    });
  } catch (err) {
    next(err);
  }
}

export async function createCard(req, res, next) {
  try {
    const userId = req.body.user_id || req.user.id;
    const card = await cardService.createCard(userId, req.body.card_uid);
    res.status(201).json({ success: true, card });
  } catch (err) {
    next(err);
  }
}

export async function rechargeCard(req, res, next) {
  try {
    const { card_id, amount_rwf } = req.body;
    if (!card_id || !amount_rwf || amount_rwf <= 0) {
      return res.status(400).json({ success: false, error: 'Valid card_id and amount_rwf required' });
    }
    const userId = req.profile.role === 'customer' ? req.user.id : null;
    const card = await cardService.rechargeCard(card_id, amount_rwf, userId);
    res.json({ success: true, card, message: 'Recharge successful' });
  } catch (err) {
    next(err);
  }
}

export async function getMyCards(req, res, next) {
  try {
    const cards = await cardService.getUserCards(req.user.id);
    const withQr = await Promise.all(
      cards.map(async (c) => ({
        ...c,
        qr_data_url: await QRCode.toDataURL(c.qr_token, { width: 200 }),
      }))
    );
    res.json({ success: true, cards: withQr, pricing: getPricingInfo() });
  } catch (err) {
    next(err);
  }
}

export async function getBalance(req, res, next) {
  try {
    const card = await cardService.getCardById(req.params.id);
    if (req.profile.role === 'customer' && card.user_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    res.json({ success: true, balance_rwf: card.balance_rwf, card });
  } catch (err) {
    next(err);
  }
}
