package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func setupRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/", handleRoot)
	router.POST("/data", handleData)
	router.GET("/healthz", handleHealthz)
	return router
}

func TestHandleRoot(t *testing.T) {
	router := setupRouter()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/", nil)
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	expectedBody := `{"message":"All systems are go!","status":"OK"}`
	assert.JSONEq(t, expectedBody, w.Body.String())
}

func TestHandleData_Success(t *testing.T) {
	router := setupRouter()

	w := httptest.NewRecorder()
	payload := `{"data": "test data"}`
	req, _ := http.NewRequest(http.MethodPost, "/data", bytes.NewBufferString(payload))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]string
	err := json.Unmarshal(w.Body.Bytes(), &response)
	assert.NoError(t, err)
	assert.Equal(t, "Data received", response["status"])
	assert.Equal(t, "test data", response["received_data"])
}

func TestHandleData_BadRequest(t *testing.T) {
	router := setupRouter()

	w := httptest.NewRecorder()
	payload := `{"invalid json`
	req, _ := http.NewRequest(http.MethodPost, "/data", bytes.NewBufferString(payload))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)

	expectedBody := `{"error":"Invalid JSON payload"}`
	assert.JSONEq(t, expectedBody, w.Body.String())
}

func TestHandleHealthz(t *testing.T) {
	router := setupRouter()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/healthz", nil)
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	expectedBody := `{"status":"healthy"}`
	assert.JSONEq(t, expectedBody, w.Body.String())
}
