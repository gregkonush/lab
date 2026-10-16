//go:build linux

package main

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"strings"
	"testing"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

func TestGuestLifecycleControlJoinsHostTraceWithoutExportingRequest(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	t.Cleanup(func() {
		otel.SetTracerProvider(previous)
		_ = provider.Shutdown(context.Background())
	})
	server, client := net.Pipe()
	defer client.Close()
	done := make(chan struct{})
	go func() {
		defer close(done)
		defer server.Close()
		(&guestLifecycle{}).handle(server)
	}()
	if err := json.NewEncoder(client).Encode(guestLifecycleRequest{
		Action: "PRIVATE_SENTINEL", Traceparent: "00-11111111111111111111111111111111-2222222222222222-01",
		Claim: guestClaim{MicroVMID: "PRIVATE_OWNER"},
	}); err != nil {
		t.Fatal(err)
	}
	var response struct{ Ok bool }
	if err := json.NewDecoder(client).Decode(&response); err != nil || response.Ok {
		t.Fatalf("unknown lifecycle action accepted: %v", err)
	}
	<-done
	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("expected a lifecycle span, got %d", len(spans))
	}
	span := spans[0]
	if span.Name() != "guest.lifecycle.unknown" || span.SpanContext().TraceID().String() != strings.Repeat("1", 32) || span.Parent().SpanID().String() != strings.Repeat("2", 16) {
		t.Fatalf("lifecycle trace lost its safe operation or parent: %s %v", span.Name(), span.SpanContext())
	}
	if span.Status().Code != codes.Error || span.Status().Description != "failed" || len(span.Attributes()) != 0 || len(span.Events()) != 0 || !span.EndTime().After(span.StartTime()) {
		t.Fatalf("invalid lifecycle failure trace: %v", span)
	}
}

func TestGuestLifecyclePhaseRetainsCauseAndScrubsTrace(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	t.Cleanup(func() {
		otel.SetTracerProvider(previous)
		_ = provider.Shutdown(context.Background())
	})
	cause := errors.New("PRIVATE_SENTINEL")
	err := observeLifecyclePhase(context.Background(), "guest.resume.terminal", func(context.Context) error { return cause })
	var phase *guestLifecyclePhaseError
	if !errors.Is(err, cause) || !errors.As(err, &phase) || phase.operation != "guest.resume.terminal" {
		t.Fatalf("phase failure lost its original cause: %v", err)
	}
	spans := recorder.Ended()
	if len(spans) != 1 || spans[0].Status().Code != codes.Error || spans[0].Status().Description != "failed" || len(spans[0].Events()) != 0 || spans[0].EndTime().Sub(spans[0].StartTime()) < 0*time.Second {
		t.Fatalf("phase trace missing or leaked failure content: %v", spans)
	}
}
