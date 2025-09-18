package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gregkonush/lab/services/miel/internal/alpaca"
	"github.com/gregkonush/lab/services/miel/internal/backtest"
	"github.com/gregkonush/lab/services/miel/internal/config"
	"github.com/gregkonush/lab/services/miel/internal/server"
	"github.com/gregkonush/lab/services/miel/internal/trading"
)

func main() {
	config.LoadDotEnv()

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	alpacaClient := alpaca.NewClient(cfg)
	tradingSvc := trading.NewService(alpacaClient)
	backtestEngine := backtest.NewEngine(alpacaClient, cfg.MaxBarsPerBacktest)

	httpServer := &http.Server{
		Addr:              normalizeAddr(cfg.HTTPPort),
		Handler:           server.New(tradingSvc, backtestEngine).Router(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}

	go func() {
		log.Printf("miel listening on %s", httpServer.Addr)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("http server failed: %v", err)
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	sig := <-sigCh
	log.Printf("received signal %s, shutting down", sig)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := httpServer.Shutdown(ctx); err != nil {
		log.Printf("graceful shutdown failed: %v", err)
	}
}

func normalizeAddr(port string) string {
	if strings.HasPrefix(port, ":") {
		return port
	}
	return ":" + port
}
