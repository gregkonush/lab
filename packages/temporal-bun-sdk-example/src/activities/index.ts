export type Activities = {
  echo(input: { message: string }): Promise<string>
  sleep(milliseconds: number): Promise<void>
}

export const echo: Activities['echo'] = async ({ message }) => {
  return message
}

export const sleep: Activities['sleep'] = async (milliseconds) => {
  await Bun.sleep(milliseconds)
}
