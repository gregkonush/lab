package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPinnedCodexRecoversAcceptanceFromPersistedClientIdentity(t *testing.T) {
	binary := os.Getenv("TENGRI_CODEX_CONTRACT_BINARY")
	if binary == "" {
		t.Skip("set TENGRI_CODEX_CONTRACT_BINARY to the pinned Codex 0.159.2 binary")
	}
	version, err := exec.Command(binary, "--version").Output()
	if err != nil || strings.TrimSpace(string(version)) != "codex-cli 0.159.2" {
		t.Fatalf("wrong native contract binary: %s %v", version, err)
	}
	home := t.TempDir()
	workspace := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	t.Cleanup(cancel)
	started := make(chan struct{}, 1)
	stopped := make(chan struct{}, 1)
	provider := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != "POST" || !strings.HasSuffix(request.URL.Path, "/responses") {
			response.WriteHeader(http.StatusNotFound)
			return
		}
		_, _ = io.Copy(io.Discard, request.Body)
		response.Header().Set("Content-Type", "text/event-stream")
		response.WriteHeader(http.StatusOK)
		response.(http.Flusher).Flush()
		select {
		case started <- struct{}{}:
		default:
		}
		select {
		case <-request.Context().Done():
		case <-ctx.Done():
		}
		select {
		case stopped <- struct{}{}:
		default:
		}
	}))
	t.Cleanup(provider.Close)
	t.Setenv("CODEX_HOME", home)
	t.Setenv("OPENAI_API_KEY", "")
	config := fmt.Sprintf(`model = "fixture"
model_provider = "fixture"
[model_providers.fixture]
name = "Fixture"
base_url = %q
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
request_max_retries = 0
stream_max_retries = 0
`, provider.URL)
	if err := os.WriteFile(filepath.Join(home, "config.toml"), []byte(config), 0600); err != nil {
		t.Fatal(err)
	}
	supervisor := newCodexSupervisor(binary, workspace)
	supervisor.start()
	t.Cleanup(supervisor.close)
	raw, _ := json.Marshal(map[string]any{"model": "fixture", "modelProvider": "fixture", "cwd": workspace, "historyMode": "paginated", "approvalPolicy": "on-request", "sandbox": "danger-full-access"})
	result, err := supervisor.call(ctx, "thread/start", raw)
	if err != nil {
		t.Fatal(err)
	}
	var thread struct {
		Thread struct {
			ID string `json:"id"`
		} `json:"thread"`
	}
	if json.Unmarshal(result.result, &thread) != nil || thread.Thread.ID == "" {
		t.Fatalf("invalid native thread: %s", result.result)
	}
	params := strings.Replace(operationParams, "thread-1", thread.Thread.ID, 1)
	accepted, err := supervisor.call(ctx, "turn/start", json.RawMessage(params))
	if err != nil {
		t.Fatal(err)
	}
	var turn struct {
		Turn struct {
			ID string `json:"id"`
		} `json:"turn"`
	}
	if json.Unmarshal(accepted.result, &turn) != nil || turn.Turn.ID == "" {
		t.Fatalf("invalid native turn: %s", accepted.result)
	}
	path := filepath.Join(workspace, ".tengri", "codex-operations", "11111111-1111-4111-8111-111111111111.json")
	receipt, err := readCodexOperation(path)
	if err != nil {
		t.Fatal(err)
	}
	// Model the crash window after Codex accepted the turn but before its response was committed.
	receipt.State = "dispatching"
	receipt.Result = nil
	if err := writeCodexOperation(path, receipt); err != nil {
		t.Fatal(err)
	}
	for {
		recovered, err := supervisor.call(ctx, "turn/start", json.RawMessage(params))
		if err == nil {
			var recoveredTurn struct {
				Turn struct {
					ID string `json:"id"`
				} `json:"turn"`
			}
			if json.Unmarshal(recovered.result, &recoveredTurn) != nil || recoveredTurn.Turn.ID != turn.Turn.ID {
				t.Fatalf("recovery changed the native turn: %s", recovered.result)
			}
			break
		}
		if ctx.Err() != nil {
			t.Fatal("native client identity did not become recoverable", err)
		}
		time.Sleep(50 * time.Millisecond)
	}
	interrupt, _ := json.Marshal(map[string]any{"threadId": thread.Thread.ID, "turnId": turn.Turn.ID, "clientUserMessageId": "22222222-2222-4222-8222-222222222222"})
	select {
	case <-started:
	case <-ctx.Done():
		t.Fatal("native model request did not reach the held loopback provider")
	}
	if _, err := supervisor.call(ctx, "turn/interrupt", interrupt); err != nil {
		t.Fatal("native interrupt failed", err)
	}
	for {
		params, _ := json.Marshal(map[string]any{"threadId": thread.Thread.ID, "limit": 100, "sortDirection": "desc", "itemsView": "notLoaded"})
		page, err := supervisor.call(ctx, "thread/turns/list", params)
		if err != nil {
			t.Fatal(err)
		}
		var turns struct {
			Data []struct {
				ID     string `json:"id"`
				Status string `json:"status"`
			} `json:"data"`
		}
		if json.Unmarshal(page.result, &turns) != nil {
			t.Fatal("invalid native turn page")
		}
		for _, observed := range turns.Data {
			if observed.ID == turn.Turn.ID && observed.Status == "interrupted" {
				select {
				case <-stopped:
					return
				case <-ctx.Done():
					t.Fatal("turn interrupted but its model request was not cancelled")
				}
			}
		}
		if ctx.Err() != nil {
			t.Fatal("Stop never reached an authoritative terminal turn")
		}
		time.Sleep(50 * time.Millisecond)
	}
}
