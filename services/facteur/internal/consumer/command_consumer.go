package consumer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"time"

	"github.com/segmentio/kafka-go"

	"github.com/gregkonush/lab/services/facteur/internal/bridge"
	"github.com/gregkonush/lab/services/facteur/internal/session"
)

const (
	DefaultSessionTTL = 15 * time.Minute
)

// Reader exposes the kafka-go reader surface required by the consumer.
type Reader interface {
	FetchMessage(ctx context.Context) (kafka.Message, error)
	CommitMessages(ctx context.Context, msgs ...kafka.Message) error
	Close() error
}

// Writer exposes the kafka-go writer surface used for DLQ publishing.
type Writer interface {
	WriteMessages(ctx context.Context, msgs ...kafka.Message) error
}

// Logger matches the subset of log.Logger used for observability.
type Logger interface {
	Printf(format string, v ...interface{})
}

// CommandConsumer bridges Discord command events from Kafka to the dispatcher.
type CommandConsumer struct {
	reader     Reader
	dispatcher bridge.Dispatcher
	store      session.Store
	dlq        Writer
	logger     Logger
	sessionTTL time.Duration
}

// Option customises a CommandConsumer.
type Option func(*CommandConsumer)

// WithStore configures session persistence.
func WithStore(store session.Store) Option {
	return func(c *CommandConsumer) { c.store = store }
}

// WithDLQ attaches a dead-letter publisher.
func WithDLQ(writer Writer) Option {
	return func(c *CommandConsumer) { c.dlq = writer }
}

// WithLogger overrides the logger (defaults to log.Default()).
func WithLogger(logger Logger) Option {
	return func(c *CommandConsumer) { c.logger = logger }
}

// WithSessionTTL overrides the TTL for persisted session data.
func WithSessionTTL(ttl time.Duration) Option {
	return func(c *CommandConsumer) {
		if ttl > 0 {
			c.sessionTTL = ttl
		}
	}
}

// NewCommandConsumer constructs a consumer for Discord command events.
func NewCommandConsumer(reader Reader, dispatcher bridge.Dispatcher, opts ...Option) (*CommandConsumer, error) {
	if reader == nil {
		return nil, fmt.Errorf("consumer: reader is required")
	}
	if dispatcher == nil {
		return nil, fmt.Errorf("consumer: dispatcher is required")
	}

	consumer := &CommandConsumer{
		reader:     reader,
		dispatcher: dispatcher,
		logger:     log.Default(),
		sessionTTL: DefaultSessionTTL,
	}
	for _, opt := range opts {
		opt(consumer)
	}

	return consumer, nil
}

// Run starts the consumer loop and blocks until the context is cancelled or an unrecoverable error occurs.
func (c *CommandConsumer) Run(ctx context.Context) error {
	for {
		msg, err := c.reader.FetchMessage(ctx)
		if err != nil {
			if errors.Is(err, context.Canceled) || errors.Is(err, io.EOF) {
				return nil
			}
			if ctx.Err() != nil {
				return nil
			}
			return fmt.Errorf("consumer: fetch message: %w", err)
		}

		if err := c.handleMessage(ctx, msg); err != nil {
			c.logf("command consumer failure: topic=%s partition=%d offset=%d err=%v", msg.Topic, msg.Partition, msg.Offset, err)
			if c.dlq != nil {
				dlqMsg := kafka.Message{
					Key:     msg.Key,
					Value:   msg.Value,
					Headers: append(msg.Headers, kafka.Header{Key: "facteur-error", Value: []byte(err.Error())}),
				}
				if dlqErr := c.dlq.WriteMessages(ctx, dlqMsg); dlqErr != nil {
					c.logf("command consumer DLQ publish failed: %v", dlqErr)
					continue
				}
				if err := c.reader.CommitMessages(ctx, msg); err != nil {
					return fmt.Errorf("consumer: commit after dlq: %w", err)
				}
				continue
			}

			// Without a DLQ we intentionally do not commit the offset so the message is retried by the consumer group.
			continue
		}

		if err := c.reader.CommitMessages(ctx, msg); err != nil {
			return fmt.Errorf("consumer: commit message: %w", err)
		}
	}
}

func (c *CommandConsumer) handleMessage(ctx context.Context, msg kafka.Message) error {
	var event CommandEvent
	if err := json.Unmarshal(msg.Value, &event); err != nil {
		return fmt.Errorf("decode event: %w", err)
	}

	result, err := ProcessEvent(ctx, event, c.dispatcher, c.store, c.sessionTTL)
	if err != nil {
		return err
	}

	correlation := result.CorrelationID
	if correlation == "" {
		correlation = "(none)"
	}

	c.logf(
		"command consumer success: command=%s user=%s workflow=%s namespace=%s correlation=%s trace=%s partition=%d offset=%d",
		event.Command,
		event.UserID,
		result.WorkflowName,
		result.Namespace,
		correlation,
		event.TraceID,
		msg.Partition,
		msg.Offset,
	)

	return nil
}

func (c *CommandConsumer) logf(format string, v ...interface{}) {
	if c.logger != nil {
		c.logger.Printf(format, v...)
		return
	}
	log.Printf(format, v...)
}

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
