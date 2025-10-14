package bridge_test

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/proompteng/lab/services/facteur/internal/argo"
	"github.com/proompteng/lab/services/facteur/internal/bridge"
)

func TestWorkflowDispatcherDispatch(t *testing.T) {
	ctx := context.Background()
	runner := &fakeRunner{
		runResult: argo.RunResult{Namespace: "argo", WorkflowName: "dispatch-123"},
	}

	dispatcher, err := bridge.NewDispatcher(runner, bridge.ServiceConfig{
		Namespace:        "argo",
		WorkflowTemplate: "facteur-dispatch",
		ServiceAccount:   "facteur",
		Parameters:       map[string]string{"payload": "{}"},
	})
	require.NoError(t, err)

	result, err := dispatcher.Dispatch(ctx, bridge.DispatchRequest{
		Command: "plan",
		Options: map[string]string{"payload": `{"prompt":"Generate plan"}`},
	})
	require.NoError(t, err)
	require.Equal(t, "dispatch-123", result.WorkflowName)
	require.Equal(t, "dispatch-123", result.CorrelationID)
	require.Contains(t, result.Message, "dispatch-123")

	require.True(t, runner.runCalled)
	require.Equal(t, argo.RunInput{
		Namespace:          "argo",
		WorkflowTemplate:   "facteur-dispatch",
		ServiceAccount:     "facteur",
		Parameters:         map[string]string{"payload": `{"prompt":"Generate plan"}`},
		GenerateNamePrefix: "plan",
	}, runner.lastRunInput)
}

func TestWorkflowDispatcherDispatchUsesRequestCorrelation(t *testing.T) {
	ctx := context.Background()
	runner := &fakeRunner{
		runResult: argo.RunResult{Namespace: "argo", WorkflowName: "dispatch-456"},
	}

	dispatcher, err := bridge.NewDispatcher(runner, bridge.ServiceConfig{
		Namespace:        "argo",
		WorkflowTemplate: "facteur-dispatch",
	})
	require.NoError(t, err)

	result, err := dispatcher.Dispatch(ctx, bridge.DispatchRequest{
		Command:       "plan",
		CorrelationID: "corr-abc",
		TraceID:       "trace-123",
	})
	require.NoError(t, err)
	require.Equal(t, "corr-abc", result.CorrelationID)
	require.Equal(t, "trace-123", result.TraceID)
}

func TestWorkflowDispatcherStatus(t *testing.T) {
	runner := &fakeRunner{templateStatus: argo.TemplateStatus{Name: "facteur-dispatch", Namespace: "argo", Ready: true}}
	dispatcher, err := bridge.NewDispatcher(runner, bridge.ServiceConfig{Namespace: "argo", WorkflowTemplate: "facteur-dispatch"})
	require.NoError(t, err)

	status, err := dispatcher.Status(context.Background())
	require.NoError(t, err)
	require.True(t, runner.statusCalled)
	require.True(t, status.Ready)
	require.Contains(t, status.Message, "ready")
}

func TestWorkflowDispatcherErrors(t *testing.T) {
	_, err := bridge.NewDispatcher(nil, bridge.ServiceConfig{})
	require.Error(t, err)

	runner := &fakeRunner{statusErr: errors.New("boom")}
	dispatcher, err := bridge.NewDispatcher(runner, bridge.ServiceConfig{Namespace: "argo", WorkflowTemplate: "template"})
	require.NoError(t, err)

	_, err = dispatcher.Status(context.Background())
	require.Error(t, err)

	runner = &fakeRunner{runErr: errors.New("submit failed")}
	dispatcher, err = bridge.NewDispatcher(runner, bridge.ServiceConfig{Namespace: "argo", WorkflowTemplate: "template"})
	require.NoError(t, err)

	_, err = dispatcher.Dispatch(context.Background(), bridge.DispatchRequest{})
	require.Error(t, err)
}

type fakeRunner struct {
	runCalled      bool
	statusCalled   bool
	lastRunInput   argo.RunInput
	runResult      argo.RunResult
	templateStatus argo.TemplateStatus
	runErr         error
	statusErr      error
}

func (f *fakeRunner) Run(_ context.Context, input argo.RunInput) (argo.RunResult, error) {
	f.runCalled = true
	f.lastRunInput = input
	if f.runErr != nil {
		return argo.RunResult{}, f.runErr
	}
	return f.runResult, nil
}

func (f *fakeRunner) TemplateStatus(context.Context, string, string) (argo.TemplateStatus, error) {
	f.statusCalled = true
	if f.statusErr != nil {
		return argo.TemplateStatus{}, f.statusErr
	}
	return f.templateStatus, nil
}
