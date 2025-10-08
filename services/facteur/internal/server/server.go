package server

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
)

const (
	defaultListenAddress = ":8080"
	shutdownTimeout      = 10 * time.Second
)

// Options configures the HTTP server lifecycle.
type Options struct {
	ListenAddress string
	Prefork       bool
}

// Server wraps a Fiber application with lifecycle helpers.
type Server struct {
	app  *fiber.App
	opts Options
}

// New constructs a Server using the high-performance Fiber framework.
func New(opts Options) (*Server, error) {
	if opts.ListenAddress == "" {
		opts.ListenAddress = defaultListenAddress
	}

	app := fiber.New(fiber.Config{
		Prefork:               opts.Prefork,
		DisableStartupMessage: true,
		AppName:               "facteur",
		ReadTimeout:           15 * time.Second,
		WriteTimeout:          15 * time.Second,
		IdleTimeout:           60 * time.Second,
	})

	registerRoutes(app)

	return &Server{
		app:  app,
		opts: opts,
	}, nil
}

// App exposes the underlying Fiber application for advanced routing.
func (s *Server) App() *fiber.App {
	return s.app
}

// Run starts the Fiber server and blocks until the context is cancelled or an error occurs.
func (s *Server) Run(ctx context.Context) error {
	errCh := make(chan error, 1)

	go func() {
		if err := s.app.Listen(s.opts.ListenAddress); err != nil {
			errCh <- err
			return
		}
		errCh <- nil
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()

		if err := s.app.ShutdownWithContext(shutdownCtx); err != nil {
			return fmt.Errorf("shutdown server: %w", err)
		}

		// Drain the listener outcome to avoid leaking the goroutine.
		if listenErr := <-errCh; !isServerClosedError(listenErr) {
			return fmt.Errorf("listen after shutdown: %w", listenErr)
		}

		return nil
	case err := <-errCh:
		if isServerClosedError(err) {
			return nil
		}
		return fmt.Errorf("start server: %w", err)
	}
}

func isServerClosedError(err error) bool {
	if err == nil {
		return true
	}
	if errors.Is(err, context.Canceled) {
		return true
	}
	if errors.Is(err, net.ErrClosed) {
		return true
	}
	if errors.Is(err, http.ErrServerClosed) {
		return true
	}
	msg := err.Error()
	return msg == "" || strings.Contains(strings.ToLower(msg), "server closed")
}

func registerRoutes(app *fiber.App) {
	app.Get("/healthz", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "ok"})
	})

	app.Get("/readyz", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "ready"})
	})

	app.All("/", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"service": "facteur",
			"version": "0.1.0",
			"status":  "ok",
		})
	})
}

// RunWithLogger is a helper that logs fatal errors from Run.
func RunWithLogger(ctx context.Context, srv *Server) error {
	if err := srv.Run(ctx); err != nil {
		log.Printf("facteur server exited with error: %v", err)
		return err
	}
	return nil
}
