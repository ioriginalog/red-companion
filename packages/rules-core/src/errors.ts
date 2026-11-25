export type RulesErrorCode =
  | 'OUT_OF_RANGE'
  | 'NOT_ENOUGH_AMMO'
  | 'ILLEGAL_MODE'
  | 'CANNOT_DODGE'
  | 'GM_RULING_REQUIRED'
  | 'INVALID_STATE'
  | 'INVALID_INPUT';

/** Thrown when an intent breaks a rule. The UI should show `message` and block the action. */
export class RulesError extends Error {
  constructor(public readonly code: RulesErrorCode, message: string) {
    super(message);
    this.name = 'RulesError';
  }
}
