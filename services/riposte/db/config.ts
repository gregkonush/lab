import { defineDb, defineTable, column } from "astro:db"
import { v7 as uuidv7 } from "uuid"

const Problem = defineTable({
  columns: {
    id: column.text({ primaryKey: true, default: uuidv7() }),
    description: column.text(),
    title: column.text(),
    topics: column.json(),
    url: column.text(),
    difficulty: column.text(),
  },
})

const Solution = defineTable({
  columns: {
    problemId: column.text(),
    solution: column.text(),
    language: column.text(),
  },
})

// https://astro.build/db/config
export default defineDb({
  tables: {
    Problem,
    Solution,
  },
})
