/**
 * Data model types for WASAC Water Billing
 */

export const Profile = {
  id: 'uuid',
  user_id: 'uuid',
  username: 'string',
  email: 'string',
  full_name: 'string',
  phone: 'string|null',
  role: 'admin|customer|wasac_manager',
};

export const Card = {
  id: 'uuid',
  user_id: 'uuid|null',
  card_uid: 'string',
  rfid_uid: 'string|null',
  qr_token: 'string',
  balance_rwf: 'number',
  is_active: 'boolean',
  registration_status: 'pending_scan|registered',
};

export const Device = {
  id: 'uuid',
  esp32_device_id: 'string',
  device_label: 'string',
  location: 'string|null',
  status: 'online|offline',
  last_seen_at: 'string|null',
};

export const WaterSession = {
  id: 'uuid',
  user_id: 'uuid',
  card_id: 'uuid',
  volume_ml: 'number',
  cost_rwf: 'number',
  status: 'pending|active|completed|blocked|leak_suspected',
};

export const LeakAlert = {
  id: 'uuid',
  user_id: 'uuid',
  reason: 'string',
  severity: 'low|medium|high|critical',
  message: 'string',
  resolved: 'boolean',
};
