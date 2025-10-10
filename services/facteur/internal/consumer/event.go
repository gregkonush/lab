package consumer

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/gregkonush/lab/services/facteur/internal/bridge"
	"github.com/gregkonush/lab/services/facteur/internal/session"
	"github.com/gregkonush/lab/services/facteur/internal/telemetry"
)

const (
	// DefaultSessionTTL defines the default expiry for persisted Discord command sessions.
	DefaultSessionTTL = 15 * time.Minute
)

// CommandEvent matches the JSON schema published by Froussard.
type CommandEvent struct {
	Command       string            `json:"command"`
	Options       map[string]string `json:"options"`
	UserID        string            `json:"userId"`
	CorrelationID string            `json:"correlationId"`
	TraceID       string            `json:"traceId"`
}

// ProcessEvent dispatches a command event and persists session metadata when a store is provided.
func ProcessEvent(ctx context.Context, event CommandEvent, dispatcher bridge.Dispatcher, store session.Store, ttl time.Duration) (bridge.DispatchResult, error) {
	ctx, span := telemetry.Tracer().Start(ctx, "facteur.consumer.process_event", trace.WithSpanKind(trace.SpanKindInternal))
	defer span.End()

	span.SetAttributes(
		attribute.String("facteur.command", event.Command),
		attribute.String("facteur.user_id", event.UserID),
	)
	if event.TraceID != "" {
		span.SetAttributes(attribute.String("facteur.trace_id", event.TraceID))
	}

	if dispatcher == nil {
		err := fmt.Errorf("consumer: dispatcher is required")
		telemetry.RecordCommandFailed(ctx, event.Command)
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return bridge.DispatchResult{}, err
	}
	if event.Command == "" {
		err := fmt.Errorf("missing command field")
		telemetry.RecordCommandFailed(ctx, event.Command)
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return bridge.DispatchResult{}, err
	}
	if event.Options == nil {
		event.Options = map[string]string{}
	}

	start := time.Now()
	result, err := dispatcher.Dispatch(ctx, bridge.DispatchRequest{
		Command:       event.Command,
		UserID:        event.UserID,
		Options:       event.Options,
		CorrelationID: event.CorrelationID,
		TraceID:       event.TraceID,
	})
	if err != nil {
		telemetry.RecordCommandFailed(ctx, event.Command)
		wrapped := fmt.Errorf("dispatch command: %w", err)
		span.RecordError(wrapped)
		span.SetStatus(codes.Error, err.Error())
		return bridge.DispatchResult{}, wrapped
	}
	duration := time.Since(start)
	telemetry.RecordCommandProcessed(ctx, event.Command, duration)

	if event.CorrelationID != "" && result.CorrelationID == "" {
		result.CorrelationID = event.CorrelationID
	}

	if store != nil && event.UserID != "" {
		payload, marshalErr := json.Marshal(result)
		if marshalErr != nil {
			telemetry.RecordCommandFailed(ctx, event.Command)
			wrapped := fmt.Errorf("persist dispatch result: %w", marshalErr)
			span.RecordError(wrapped)
			span.SetStatus(codes.Error, marshalErr.Error())
			return bridge.DispatchResult{}, wrapped
		}
		sessionTTL := ttl
		if sessionTTL <= 0 {
			sessionTTL = DefaultSessionTTL
		}
		if err := store.Set(ctx, session.DispatchKey(event.UserID), payload, sessionTTL); err != nil {
			telemetry.RecordCommandFailed(ctx, event.Command)
			wrapped := fmt.Errorf("persist dispatch result: %w", err)
			span.RecordError(wrapped)
			span.SetStatus(codes.Error, err.Error())
			return bridge.DispatchResult{}, wrapped
		}
	}

	span.SetAttributes(
		attribute.String("facteur.workflow_name", result.WorkflowName),
		attribute.String("facteur.workflow_namespace", result.Namespace),
	)
	if result.CorrelationID != "" {
		span.SetAttributes(attribute.String("facteur.correlation_id", result.CorrelationID))
	}
	span.SetStatus(codes.Ok, "event processed")

	return result, nil
}
