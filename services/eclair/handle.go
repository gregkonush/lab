package function

import (
    "fmt"
    "net/http"
    "time"
)

// Handle is the HTTP entrypoint for Knative Functions (Go runtime).
func Handle(w http.ResponseWriter, r *http.Request) {
    if r.URL.Path == "/healthz" {
        w.WriteHeader(http.StatusOK)
        _, _ = w.Write([]byte("ok"))
        return
    }

    w.Header().Set("Content-Type", "text/plain; charset=utf-8")
    _, _ = fmt.Fprintf(w, "Éclair: rapide et prospère — %s\n", time.Now().Format(time.RFC3339))
}
