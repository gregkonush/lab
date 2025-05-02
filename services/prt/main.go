package main

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
)

func handleRoot(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"message": "All systems are go!", "status": "OK"})
}

type DataPayload struct {
	Data string `json:"data"`
}

func handleData(c *gin.Context) {
	var payload DataPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		log.Printf("Error binding JSON: %s", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON payload"})
		return
	}

	log.Printf("Received POST data: %s", payload.Data)

	c.JSON(http.StatusOK, gin.H{"status": "Data received", "received_data": payload.Data})
}

func handleHealthz(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "healthy"})
}

func main() {
	router := gin.Default()

	router.GET("/", handleRoot)
	router.POST("/data", handleData)
	router.GET("/healthz", handleHealthz)

	log.Println("Starting server on :8080 using Gin")
	err := router.Run(":8080")
	if err != nil {
		log.Fatal("Failed to run server: ", err)
	}
}
