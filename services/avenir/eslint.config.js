// eslint.config.js
import pluginRouter from "@tanstack/eslint-plugin-router"

export default [
  ...pluginRouter.configs["flat/recommended"],
  // Any other config...
]
