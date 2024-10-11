declare global {
  namespace NodeJS {
    interface ProcessEnv {
      DB_URI: string
    }
  }
}

export {}
