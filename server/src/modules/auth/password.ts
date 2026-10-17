import bcrypt from 'bcryptjs';
import { env } from '../../config/env.js';

// Cost 12 in production; lower in tests to keep the suite fast.
const COST = env.isTest ? 4 : 12;

export const hashPassword = (plain: string) => bcrypt.hash(plain, COST);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

/** Hash of a random string, compared against when the user does not exist (timing equalization). */
export const DUMMY_HASH = bcrypt.hashSync('chessarena-dummy-password-0', COST);
