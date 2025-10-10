package consumer

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/gregkonush/lab/services/facteur/internal/bridge"
	"github.com/gregkonush/lab/services/facteur/internal/session"
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
	if dispatcher == nil {
		return bridge.DispatchResult{}, fmt.Errorf("consumer: dispatcher is required")
	}
	if event.Command == "" {
		return bridge.DispatchResult{}, fmt.Errorf("missing command field")
	}
	if event.Options == nil {
		event.Options = map[string]string{}
	}

	result, err := dispatcher.Dispatch(ctx, bridge.DispatchRequest{
		Command:       event.Command,
		UserID:        event.UserID,
		Options:       event.Options,
		CorrelationID: event.CorrelationID,
		TraceID:       event.TraceID,
	})
	if err != nil {
		return bridge.DispatchResult{}, fmt.Errorf("dispatch command: %w", err)
	}

	if event.CorrelationID != "" && result.CorrelationID == "" {
		result.CorrelationID = event.CorrelationID
	}

	if store != nil && event.UserID != "" {
		payload, marshalErr := json.Marshal(result)
		if marshalErr != nil {
			return bridge.DispatchResult{}, fmt.Errorf("persist dispatch result: %w", marshalErr)
		}
		sessionTTL := ttl
		if sessionTTL <= 0 {
			sessionTTL = DefaultSessionTTL
		}
		if err := store.Set(ctx, session.DispatchKey(event.UserID), payload, sessionTTL); err != nil {
			return bridge.DispatchResult{}, fmt.Errorf("persist dispatch result: %w", err)
		}
	}

	return result, nil
}
