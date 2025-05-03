package main

import (
	"log"
	prix "prix/app"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
)

func main() {
	c, err := client.Dial(client.Options{})
	if err != nil {
		log.Fatalln("Unable to create Temporal client", err)
	}
	defer c.Close()

	w := worker.New(c, prix.TaskQueueName, worker.Options{})
	w.RegisterWorkflow(prix.ListRepos)
	w.RegisterActivity(prix.SearchMostPopularRepos)

	err = w.Run(worker.InterruptCh())
	if err != nil {
		log.Fatalln("Unable to start Temporal worker", err)
	}
}
