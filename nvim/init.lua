-- Reckoner: minimal nvim config for headless agent use
-- Only loads treesitter (parsing) and lspconfig (diagnostics/navigation)
-- No UI plugins, no snippets, no completion, no colorscheme

local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not vim.uv.fs_stat(lazypath) then
  error("lazy.nvim not found — run nvim interactively first to bootstrap")
end
vim.opt.rtp:prepend(lazypath)

-- Silence all UI noise in headless mode
vim.o.swapfile = false
vim.o.backup = false
vim.o.writebackup = false
vim.o.undofile = false
vim.o.loadplugins = true

require("lazy").setup({
  spec = {
    {
      "nvim-treesitter/nvim-treesitter",
      lazy = false, -- force-load immediately
      opts = {
        ensure_installed = {
          "typescript", "tsx", "javascript",
          "python", "lua", "go", "rust",
          "json", "yaml", "toml", "bash",
          "html", "css", "markdown",
        },
        auto_install = true,
        highlight = { enable = false }, -- no highlighting in headless
        indent = { enable = false },
      },
      config = function(_, opts)
        require("nvim-treesitter").setup(opts)
      end,
    },
    {
      "neovim/nvim-lspconfig",
      lazy = false,
      config = function()
        local lspconfig = require("lspconfig")
        local capabilities = vim.lsp.protocol.make_client_capabilities()

        local servers = {
          ts_ls = {},
          pyright = {},
          gopls = {},
          rust_analyzer = {},
          lua_ls = {
            settings = { Lua = { diagnostics = { globals = { "vim" } } } },
          },
          bashls = {},
          jsonls = {},
          cssls = {},
          html = {},
        }

        for name, config in pairs(servers) do
          config.capabilities = capabilities
          if vim.lsp.config and vim.lsp.enable then
            vim.lsp.config(name, config)
            vim.lsp.enable(name)
          else
            lspconfig[name].setup(config)
          end
        end
      end,
    },
  },
  -- Minimal lazy.nvim settings for headless
  defaults = { lazy = false },
  install = { missing = true },
  change_detection = { enabled = false },
  ui = { backdrop = 100 },
  performance = {
    rtp = {
      disabled_plugins = {
        "gzip", "matchit", "matchparen", "netrwPlugin",
        "tarPlugin", "tohtml", "tutor", "zipPlugin",
      },
    },
  },
})
