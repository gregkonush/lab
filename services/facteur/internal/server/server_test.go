package server_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/gregkonush/lab/services/facteur/internal/bridge"
	"github.com/gregkonush/lab/services/facteur/internal/consumer"
	"github.com/gregkonush/lab/services/facteur/internal/server"
	"github.com/gregkonush/lab/services/facteur/internal/session"
)

func TestEventsEndpointDispatches(t *testing.T) {
	dispatcher := &stubDispatcher{result: bridge.DispatchResult{Namespace: "argo", WorkflowName: "wf-123", CorrelationID: "corr-1"}}
	store := &stubStore{}

	srv, err := server.New(server.Options{Dispatcher: dispatcher, Store: store, SessionTTL: time.Minute})
	require.NoError(t, err)

	payload, err := json.Marshal(consumer.CommandEvent{Command: "dispatch", UserID: "user-1", Options: map[string]string{"env": "staging"}, CorrelationID: "corr-1"})
	require.NoError(t, err)

	req := httptest.NewRequest("POST", "/events", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")

	resp, err := srv.App().Test(req)
	require.NoError(t, err)
	require.Equal(t, 202, resp.StatusCode)
	require.True(t, store.setCalled)
	require.Equal(t, session.DispatchKey("user-1"), store.lastKey)
}

func TestEventsEndpointWithoutDispatcher(t *testing.T) {
	srv, err := server.New(server.Options{})
	require.NoError(t, err)

	req := httptest.NewRequest("POST", "/events", bytes.NewReader([]byte(`{"command":"dispatch"}`)))
	req.Header.Set("Content-Type", "application/json")

	resp, err := srv.App().Test(req)
	require.NoError(t, err)
	require.Equal(t, 503, resp.StatusCode)
}

type stubDispatcher struct {
	result bridge.DispatchResult
}

func (s *stubDispatcher) Dispatch(_ context.Context, req bridge.DispatchRequest) (bridge.DispatchResult, error) {
	s.result.CorrelationID = req.CorrelationID
	return s.result, nil
}

func (s *stubDispatcher) Status(context.Context) (bridge.StatusReport, error) {
	return bridge.StatusReport{}, nil
}

type stubStore struct {
	setCalled bool
	lastKey   string
}

func (s *stubStore) Set(_ context.Context, key string, _ []byte, _ time.Duration) error {
	s.setCalled = true
	s.lastKey = key
	return nil
}

func (s *stubStore) Get(context.Context, string) ([]byte, error) { return nil, session.ErrNotFound }

func (s *stubStore) Delete(context.Context, string) error { return nil }
