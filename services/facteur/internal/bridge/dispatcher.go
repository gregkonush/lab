package bridge

import (
	"context"
	"fmt"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/proompteng/lab/services/facteur/internal/argo"
	"github.com/proompteng/lab/services/facteur/internal/telemetry"
)

// DispatchRequest describes a workflow submission triggered by a Discord command.
type DispatchRequest struct {
	Command       string
	UserID        string
	Options       map[string]string
	CorrelationID string
	TraceID       string
}

// DispatchResult captures workflow submission metadata to echo back to Discord.
type DispatchResult struct {
	Namespace     string
	WorkflowName  string
	Message       string
	CorrelationID string
	TraceID       string
}

// StatusReport summarises the configured workflow template state.
type StatusReport struct {
	Namespace        string
	WorkflowTemplate string
	Ready            bool
	Message          string
}

// Dispatcher bridges Discord command handlers to the Argo workflow runner layer.
type Dispatcher interface {
	Dispatch(ctx context.Context, req DispatchRequest) (DispatchResult, error)
	Status(ctx context.Context) (StatusReport, error)
}

// ServiceConfig provides the static configuration needed to submit workflows.
type ServiceConfig struct {
	Namespace        string
	WorkflowTemplate string
	ServiceAccount   string
	Parameters       map[string]string
}

// WorkflowDispatcher is the concrete implementation of Dispatcher.
type WorkflowDispatcher struct {
	runner argo.Runner
	cfg    ServiceConfig
}

// NewDispatcher constructs a WorkflowDispatcher.
func NewDispatcher(runner argo.Runner, cfg ServiceConfig) (*WorkflowDispatcher, error) {
	if runner == nil {
		return nil, fmt.Errorf("bridge: runner is required")
	}
	if cfg.Namespace == "" {
		return nil, fmt.Errorf("bridge: namespace is required")
	}
	if cfg.WorkflowTemplate == "" {
		return nil, fmt.Errorf("bridge: workflow template is required")
	}

	return &WorkflowDispatcher{
		runner: runner,
		cfg: ServiceConfig{
			Namespace:        cfg.Namespace,
			WorkflowTemplate: cfg.WorkflowTemplate,
			ServiceAccount:   cfg.ServiceAccount,
			Parameters:       clone(cfg.Parameters),
		},
	}, nil
}

// Dispatch submits a WorkflowRun based on the configured template.
func (d *WorkflowDispatcher) Dispatch(ctx context.Context, req DispatchRequest) (DispatchResult, error) {
	ctx, span := telemetry.Tracer().Start(ctx, "facteur.bridge.dispatch", trace.WithSpanKind(trace.SpanKindClient))
	defer span.End()

	span.SetAttributes(
		attribute.String("facteur.command", req.Command),
		attribute.String("facteur.user_id", req.UserID),
		attribute.String("facteur.workflow_template", d.cfg.WorkflowTemplate),
		attribute.String("facteur.target_namespace", d.cfg.Namespace),
	)
	if req.TraceID != "" {
		span.SetAttributes(attribute.String("facteur.trace_id", req.TraceID))
	}

	merged := mergeParameters(d.cfg.Parameters, req.Options)

	result, err := d.runner.Run(ctx, argo.RunInput{
		Namespace:          d.cfg.Namespace,
		WorkflowTemplate:   d.cfg.WorkflowTemplate,
		ServiceAccount:     d.cfg.ServiceAccount,
		Parameters:         merged,
		GenerateNamePrefix: req.Command,
	})
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return DispatchResult{}, fmt.Errorf("bridge: dispatch workflow: %w", err)
	}

	message := fmt.Sprintf("Workflow `%s` submitted to namespace `%s`.", result.WorkflowName, result.Namespace)

	correlationID := req.CorrelationID
	if correlationID == "" {
		correlationID = result.WorkflowName
	}

	span.SetAttributes(
		attribute.String("facteur.workflow_name", result.WorkflowName),
		attribute.String("facteur.workflow_namespace", result.Namespace),
	)
	span.SetStatus(codes.Ok, "workflow dispatched")

	return DispatchResult{
		Namespace:     result.Namespace,
		WorkflowName:  result.WorkflowName,
		Message:       message,
		CorrelationID: correlationID,
		TraceID:       req.TraceID,
	}, nil
}

// Status verifies that the configured WorkflowTemplate is available.
func (d *WorkflowDispatcher) Status(ctx context.Context) (StatusReport, error) {
	ctx, span := telemetry.Tracer().Start(ctx, "facteur.bridge.status", trace.WithSpanKind(trace.SpanKindClient))
	defer span.End()

	span.SetAttributes(
		attribute.String("facteur.workflow_template", d.cfg.WorkflowTemplate),
		attribute.String("facteur.target_namespace", d.cfg.Namespace),
	)

	status, err := d.runner.TemplateStatus(ctx, d.cfg.Namespace, d.cfg.WorkflowTemplate)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return StatusReport{}, fmt.Errorf("bridge: template status: %w", err)
	}

	message := fmt.Sprintf("Workflow template `%s` in namespace `%s` is ready.", status.Name, status.Namespace)
	if !status.Ready {
		message = fmt.Sprintf("Workflow template `%s` in namespace `%s` is not ready.", status.Name, status.Namespace)
	}

	span.SetAttributes(
		attribute.Bool("facteur.template_ready", status.Ready),
		attribute.String("facteur.status_message", message),
	)
	span.SetStatus(codes.Ok, "status retrieved")

	return StatusReport{
		Namespace:        status.Namespace,
		WorkflowTemplate: status.Name,
		Ready:            status.Ready,
		Message:          message,
	}, nil
}

func mergeParameters(base, overrides map[string]string) map[string]string {
	merged := clone(base)
	for k, v := range overrides {
		if merged == nil {
			merged = map[string]string{}
		}
		merged[k] = v
	}
	return merged
}

func clone(input map[string]string) map[string]string {
	if len(input) == 0 {
		return map[string]string{}
	}

	out := make(map[string]string, len(input))
	for k, v := range input {
		out[k] = v
	}
	return out
}
