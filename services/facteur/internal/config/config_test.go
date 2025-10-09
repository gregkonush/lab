package config_test

import (
	"os"
	"path/filepath"
	"testing"
	"time"

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
consumer:
  enabled: true
  brokers:
    - kafka-1:9092
    - kafka-2:9092
  topic: discord.commands.incoming
  group_id: facteur-consumer
  dlq:
    enabled: true
    topic: discord.commands.dlq
  tls:
    enabled: true
    insecure_skip_verify: true
  sasl:
    enabled: false
  min_bytes: 1024
  max_bytes: 1048576
  max_wait: 3s
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
		require.Equal(t, config.ConsumerConfig{
			Enabled:  true,
			Brokers:  []string{"kafka-1:9092", "kafka-2:9092"},
			Topic:    "discord.commands.incoming",
			GroupID:  "facteur-consumer",
			DLQ:      config.DLQConfig{Enabled: true, Topic: "discord.commands.dlq"},
			TLS:      config.TLSConfig{Enabled: true, InsecureSkipVerify: true},
			SASL:     config.SASLConfig{Enabled: false, Mechanism: "plain"},
			MinBytes: 1024,
			MaxBytes: 1048576,
			MaxWait:  3 * time.Second,
		}, cfg.Consumer)
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
		require.False(t, cfg.Consumer.Enabled)
		require.Equal(t, []string{"localhost:9092"}, cfg.Consumer.Brokers)
		require.Equal(t, "discord.commands.incoming", cfg.Consumer.Topic)
		require.Equal(t, "facteur", cfg.Consumer.GroupID)
		require.Equal(t, time.Second, cfg.Consumer.MaxWait)
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
		require.False(t, cfg.Consumer.Enabled)
		require.Equal(t, []string{"localhost:9092"}, cfg.Consumer.Brokers)
		require.Equal(t, "discord.commands.incoming", cfg.Consumer.Topic)
		require.Equal(t, "facteur", cfg.Consumer.GroupID)
	})

	t.Run("consumer enabled adopts defaults", func(t *testing.T) {
		dir := t.TempDir()
		path := filepath.Join(dir, "facteur.yaml")
		data := []byte(`discord:
  bot_token: token
  application_id: app
redis:
  url: redis://localhost:6379/0
argo:
  namespace: argo
  workflow_template: template
consumer:
  enabled: true
`)
		require.NoError(t, os.WriteFile(path, data, 0o600))

		cfg, err := config.LoadWithOptions(config.Options{Path: path, EnvPrefix: "FACTEUR"})
		require.NoError(t, err)
		require.True(t, cfg.Consumer.Enabled)
		require.Equal(t, []string{"localhost:9092"}, cfg.Consumer.Brokers)
		require.Equal(t, "discord.commands.incoming", cfg.Consumer.Topic)
		require.Equal(t, "facteur", cfg.Consumer.GroupID)
	})
}
