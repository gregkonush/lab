require("lazy").load({ plugins = { "nvim-treesitter" } })
local languages = { "bash", "c", "lua", "markdown", "markdown_inline", "python", "query", "vim", "vimdoc" }
require("nvim-treesitter").install(languages):wait(300000)
for _, language in ipairs(languages) do
  assert(vim.tbl_contains(require("nvim-treesitter").get_installed(), language), language .. " parser is missing")
end
local plugins = {}
for name, plugin in pairs(require("lazy.core.config").plugins) do
  assert(plugin._.installed, name .. " is missing")
  for _, task in ipairs(plugin._.tasks or {}) do
    assert(not task:has_errors(), name .. " failed installation")
  end
  assert(plugin.dir == "/opt/tengri/editor/plugins/" .. name, name .. " is outside the editor bundle")
  table.insert(plugins, { url = plugin.url, name = name, dir = plugin.dir, pin = true })
end
table.sort(plugins, function(a, b) return a.name < b.name end)
assert(require("astronvim").version() == "v6.1.0")
assert(vim.v.errmsg == "", vim.v.errmsg)
vim.fn.writefile(vim.split("return " .. vim.inspect(plugins), "\n", { plain = true }), "/opt/tengri/editor/plugins.lua")
