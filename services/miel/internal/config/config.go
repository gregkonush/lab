package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

const (
	defaultHTTPPort              = "8080"
	defaultTradingBaseURL        = "https://paper-api.alpaca.markets"
	defaultMarketDataURL         = "https://data.alpaca.markets"
	defaultRequestTimeoutSeconds = 30
	defaultMaxBarsPerBacktest    = 5000
)

// Config captures runtime configuration derived from environment variables.
type Config struct {
	HTTPPort             string
	AlpacaAPIKey         string
	AlpacaAPISecret      string
	AlpacaTradingBaseURL string
	AlpacaMarketDataURL  string
	RequestTimeout       time.Duration
	MaxBarsPerBacktest   int
}

// Load reads configuration from environment variables and applies safe defaults.
func Load() (Config, error) {
	cfg := Config{
		HTTPPort:             getEnv("HTTP_PORT", defaultHTTPPort),
		AlpacaAPIKey:         os.Getenv("ALPACA_API_KEY"),
		AlpacaAPISecret:      os.Getenv("ALPACA_SECRET_KEY"),
		AlpacaTradingBaseURL: getEnv("ALPACA_BASE_URL", defaultTradingBaseURL),
		AlpacaMarketDataURL:  getEnv("ALPACA_DATA_BASE_URL", defaultMarketDataURL),
		RequestTimeout:       time.Duration(getEnvAsInt("ALPACA_REQUEST_TIMEOUT_SECONDS", defaultRequestTimeoutSeconds)) * time.Second,
		MaxBarsPerBacktest:   getEnvAsInt("BACKTEST_MAX_BARS", defaultMaxBarsPerBacktest),
	}

	if cfg.RequestTimeout <= 0 {
		return Config{}, fmt.Errorf("invalid ALPACA_REQUEST_TIMEOUT_SECONDS; must be positive")
	}

	if cfg.MaxBarsPerBacktest <= 0 {
		return Config{}, fmt.Errorf("invalid BACKTEST_MAX_BARS; must be positive")
	}

	if cfg.AlpacaAPIKey == "" {
		return Config{}, fmt.Errorf("ALPACA_API_KEY is required")
	}

	if cfg.AlpacaAPISecret == "" {
		return Config{}, fmt.Errorf("ALPACA_SECRET_KEY is required")
	}

	return cfg, nil
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func getEnvAsInt(key string, fallback int) int {
	if value := os.Getenv(key); value != "" {
		parsed, err := strconv.Atoi(value)
		if err == nil {
			return parsed
		}
	}
	return fallback
}
