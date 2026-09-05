import { z } from "zod";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/auth/password";

/**
 * Auth input schemas (SEC-16).
 *
 * Every one is `.strict()`. That is not stylistic: a non-strict schema would
 * silently accept `{ email, password, role: "ADMIN" }` and leave it to the
 * handler to remember not to spread the body into `prisma.user.create`. Strict
 * mode makes forgetting impossible.
 */

/** Emails are stored lowercased so `A@b.com` and `a@b.com` are one account. */
export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .toLowerCase()
  .pipe(z.email());

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
  .max(MAX_PASSWORD_LENGTH)
  .refine((value) => /[a-zA-Z]/.test(value) && /[0-9]/.test(value), {
    message: "Include at least one letter and one number.",
  });

/** Opaque tokens are base64url; reject anything that cannot be one. */
export const opaqueTokenSchema = z
  .string()
  .min(20)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/, "Malformed token.");

export const registerSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    email: emailSchema,
    password: passwordSchema,
  })
  .strict();

export const loginSchema = z
  .object({
    email: emailSchema,
    // Not `passwordSchema`: an existing password predating a policy change must
    // still be presentable, and echoing policy on login leaks nothing useful.
    password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  })
  .strict();

export const forgotPasswordSchema = z.object({ email: emailSchema }).strict();

export const resetPasswordSchema = z
  .object({
    token: opaqueTokenSchema,
    password: passwordSchema,
  })
  .strict();

export const verifyEmailSchema = z.object({ token: opaqueTokenSchema }).strict();

export const resendVerificationSchema = z.object({ email: emailSchema }).strict();

export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
  })
  .strict();

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
    newPassword: passwordSchema,
  })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
