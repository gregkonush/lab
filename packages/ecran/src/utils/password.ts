import bcrypt from 'bcrypt'

export const saltAndHashPassword = async (password: string) => {
  const saltRounds = 10
  return await bcrypt.hash(password, saltRounds)
}

export const comparePassword = async (password: string, hash: string) => {
  return await bcrypt.compare(password, hash)
}
