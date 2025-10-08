package facteur

import (
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/spf13/cobra"

	"github.com/gregkonush/lab/services/facteur/internal/config"
	"github.com/gregkonush/lab/services/facteur/internal/server"
)

// NewServeCommand scaffolds the "serve" CLI command.
func NewServeCommand() *cobra.Command {
	var (
		configPath string
		prefork    bool
	)

	cmd := &cobra.Command{
		Use:   "serve",
		Short: "Start the facteur Discord ↔ Argo bridge server",
		RunE: func(cmd *cobra.Command, _ []string) error {
			path := configPath
			if path == "" {
				path = os.Getenv("FACTEUR_CONFIG_FILE")
			}

			cfg, err := config.Load(path)
			if err != nil {
				return fmt.Errorf("load configuration: %w", err)
			}

			srv, err := server.New(server.Options{
				ListenAddress: cfg.Server.ListenAddress,
				Prefork:       prefork,
			})
			if err != nil {
				return fmt.Errorf("init server: %w", err)
			}

			ctx, stop := signal.NotifyContext(cmd.Context(), os.Interrupt, syscall.SIGTERM)
			defer stop()

			cmd.Printf("facteur listening on %s\n", cfg.Server.ListenAddress)

			if err := srv.Run(ctx); err != nil {
				return err
			}

			cmd.Println("facteur server exited")
			return nil
		},
	}

	cmd.Flags().StringVar(&configPath, "config", "", "Path to configuration file (optional)")
	cmd.Flags().BoolVar(&prefork, "prefork", false, "Enable Fiber prefork mode for maximised throughput")

	return cmd
}
