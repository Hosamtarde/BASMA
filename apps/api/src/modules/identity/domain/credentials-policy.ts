/** Owner-approved defaults (B0 plan). The max length bounds Argon2 work per request. */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 50;
/** Letters of any script (Arabic allowed), digits, dot, underscore, dash. No spaces. */
export const USERNAME_PATTERN = /^[\p{L}\p{N}._-]+$/u;
