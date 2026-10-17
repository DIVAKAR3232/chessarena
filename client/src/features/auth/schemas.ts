import { z } from 'zod';

// Mirrors server/src/modules/auth/auth.schemas.ts (the server remains authoritative).
export const passwordRule = z
  .string()
  .min(8, 'At least 8 characters')
  .max(128, 'At most 128 characters')
  .regex(/[A-Za-z]/, 'Must contain a letter')
  .regex(/[0-9]/, 'Must contain a number');

export const registerSchema = z
  .object({
    displayName: z.string().trim().min(2, 'At least 2 characters').max(64),
    username: z
      .string()
      .trim()
      .min(3, 'At least 3 characters')
      .max(32)
      .regex(/^[A-Za-z0-9_]+$/, 'Letters, numbers and underscores only'),
    email: z.string().trim().email('Enter a valid email'),
    password: passwordRule,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] });

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your email or username'),
  password: z.string().min(1, 'Enter your password'),
});

export const forgotSchema = z.object({ email: z.string().trim().email('Enter a valid email') });

export const resetSchema = z
  .object({ password: passwordRule, confirmPassword: z.string() })
  .refine((d) => d.password === d.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] });

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1, 'Required'), newPassword: passwordRule, confirmPassword: z.string() })
  .refine((d) => d.newPassword === d.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] });
