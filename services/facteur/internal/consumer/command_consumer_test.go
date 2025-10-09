package consumer_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/segmentio/kafka-go"
	"github.com/stretchr/testify/require"

	"github.com/gregkonush/lab/services/facteur/internal/bridge"
	"github.com/gregkonush/lab/services/facteur/internal/consumer"
	"github.com/gregkonush/lab/services/facteur/internal/session"
)

func TestCommandConsumerSuccess(t *testing.T) {
	reader := &fakeReader{
		messages: []kafka.Message{
			{Value: []byte(`{"command":"dispatch","options":{"env":"staging"},"userId":"user-1","correlationId":"corr-1","traceId":"trace-1"}`)},
		},
	}
	dispatcher := &fakeDispatcher{
		result: bridge.DispatchResult{Namespace: "argo", WorkflowName: "facteur-dispatch", CorrelationID: "corr-1"},
	}
	store := &fakeStore{}

	cons, err := consumer.NewCommandConsumer(reader, dispatcher,
		consumer.WithStore(store),
		consumer.WithLogger(noopLogger{}),
		consumer.WithSessionTTL(time.Minute),
	)
	require.NoError(t, err)

	require.NoError(t, cons.Run(context.Background()))

	require.Equal(t, 1, dispatcher.calls)
	require.Equal(t, bridge.DispatchRequest{
		Command:       "dispatch",
		UserID:        "user-1",
		Options:       map[string]string{"env": "staging"},
		CorrelationID: "corr-1",
		TraceID:       "trace-1",
	}, dispatcher.lastReq)
	require.Equal(t, 1, len(reader.committed))
	require.True(t, store.setCalled)
	require.Equal(t, session.DispatchKey("user-1"), store.lastKey)
	require.True(t, store.lastTTL > 0)
}

func TestCommandConsumerFailureWithDLQ(t *testing.T) {
	reader := &fakeReader{messages: []kafka.Message{{Value: []byte(`{"command":"dispatch"}`)}}}
	dispatcher := &fakeDispatcher{err: errors.New("dispatch failed")}
	dlq := &fakeWriter{}

	cons, err := consumer.NewCommandConsumer(reader, dispatcher,
		consumer.WithDLQ(dlq),
		consumer.WithLogger(noopLogger{}),
	)
	require.NoError(t, err)

	require.NoError(t, cons.Run(context.Background()))
	require.Equal(t, 1, len(dlq.messages))
	require.Equal(t, 1, len(reader.committed))
}

func TestCommandConsumerFailureWithoutDLQ(t *testing.T) {
	reader := &fakeReader{messages: []kafka.Message{{Value: []byte(`{"command":"dispatch"}`)}}}
	dispatcher := &fakeDispatcher{err: errors.New("dispatch failed")}

	cons, err := consumer.NewCommandConsumer(reader, dispatcher, consumer.WithLogger(noopLogger{}))
	require.NoError(t, err)

	require.NoError(t, cons.Run(context.Background()))
	require.Equal(t, 0, len(reader.committed))
}

func TestProcessEventPersistsSession(t *testing.T) {
	dispatcher := &fakeDispatcher{result: bridge.DispatchResult{Namespace: "argo", WorkflowName: "wf-123"}}
	store := &fakeStore{}

	result, err := consumer.ProcessEvent(context.Background(), consumer.CommandEvent{
		Command:       "dispatch",
		UserID:        "user-1",
		Options:       map[string]string{"env": "staging"},
		CorrelationID: "corr-1",
	}, dispatcher, store, time.Minute)
	require.NoError(t, err)
	require.Equal(t, "wf-123", result.WorkflowName)
	require.True(t, store.setCalled)
	require.Equal(t, session.DispatchKey("user-1"), store.lastKey)
	// correlation should stick to provided value if dispatcher result empty
	require.Equal(t, "corr-1", dispatcher.lastReq.CorrelationID)
}

func TestProcessEventValidatesCommand(t *testing.T) {
	_, err := consumer.ProcessEvent(context.Background(), consumer.CommandEvent{}, &fakeDispatcher{}, nil, 0)
	require.Error(t, err)
	require.Contains(t, err.Error(), "missing command")
}

type fakeReader struct {
	messages  []kafka.Message
	index     int
	committed []kafka.Message
}

func (f *fakeReader) FetchMessage(context.Context) (kafka.Message, error) {
	if f.index < len(f.messages) {
		msg := f.messages[f.index]
		f.index++
		return msg, nil
	}
	return kafka.Message{}, context.Canceled
}

func (f *fakeReader) CommitMessages(_ context.Context, msgs ...kafka.Message) error {
	f.committed = append(f.committed, msgs...)
	return nil
}

func (f *fakeReader) Close() error { return nil }

type fakeDispatcher struct {
	result  bridge.DispatchResult
	err     error
	calls   int
	lastReq bridge.DispatchRequest
}

func (f *fakeDispatcher) Dispatch(_ context.Context, req bridge.DispatchRequest) (bridge.DispatchResult, error) {
	f.calls++
	f.lastReq = req
	if f.err != nil {
		return bridge.DispatchResult{}, f.err
	}
	return f.result, nil
}

func (f *fakeDispatcher) Status(context.Context) (bridge.StatusReport, error) {
	return bridge.StatusReport{}, nil
}

type fakeStore struct {
	setCalled bool
	lastKey   string
	lastTTL   time.Duration
}

func (f *fakeStore) Set(_ context.Context, key string, _ []byte, ttl time.Duration) error {
	f.setCalled = true
	f.lastKey = key
	f.lastTTL = ttl
	return nil
}

func (f *fakeStore) Get(context.Context, string) ([]byte, error) { return nil, session.ErrNotFound }

func (f *fakeStore) Delete(context.Context, string) error { return nil }

type fakeWriter struct {
	messages []kafka.Message
}

func (f *fakeWriter) WriteMessages(_ context.Context, msgs ...kafka.Message) error {
	f.messages = append(f.messages, msgs...)
	return nil
}

type noopLogger struct{}

func (noopLogger) Printf(string, ...interface{}) {}
