package main

import (
	"log"
	"os"
	"os/signal"
	"syscall"

	prix "github.com/proompteng/lab/services/prix"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
)

func main() {
	// Initialize DB connection
	if err := prix.InitDB(); err != nil {
		log.Fatalln("Unable to initialize database connection", err)
	}
	defer prix.CloseDB()

	c, err := client.Dial(client.Options{})
	if err != nil {
		log.Fatalln("Unable to create Temporal client", err)
	}
	defer c.Close()

	w := worker.New(c, prix.TaskQueueName, worker.Options{})
	w.RegisterWorkflow(prix.ListRepos)
	w.RegisterActivity(prix.SearchMostPopularRepos)

	// Start worker in a separate goroutine
	go func() {
		err = w.Run(worker.InterruptCh())
		if err != nil {
			log.Fatalf("Unable to start Temporal worker: %v", err)
		}
	}()

	log.Println("Worker started. Press Ctrl+C to exit.")

	// Wait for interrupt signal
	interruptCh := make(chan os.Signal, 1)
	signal.Notify(interruptCh, os.Interrupt, syscall.SIGTERM)
	<-interruptCh

	log.Println("Shutting down worker gracefully...")
	// w.Run(worker.InterruptCh()) already handles graceful shutdown internally by stopping polling and waiting for activities to complete.
	// The channel blocks until shutdown is complete.
	// Adding an extra sleep might not be necessary unless there are specific non-Temporal cleanup tasks.
	// time.Sleep(2 * time.Second) // Optional extra wait time
	log.Println("Worker shutdown complete")
}
