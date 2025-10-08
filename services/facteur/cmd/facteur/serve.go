package facteur

import "github.com/spf13/cobra"

// NewServeCommand scaffolds the "serve" CLI command.
func NewServeCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "serve",
		Short: "Start the facteur Discord ↔ Argo bridge server",
		RunE: func(cmd *cobra.Command, _ []string) error {
			cmd.Println("facteur serve: implementation pending")
			return nil
		},
	}
}
