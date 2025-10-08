package config

import (
	"errors"
	"fmt"
	"strings"

	"github.com/spf13/viper"
)

// Config captures runtime configuration for the facteur service.
type Config struct {
	Discord DiscordConfig       `mapstructure:"discord"`
	Redis   RedisConfig         `mapstructure:"redis"`
	Argo    ArgoConfig          `mapstructure:"argo"`
	RoleMap map[string][]string `mapstructure:"role_map"`
	Server  ServerConfig        `mapstructure:"server"`
}

// DiscordConfig aggregates Discord bot credentials and routing data.
type DiscordConfig struct {
	BotToken      string `mapstructure:"bot_token"`
	ApplicationID string `mapstructure:"application_id"`
	PublicKey     string `mapstructure:"public_key"`
	GuildID       string `mapstructure:"guild_id"`
}

// RedisConfig identifies the Redis DSN for session storage.
type RedisConfig struct {
	URL string `mapstructure:"url"`
}

// ArgoConfig contains the settings necessary to submit workflows.
type ArgoConfig struct {
	Namespace        string            `mapstructure:"namespace"`
	WorkflowTemplate string            `mapstructure:"workflow_template"`
	ServiceAccount   string            `mapstructure:"service_account"`
	Parameters       map[string]string `mapstructure:"parameters"`
}

// ServerConfig contains HTTP server runtime options.
type ServerConfig struct {
	ListenAddress string `mapstructure:"listen_address"`
}

// Options customises how configuration should be loaded.
type Options struct {
	Path      string
	EnvPrefix string
}

// Load parses configuration from YAML and environment variables.
func Load(path string) (*Config, error) {
	return LoadWithOptions(Options{Path: path, EnvPrefix: "FACTEUR"})
}

// LoadWithOptions provides additional control for tests.
func LoadWithOptions(opts Options) (*Config, error) {
	if opts.EnvPrefix == "" {
		opts.EnvPrefix = "FACTEUR"
	}

	v := viper.New()
	v.SetEnvPrefix(opts.EnvPrefix)
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()
	for _, key := range []string{
		"discord.bot_token",
		"discord.application_id",
		"discord.public_key",
		"discord.guild_id",
		"redis.url",
		"argo.namespace",
		"argo.workflow_template",
		"argo.service_account",
		"argo.parameters",
		"role_map",
		"server.listen_address",
	} {
		if err := v.BindEnv(key); err != nil {
			return nil, fmt.Errorf("bind env %s: %w", key, err)
		}
	}

	if opts.Path != "" {
		v.SetConfigFile(opts.Path)
		if err := v.ReadInConfig(); err != nil {
			return nil, fmt.Errorf("load configuration: %w", err)
		}
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("decode configuration: %w", err)
	}

	normaliseConfig(&cfg)

	if err := validate(cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}

func normaliseConfig(cfg *Config) {
	if cfg.RoleMap == nil {
		cfg.RoleMap = map[string][]string{}
	}
	if cfg.Argo.Parameters == nil {
		cfg.Argo.Parameters = map[string]string{}
	}
	if cfg.Server.ListenAddress == "" {
		cfg.Server.ListenAddress = ":8080"
	}
}

func validate(cfg Config) error {
	var errs []string

	if cfg.Discord.BotToken == "" {
		err := "discord.bot_token is required"
		errs = append(errs, err)
	}
	if cfg.Discord.ApplicationID == "" {
		errs = append(errs, "discord.application_id is required")
	}
	if cfg.Redis.URL == "" {
		errs = append(errs, "redis.url is required")
	}
	if cfg.Argo.Namespace == "" {
		errs = append(errs, "argo.namespace is required")
	}
	if cfg.Argo.WorkflowTemplate == "" {
		errs = append(errs, "argo.workflow_template is required")
	}

	if len(errs) > 0 {
		return errors.New(strings.Join(errs, "; "))
	}

	return nil
}
