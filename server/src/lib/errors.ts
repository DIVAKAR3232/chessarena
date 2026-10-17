export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'CSRF_INVALID'
  | 'RATE_LIMITED'
  | 'ILLEGAL_MOVE'
  | 'NOT_YOUR_TURN'
  | 'STALE_POSITION'
  | 'INVALID_STATE'
  | 'INTERNAL';

const statusByCode: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  CSRF_INVALID: 403,
  RATE_LIMITED: 429,
  ILLEGAL_MOVE: 422,
  NOT_YOUR_TURN: 409,
  STALE_POSITION: 409,
  INVALID_STATE: 409,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = statusByCode[code];
  }
}

export const badRequest = (msg: string, details?: unknown) =>
  new AppError('BAD_REQUEST', msg, details);
export const unauthenticated = (msg = 'Authentication required') =>
  new AppError('UNAUTHENTICATED', msg);
export const forbidden = (msg = 'You do not have permission to perform this action') =>
  new AppError('FORBIDDEN', msg);
export const notFound = (what = 'Resource') => new AppError('NOT_FOUND', `${what} not found`);
export const conflict = (msg: string, details?: unknown) => new AppError('CONFLICT', msg, details);
export const invalidState = (msg: string) => new AppError('INVALID_STATE', msg);
