//go:build linux

package main

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
)

type guestLifecyclePhaseError struct {
	operation string
	cause     error
}

func (failure *guestLifecyclePhaseError) Error() string {
	return fmt.Sprintf("%s: %v", failure.operation, failure.cause)
}
func (failure *guestLifecyclePhaseError) Unwrap() error { return failure.cause }

func observeLifecyclePhase(ctx context.Context, operation string, run func(context.Context) error) error {
	child, span := otel.Tracer("nanoagent.lifecycle").Start(ctx, operation)
	defer span.End()
	started := time.Now()
	err := run(child)
	elapsed := time.Since(started)
	if !strings.HasPrefix(operation, "guest.ready.") && (err != nil || elapsed >= 100*time.Millisecond) {
		slog.Info("guest lifecycle slow or failed phase", "operation", operation, "elapsedMs", elapsed.Seconds()*1000, "failed", err != nil)
	}
	if err != nil {
		span.SetStatus(codes.Error, "failed")
		return &guestLifecyclePhaseError{operation: operation, cause: err}
	}
	return nil
}
