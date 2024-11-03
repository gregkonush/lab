export type Problem = {
  id: string
  title: string
  titleSlug: string
  difficulty: 'easy' | 'medium' | 'hard'
  tags: string[]
  description: string
  descriptionHtml: string
  codeTemplates: Record<string, string>
}
