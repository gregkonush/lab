package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/gregkonush/lab/services/facteur/internal/bridge"
	"github.com/gregkonush/lab/services/facteur/internal/consumer"
	"github.com/gregkonush/lab/services/facteur/internal/session"
)

const (
	defaultListenAddress = ":8080"
	shutdownTimeout      = 10 * time.Second
)

// Options configures the HTTP server lifecycle.
type Options struct {
	ListenAddress string
	Prefork       bool
	Dispatcher    bridge.Dispatcher
	Store         session.Store
	SessionTTL    time.Duration
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
	if opts.SessionTTL <= 0 {
		opts.SessionTTL = consumer.DefaultSessionTTL
	}

	app := fiber.New(fiber.Config{
		Prefork:               opts.Prefork,
		DisableStartupMessage: true,
		AppName:               "facteur",
		ReadTimeout:           15 * time.Second,
		WriteTimeout:          15 * time.Second,
		IdleTimeout:           60 * time.Second,
	})

	registerRoutes(app, opts)

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

func registerRoutes(app *fiber.App, opts Options) {
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

	app.Post("/events", func(c *fiber.Ctx) error {
		if opts.Dispatcher == nil {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "dispatcher unavailable"})
		}

		var event consumer.CommandEvent
		if err := json.Unmarshal(c.Body(), &event); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid payload", "details": err.Error()})
		}

		log.Printf(
			"event received: command=%s user=%s correlation=%s trace=%s",
			event.Command,
			event.UserID,
			emptyIfNone(event.CorrelationID),
			emptyIfNone(event.TraceID),
		)

		ctx := c.UserContext()
		if ctx == nil {
			ctx = context.Background()
		}

		result, err := consumer.ProcessEvent(ctx, event, opts.Dispatcher, opts.Store, opts.SessionTTL)
		if err != nil {
			log.Printf("event dispatch failed: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "dispatch failed"})
		}

		log.Printf("event dispatch succeeded: command=%s workflow=%s namespace=%s correlation=%s trace=%s", event.Command, result.WorkflowName, result.Namespace, result.CorrelationID, event.TraceID)

		return c.Status(fiber.StatusAccepted).JSON(fiber.Map{
			"workflowName":  result.WorkflowName,
			"namespace":     result.Namespace,
			"correlationId": result.CorrelationID,
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

func emptyIfNone(value string) string {
	if value == "" {
		return "(none)"
	}
	return value
}
