package config_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/gregkonush/lab/services/facteur/internal/config"
)

func TestLoadWithOptions(t *testing.T) {
	t.Run("loads from file", func(t *testing.T) {
		dir := t.TempDir()
		path := filepath.Join(dir, "facteur.yaml")
		data := []byte(`discord:
  bot_token: file-token
  application_id: file-app
  public_key: file-pub
  guild_id: guild-123
redis:
  url: redis://localhost:6379/0
argo:
  namespace: argo
  workflow_template: facteur-dispatch
  service_account: facteur
  parameters:
    environment: staging
server:
  listen_address: ":9000"
role_map:
  dispatch:
    - admin
    - operator
  status:
    - moderator
`)

		require.NoError(t, os.WriteFile(path, data, 0o600))

		cfg, err := config.LoadWithOptions(config.Options{Path: path, EnvPrefix: "FACTEUR"})
		require.NoError(t, err)

		require.Equal(t, "file-token", cfg.Discord.BotToken)
		require.Equal(t, "file-app", cfg.Discord.ApplicationID)
		require.Equal(t, "file-pub", cfg.Discord.PublicKey)
		require.Equal(t, "guild-123", cfg.Discord.GuildID)
		require.Equal(t, "redis://localhost:6379/0", cfg.Redis.URL)
		require.Equal(t, "argo", cfg.Argo.Namespace)
		require.Equal(t, "facteur-dispatch", cfg.Argo.WorkflowTemplate)
		require.Equal(t, "facteur", cfg.Argo.ServiceAccount)
		require.Equal(t, map[string]string{"environment": "staging"}, cfg.Argo.Parameters)
		require.Equal(t, ":9000", cfg.Server.ListenAddress)
		require.Equal(t, map[string][]string{
			"dispatch": []string{"admin", "operator"},
			"status":   []string{"moderator"},
		}, cfg.RoleMap)
	})

	t.Run("env overrides file", func(t *testing.T) {
		dir := t.TempDir()
		path := filepath.Join(dir, "facteur.yaml")
		data := []byte(`discord:
  bot_token: file-token
  application_id: file-app
redis:
  url: redis://localhost:6379/0
argo:
  namespace: argo
  workflow_template: template
`)
		require.NoError(t, os.WriteFile(path, data, 0o600))

		t.Setenv("FACTEUR_DISCORD_BOT_TOKEN", "env-token")
		t.Setenv("FACTEUR_ARGO_WORKFLOW_TEMPLATE", "env-template")

		cfg, err := config.LoadWithOptions(config.Options{Path: path, EnvPrefix: "FACTEUR"})
		require.NoError(t, err)
		require.Equal(t, "env-token", cfg.Discord.BotToken)
		require.Equal(t, "env-template", cfg.Argo.WorkflowTemplate)
		require.Equal(t, ":8080", cfg.Server.ListenAddress)
	})

	t.Run("missing required fields", func(t *testing.T) {
		dir := t.TempDir()
		path := filepath.Join(dir, "facteur.yaml")
		data := []byte(`discord:
  bot_token: file-token
redis:
  url: redis://localhost:6379/0
`)
		require.NoError(t, os.WriteFile(path, data, 0o600))

		_, err := config.LoadWithOptions(config.Options{Path: path, EnvPrefix: "FACTEUR"})
		require.Error(t, err)
		require.Contains(t, err.Error(), "discord.application_id is required")
		require.Contains(t, err.Error(), "argo.namespace is required")
	})

	t.Run("env only", func(t *testing.T) {
		t.Setenv("FACTEUR_DISCORD_BOT_TOKEN", "token")
		t.Setenv("FACTEUR_DISCORD_APPLICATION_ID", "app")
		t.Setenv("FACTEUR_REDIS_URL", "redis://localhost:6379/1")
		t.Setenv("FACTEUR_ARGO_NAMESPACE", "argo")
		t.Setenv("FACTEUR_ARGO_WORKFLOW_TEMPLATE", "template")

		cfg, err := config.LoadWithOptions(config.Options{EnvPrefix: "FACTEUR"})
		require.NoError(t, err)
		require.Equal(t, "token", cfg.Discord.BotToken)
		require.Equal(t, "app", cfg.Discord.ApplicationID)
		require.Equal(t, "redis://localhost:6379/1", cfg.Redis.URL)
		require.Equal(t, ":8080", cfg.Server.ListenAddress)
		require.NotNil(t, cfg.RoleMap)
		require.Empty(t, cfg.RoleMap)
	})
}
