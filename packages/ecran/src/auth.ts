import NextAuth from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { DrizzleAdapter } from '@auth/drizzle-adapter'
import { db } from '@/db'
import { signInSchema } from './lib/zod'
import { comparePassword } from '@/utils/password'
import { getUserByEmail } from '@/utils/db'
import { ZodError } from 'zod'

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db),
  providers: [
    CredentialsProvider({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      authorize: async (credentials) => {
        try {
          if (!credentials) {
            return null
          }

          const { email, password } = await signInSchema.parseAsync(credentials)

          const user = await getUserByEmail(email)

          if (!user || !user.passwordHash) {
            return null
          }

          const isValidPassword = await comparePassword(password, user.passwordHash)

          if (!isValidPassword) {
            return null
          }

          return {
            id: user.id,
            name: user.name,
            email: user.email,
          }
        } catch (error) {
          if (error instanceof ZodError) {
            return null
          }
          return null
        }
      },
    }),
  ],
  session: {
    strategy: 'jwt',
  },
})
