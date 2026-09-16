import { z } from 'zod';

export const signupSchema = z.object({
  name: z.string().trim().min(1, 'Full name is required.').max(100),
  email: z.string().trim().email().max(255),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(128),
});

export const signinSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(1, 'Password is required.').max(128),
});

export const checkoutSchema = z.object({
  planId: z.enum(['pro'], 'Invalid plan selection.'),
  interval: z.enum(['monthly', 'yearly'], 'Invalid billing interval.'),
});

export const simulateSuccessSchema = z.object({
  sessionId: z.string().trim().min(1).max(200),
});

export const verifySchema = z.object({
  sessionId: z.string().trim().min(1).max(200),
});

export const cancelSchema = z.object({
  reason: z.string().trim().max(500).nullable().optional(),
});

export const webhookSchema = z.object({
  eventType: z.enum(['checkout.session.completed'], 'Unsupported webhook event type.'),
  providerEventId: z.string().trim().min(1).max(200),
  checkoutSessionId: z.string().trim().min(1).max(200),
});

export function formatZodError(error) {
  return error.issues.map((issue) => issue.message).join(', ');
}