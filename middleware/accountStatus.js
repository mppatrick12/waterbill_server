import { ROLES, ACCOUNT_STATUS } from '../config/constants.js';

/** Block unapproved customers from protected customer actions */
export function requireApprovedCustomer(req, res, next) {
  if (req.profile?.role !== ROLES.CUSTOMER) return next();
  const status = req.profile.account_status || ACCOUNT_STATUS.APPROVED;
  if (status === ACCOUNT_STATUS.APPROVED) return next();
  if (status === ACCOUNT_STATUS.PENDING) {
    return res.status(403).json({
      success: false,
      error: 'ACCOUNT_PENDING_APPROVAL',
      message: 'Your account is waiting for WASAC manager approval.',
    });
  }
  return res.status(403).json({
    success: false,
    error: 'ACCOUNT_REJECTED',
    message: 'Your account was not approved. Contact WASAC support.',
  });
}

export function isCustomerApproved(profile) {
  if (!profile || profile.role !== ROLES.CUSTOMER) return true;
  return (profile.account_status || ACCOUNT_STATUS.APPROVED) === ACCOUNT_STATUS.APPROVED;
}
