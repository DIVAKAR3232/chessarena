import type { z } from 'zod';
import { AppError } from './errors.js';

/** Parses untrusted input with a Zod schema; throws a 422 AppError listing field issues. */
export function validate<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    throw new AppError('VALIDATION_ERROR', 'Invalid input', issues);
  }
  return result.data;
}
