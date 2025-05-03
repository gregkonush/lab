package prix

import (
	"time"

	"go.temporal.io/sdk/workflow"
)

func ListRepos(ctx workflow.Context) error {
	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 1 * time.Minute, // Increase timeout for network + db ops
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	err := workflow.ExecuteActivity(ctx, SearchMostPopularRepos).Get(ctx, nil) // No result expected, just error
	if err != nil {
		return err
	}
	return nil
}
