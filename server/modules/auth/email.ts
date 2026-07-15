import type { Logger } from '@ai-canvas-cloud/shared'

export interface VerificationEmailInput {
  to: string
  verificationUrl: string
  expiresInSeconds: number
}

export interface PasswordResetEmailInput {
  to: string
  resetUrl: string
  expiresInSeconds: number
}

export interface AuthEmailService {
  sendVerificationEmail: (input: VerificationEmailInput) => Promise<void>
  sendPasswordResetEmail: (input: PasswordResetEmailInput) => Promise<void>
}

export function createDevelopmentAuthEmailService(options: {
  env: string
  logger: Logger
}): AuthEmailService {
  return {
    async sendVerificationEmail(input) {
      if (options.env === 'production') {
        options.logger.error('auth.email.verification.not_configured', {
          to: input.to,
          expiresInSeconds: input.expiresInSeconds,
        })
        throw new Error('Production email service is not configured')
      }

      options.logger.info('auth.email.verification.dev_link', {
        to: input.to,
        verificationUrl: input.verificationUrl,
        expiresInSeconds: input.expiresInSeconds,
      })
    },
    async sendPasswordResetEmail(input) {
      if (options.env === 'production') {
        options.logger.error('auth.email.password_reset.not_configured', {
          to: input.to,
          expiresInSeconds: input.expiresInSeconds,
        })
        throw new Error('Production email service is not configured')
      }

      options.logger.info('auth.email.password_reset.dev_link', {
        to: input.to,
        resetUrl: input.resetUrl,
        expiresInSeconds: input.expiresInSeconds,
      })
    },
  }
}
