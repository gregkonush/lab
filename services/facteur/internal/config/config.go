package config

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/spf13/viper"
)

// Config captures runtime configuration for the facteur service.
type Config struct {
	Discord  DiscordConfig       `mapstructure:"discord"`
	Redis    RedisConfig         `mapstructure:"redis"`
	Argo     ArgoConfig          `mapstructure:"argo"`
	RoleMap  map[string][]string `mapstructure:"role_map"`
	Server   ServerConfig        `mapstructure:"server"`
	Consumer ConsumerConfig      `mapstructure:"consumer"`
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

// ConsumerConfig describes the Kafka-backed Discord command consumer.
type ConsumerConfig struct {
	Enabled  bool          `mapstructure:"enabled"`
	Brokers  []string      `mapstructure:"brokers"`
	Topic    string        `mapstructure:"topic"`
	GroupID  string        `mapstructure:"group_id"`
	DLQ      DLQConfig     `mapstructure:"dlq"`
	TLS      TLSConfig     `mapstructure:"tls"`
	SASL     SASLConfig    `mapstructure:"sasl"`
	MinBytes int           `mapstructure:"min_bytes"`
	MaxBytes int           `mapstructure:"max_bytes"`
	MaxWait  time.Duration `mapstructure:"max_wait"`
}

// DLQConfig controls optional dead-letter publishing.
type DLQConfig struct {
	Enabled bool   `mapstructure:"enabled"`
	Topic   string `mapstructure:"topic"`
}

// TLSConfig toggles TLS for Kafka connections.
type TLSConfig struct {
	Enabled            bool `mapstructure:"enabled"`
	InsecureSkipVerify bool `mapstructure:"insecure_skip_verify"`
}

// SASLConfig captures SASL authentication knobs for Kafka.
type SASLConfig struct {
	Enabled   bool   `mapstructure:"enabled"`
	Mechanism string `mapstructure:"mechanism"`
	Username  string `mapstructure:"username"`
	Password  string `mapstructure:"password"`
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
		"consumer.enabled",
		"consumer.brokers",
		"consumer.topic",
		"consumer.group_id",
		"consumer.dlq.enabled",
		"consumer.dlq.topic",
		"consumer.tls.enabled",
		"consumer.tls.insecure_skip_verify",
		"consumer.sasl.enabled",
		"consumer.sasl.mechanism",
		"consumer.sasl.username",
		"consumer.sasl.password",
		"consumer.min_bytes",
		"consumer.max_bytes",
		"consumer.max_wait",
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
	if len(cfg.Consumer.Brokers) == 0 {
		cfg.Consumer.Brokers = []string{"localhost:9092"}
	}
	if cfg.Consumer.Topic == "" {
		cfg.Consumer.Topic = "discord.commands.incoming"
	}
	if cfg.Consumer.GroupID == "" {
		cfg.Consumer.GroupID = "facteur"
	}
	if cfg.Consumer.MinBytes <= 0 {
		cfg.Consumer.MinBytes = 1
	}
	if cfg.Consumer.MaxBytes <= 0 {
		cfg.Consumer.MaxBytes = 10 << 20 // ~10 MiB
	}
	if cfg.Consumer.MaxWait <= 0 {
		cfg.Consumer.MaxWait = time.Second
	}
	if cfg.Consumer.DLQ.Enabled && cfg.Consumer.DLQ.Topic == "" {
		cfg.Consumer.DLQ.Topic = cfg.Consumer.Topic + ".dlq"
	}
	if cfg.Consumer.SASL.Mechanism == "" {
		cfg.Consumer.SASL.Mechanism = "plain"
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
	if cfg.Consumer.Enabled {
		if len(cfg.Consumer.Brokers) == 0 {
			errs = append(errs, "consumer.brokers is required when consumer.enabled is true")
		}
		if cfg.Consumer.Topic == "" {
			errs = append(errs, "consumer.topic is required when consumer.enabled is true")
		}
		if cfg.Consumer.GroupID == "" {
			errs = append(errs, "consumer.group_id is required when consumer.enabled is true")
		}
		if cfg.Consumer.DLQ.Enabled && cfg.Consumer.DLQ.Topic == "" {
			errs = append(errs, "consumer.dlq.topic is required when consumer.dlq.enabled is true")
		}
		if cfg.Consumer.SASL.Enabled {
			if cfg.Consumer.SASL.Username == "" {
				errs = append(errs, "consumer.sasl.username is required when consumer.sasl.enabled is true")
			}
			if cfg.Consumer.SASL.Password == "" {
				errs = append(errs, "consumer.sasl.password is required when consumer.sasl.enabled is true")
			}
		}
	}

	if len(errs) > 0 {
		return errors.New(strings.Join(errs, "; "))
	}

	return nil
}
