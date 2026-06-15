import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';
import { supabase } from '../config/supabase.js';
import { pricingConfig } from '../config/brevo.js';
import { calculateCost } from './pricingService.js';
import {
  sendLowBalanceAlert,
  sendRechargeSuccess,
  sendWaterDisconnected,
} from './brevoEmailService.js';

function generateCardUid() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

async function getProfileByUserId(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('full_name, email')
    .eq('user_id', userId)
    .single();

  if (error) return null;
  return data;
}

export async function getCardByUid(cardUid) {
  const { data, error } = await supabase
    .from('cards')
    .select('*')
    .or(`card_uid.eq.${cardUid},qr_token.eq.${cardUid},rfid_uid.eq.${cardUid}`)
    .eq('is_active', true)
    .single();
  if (error) return null;
  return data;
}

export async function getCardById(cardId) {
  const { data, error } = await supabase
    .from('cards')
    .select('*')
    .eq('id', cardId)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export { getProfileByUserId };

export async function createCard(userId = null, cardUid = null, options = {}) {
  if (!userId && !cardUid) {
    const { data: existingPending, error: existingError } = await supabase
      .from('cards')
      .select('*')
      .is('user_id', null)
      .is('rfid_uid', null)
      .eq('registration_status', 'pending_scan')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (existingError) throw new Error(existingError.message);
    if (existingPending) {
      const qrDataUrl = await QRCode.toDataURL(existingPending.qr_token, { width: 256, margin: 2 });
      return { ...existingPending, qr_data_url: qrDataUrl, reused: true };
    }
  }

  const qrToken = uuidv4();
  const qrDataUrl = await QRCode.toDataURL(qrToken, { width: 256, margin: 2 });
  const resolvedCardUid = (cardUid || generateCardUid()).toUpperCase();

  const { data, error } = await supabase
    .from('cards')
    .insert({
      user_id: userId || null,
      card_uid: resolvedCardUid,
      qr_token: qrToken,
      balance_rwf: options.initialBalance ?? 0,
      is_active: true,
      registration_status: userId ? 'registered' : 'pending_scan',
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return { ...data, qr_data_url: qrDataUrl };
}

export async function assignCardToUser(cardId, userId) {
  const { data, error } = await supabase
    .from('cards')
    .update({ user_id: userId, registration_status: 'registered', updated_at: new Date().toISOString() })
    .eq('id', cardId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function deleteCard(cardId) {
  // Delete the card — FK to water_sessions/transactions is ON DELETE SET NULL in the schema
  const { data, error } = await supabase
    .from('cards')
    .delete()
    .eq('id', cardId)
    .select('id, card_uid');

  if (error) throw new Error(error.message);
  // data is an array; return first element (or a sentinel if already gone)
  return data?.[0] ?? { id: cardId, card_uid: 'deleted' };
}

export async function claimPendingCardByRfid(rfidUid) {
  // 1. Try to find a card explicitly marked for a scan link
  const { data: linkTarget, error: linkError } = await supabase
    .from('cards')
    .select('*')
    .eq('registration_status', 'pending_scan_link')
    .order('updated_at', { ascending: false }) // most recently updated target
    .limit(1)
    .maybeSingle();

  if (linkError) throw new Error(linkError.message);

  let targetCard = linkTarget;

  if (!targetCard) {
    // 2. Fall back to standard pending registration card (unassigned card)
    const { data: pendingCard, error: fetchError } = await supabase
      .from('cards')
      .select('*')
      .is('user_id', null)
      .is('rfid_uid', null)
      .eq('registration_status', 'pending_scan')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (fetchError) throw new Error(fetchError.message);
    targetCard = pendingCard;
  }

  if (!targetCard) return null;

  const { data, error } = await supabase
    .from('cards')
    .update({
      rfid_uid: rfidUid,
      registration_status: 'registered',
      updated_at: new Date().toISOString(),
    })
    .eq('id', targetCard.id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function rechargeCard(cardId, amountRwf, userId = null) {
  const card = await getCardById(cardId);
  if (userId && card.user_id !== userId) throw new Error('Card does not belong to user');

  const newBalance = card.balance_rwf + amountRwf;

  const { data, error } = await supabase
    .from('cards')
    .update({ balance_rwf: newBalance, updated_at: new Date().toISOString() })
    .eq('id', cardId)
    .select()
    .single();

  if (error) throw new Error(error.message);

  if (card.user_id) {
    await supabase.from('recharges').insert({
      user_id: card.user_id,
      card_id: cardId,
      amount_rwf: amountRwf,
      method: 'manual',
      brevo_sent: false,
    });
  }

  const profile = await getProfileByUserId(card.user_id);
  if (profile?.email) {
    await sendRechargeSuccess(profile.email, profile.full_name, amountRwf, newBalance);
  }

  if (newBalance >= pricingConfig.lowBalanceThreshold && card.balance_rwf < pricingConfig.lowBalanceThreshold) {
    // balance restored above threshold — no action needed
  }

  return data;
}

export async function deductBalance(cardId, amountRwf) {
  const card = await getCardById(cardId);
  if (card.balance_rwf < amountRwf) {
    throw new Error('INSUFFICIENT_BALANCE');
  }

  const newBalance = card.balance_rwf - amountRwf;

  const { data, error } = await supabase
    .from('cards')
    .update({ balance_rwf: newBalance, updated_at: new Date().toISOString() })
    .eq('id', cardId)
    .select('*')
    .single();

  if (error) throw new Error(error.message);

  const profile = await getProfileByUserId(data.user_id);
  if (newBalance <= 0 && profile?.email) {
    await sendWaterDisconnected(profile.email, profile.full_name, 'Insufficient balance');
  } else if (newBalance < pricingConfig.lowBalanceThreshold && profile?.email) {
    await sendLowBalanceAlert(profile.email, profile.full_name, newBalance, data.user_id);
  }

  return data;
}

export async function reserveAndCheck(card, requestedMl) {
  const estimatedCost = calculateCost(requestedMl);

  if (card.balance_rwf < pricingConfig.minStartingBalance) {
    return {
      allowed: false,
      reason: 'MINIMUM_BALANCE_REQUIRED',
      message: `Your balance (${card.balance_rwf} RWF) is below the minimum required to start (${pricingConfig.minStartingBalance} RWF). Please recharge your card.`,
      balance: card.balance_rwf,
      minimumRequired: pricingConfig.minStartingBalance,
    };
  }

  if (requestedMl <= 0) {
    return {
      allowed: false,
      reason: 'INVALID_VOLUME_REQUEST',
      message: 'Please enter a valid volume greater than zero.',
      balance: card.balance_rwf,
      required: 0,
    };
  }

  if (card.balance_rwf < estimatedCost) {
    const maxL = (Math.floor(card.balance_rwf / pricingConfig.pricePerMl) / 1000).toFixed(1);
    return {
      allowed: false,
      reason: 'INSUFFICIENT_BALANCE',
      message: `Insufficient balance. You have ${card.balance_rwf} RWF but need ${estimatedCost} RWF. You can fetch up to ${maxL} L with your current balance.`,
      balance: card.balance_rwf,
      required: estimatedCost,
      maxAffordableMl: Math.floor(card.balance_rwf / pricingConfig.pricePerMl),
    };
  }
  return {
    allowed: true,
    estimatedCost,
    balance: card.balance_rwf,
    remainingAfter: card.balance_rwf - estimatedCost,
  };
}

export async function getUserCards(userId) {
  const { data, error } = await supabase
    .from('cards')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}
