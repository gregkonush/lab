import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { createProblem } from './actions'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export default async function Problems() {
  return (
    <form action={createProblem} className="space-y-4 min-w-full">
      <Button size="sm">Save</Button>
      <Input name="title" placeholder="Problem Name..." />
      <Select name="difficulty">
        <SelectTrigger>
          <SelectValue placeholder="Difficulty" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="easy">Easy</SelectItem>
          <SelectItem value="medium">Medium</SelectItem>
          <SelectItem value="hard">Hard</SelectItem>
        </SelectContent>
      </Select>
      <Textarea name="description" placeholder="Paste your description here..." className="min-h-96" />
    </form>
  )
}
