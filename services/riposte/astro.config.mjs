// @ts-check
import { defineConfig } from "astro/config"

import tailwind from "@astrojs/tailwind"

import react from "@astrojs/react"

import db from "@astrojs/db"

import sentry from "@sentry/astro"
import spotlightjs from "@spotlightjs/astro"

import node from "@astrojs/node"

// https://astro.build/config
export default defineConfig({
  integrations: [tailwind(), react(), db(), sentry(), spotlightjs()],
  output: "server",

  adapter: node({
    mode: "standalone",
  }),
})
