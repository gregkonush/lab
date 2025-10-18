export const exampleWorkflow = async (name: string): Promise<string> => {
  return `Hello, ${name}!`
}

export const failingWorkflow = async (): Promise<never> => {
  throw new Error('intentional failure')
}
