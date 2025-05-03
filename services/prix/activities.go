package prix

import (
	"context"
	"fmt"
	"log"

	"github.com/google/go-github/v71/github"
)

type Repo struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

func SearchMostPopularRepos(ctx context.Context) ([]Repo, error) {
	client := github.NewClient(nil)
	opts := &github.SearchOptions{
		Sort:        "stars",
		Order:       "desc",
		ListOptions: github.ListOptions{PerPage: 10},
	}
	result, _, err := client.Search.Repositories(ctx, "stars:>1", opts)
	if err != nil {
		log.Printf("Error searching repositories: %v", err)
		return nil, fmt.Errorf("failed to search repositories: %w", err)
	}

	var repos []Repo
	log.Printf("Found %d repos\n", *result.Total)
	for _, repo := range result.Repositories {
		repos = append(repos, Repo{
			Name: *repo.FullName,
			URL:  *repo.HTMLURL,
		})
	}
	return repos, nil
}
