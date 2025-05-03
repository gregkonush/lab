package prix

import (
	"time"

	"go.temporal.io/sdk/workflow"
)

func ListRepos(ctx workflow.Context) ([]Repo, error) {
	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Second,
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	var result []Repo
	err := workflow.ExecuteActivity(ctx, SearchMostPopularRepos).Get(ctx, &result)
	if err != nil {
		return nil, err
	}
	return result, nil
}
