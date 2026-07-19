import type { Logger } from '@ai-canvas-cloud/shared'
import nodemailer from 'nodemailer'

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

export function createSmtpAuthEmailService(options: {
  host: string
  port: number
  secure: boolean
  from: string
  username: string
  password: string
}): AuthEmailService {
  const transporter = nodemailer.createTransport({
    host: options.host,
    port: options.port,
    secure: options.secure,
    auth: { user: options.username, pass: options.password },
    disableFileAccess: true,
    disableUrlAccess: true,
  })

  return {
    async sendVerificationEmail(input) {
      await transporter.sendMail({
        from: options.from,
        to: input.to,
        subject: 'Verify your AI Canvas Cloud email',
        text: `Verify your email: ${input.verificationUrl}\nThis link expires in ${Math.round(input.expiresInSeconds / 60)} minutes.`,
      })
    },
    async sendPasswordResetEmail(input) {
      await transporter.sendMail({
        from: options.from,
        to: input.to,
        subject: 'Reset your AI Canvas Cloud password',
        text: `Reset your password: ${input.resetUrl}\nThis link expires in ${Math.round(input.expiresInSeconds / 60)} minutes.`,
      })
    },
  }
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
        delivery: 'suppressed',
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
        delivery: 'suppressed',
        expiresInSeconds: input.expiresInSeconds,
      })
    },
  }
}
