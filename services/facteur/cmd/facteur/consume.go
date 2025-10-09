package facteur

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/segmentio/kafka-go"
	"github.com/spf13/cobra"

	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/homedir"

	"github.com/gregkonush/lab/services/facteur/internal/argo"
	"github.com/gregkonush/lab/services/facteur/internal/bridge"
	"github.com/gregkonush/lab/services/facteur/internal/config"
	"github.com/gregkonush/lab/services/facteur/internal/consumer"
	"github.com/gregkonush/lab/services/facteur/internal/messaging"
	"github.com/gregkonush/lab/services/facteur/internal/session"
)

// NewConsumeCommand wires the Kafka consumer loop into the CLI.
func NewConsumeCommand() *cobra.Command {
	var configPath string

	cmd := &cobra.Command{
		Use:   "consume",
		Short: "Run the Discord command Kafka consumer",
		RunE: func(cmd *cobra.Command, _ []string) error {
			path := configPath
			if path == "" {
				path = os.Getenv("FACTEUR_CONFIG_FILE")
			}

			cfg, err := config.Load(path)
			if err != nil {
				return fmt.Errorf("load configuration: %w", err)
			}

			if !cfg.Consumer.Enabled {
				cmd.Println("Kafka consumer disabled; set consumer.enabled to true to run.")
				return nil
			}

			reader, err := messaging.NewReader(messaging.ReaderConfig{
				Brokers:  cfg.Consumer.Brokers,
				Topic:    cfg.Consumer.Topic,
				GroupID:  cfg.Consumer.GroupID,
				MinBytes: cfg.Consumer.MinBytes,
				MaxBytes: cfg.Consumer.MaxBytes,
				MaxWait:  cfg.Consumer.MaxWait,
				Security: messaging.SecurityConfig{
					TLS: messaging.TLSOptions{
						Enabled:            cfg.Consumer.TLS.Enabled,
						InsecureSkipVerify: cfg.Consumer.TLS.InsecureSkipVerify,
					},
					SASL: messaging.SASLOptions{
						Enabled:   cfg.Consumer.SASL.Enabled,
						Mechanism: cfg.Consumer.SASL.Mechanism,
						Username:  cfg.Consumer.SASL.Username,
						Password:  cfg.Consumer.SASL.Password,
					},
				},
			})
			if err != nil {
				return fmt.Errorf("init kafka reader: %w", err)
			}
			defer reader.Close()

			var dlqWriter *kafka.Writer
			if cfg.Consumer.DLQ.Enabled {
				writer, werr := messaging.NewWriter(messaging.WriterConfig{
					Brokers: cfg.Consumer.Brokers,
					Topic:   cfg.Consumer.DLQ.Topic,
					Security: messaging.SecurityConfig{
						TLS: messaging.TLSOptions{
							Enabled:            cfg.Consumer.TLS.Enabled,
							InsecureSkipVerify: cfg.Consumer.TLS.InsecureSkipVerify,
						},
						SASL: messaging.SASLOptions{
							Enabled:   cfg.Consumer.SASL.Enabled,
							Mechanism: cfg.Consumer.SASL.Mechanism,
							Username:  cfg.Consumer.SASL.Username,
							Password:  cfg.Consumer.SASL.Password,
						},
					},
				})
				if werr != nil {
					return fmt.Errorf("init kafka dlq writer: %w", werr)
				}
				defer writer.Close()
				dlqWriter = writer
			}

			store, err := session.NewRedisStoreFromURL(cfg.Redis.URL)
			if err != nil {
				return fmt.Errorf("init redis store: %w", err)
			}

			dispatcher, err := buildDispatcher(cfg)
			if err != nil {
				return err
			}

			options := []consumer.Option{consumer.WithStore(store)}
			if dlqWriter != nil {
				options = append(options, consumer.WithDLQ(dlqWriter))
			}

			commandConsumer, err := consumer.NewCommandConsumer(reader, dispatcher, options...)
			if err != nil {
				return fmt.Errorf("init command consumer: %w", err)
			}

			ctx, stop := signal.NotifyContext(cmd.Context(), os.Interrupt, syscall.SIGTERM)
			defer stop()

			cmd.Printf("facteur consumer listening on topic %s (group %s)\n", cfg.Consumer.Topic, cfg.Consumer.GroupID)
			if dlqWriter != nil {
				cmd.Printf("DLQ enabled -> %s\n", cfg.Consumer.DLQ.Topic)
			}

			if err := commandConsumer.Run(ctx); err != nil {
				if errors.Is(err, context.Canceled) {
					return nil
				}
				return err
			}

			cmd.Println("facteur consumer exited")
			return nil
		},
	}

	cmd.Flags().StringVar(&configPath, "config", "", "Path to configuration file (optional)")

	return cmd
}

func buildDispatcher(cfg *config.Config) (bridge.Dispatcher, error) {
	restCfg, err := resolveRESTConfig()
	if err != nil {
		return nil, err
	}

	argoClient, err := argo.NewKubernetesClientForConfig(restCfg)
	if err != nil {
		return nil, err
	}

	runner := argo.NewWorkflowRunner(argoClient)

	return bridge.NewDispatcher(runner, bridge.ServiceConfig{
		Namespace:        cfg.Argo.Namespace,
		WorkflowTemplate: cfg.Argo.WorkflowTemplate,
		ServiceAccount:   cfg.Argo.ServiceAccount,
		Parameters:       cfg.Argo.Parameters,
	})
}

func resolveRESTConfig() (*rest.Config, error) {
	if path := os.Getenv("FACTEUR_KUBECONFIG"); path != "" {
		cfg, err := clientcmd.BuildConfigFromFlags("", path)
		if err != nil {
			return nil, fmt.Errorf("kubeconfig %s: %w", path, err)
		}
		return cfg, nil
	}

	if env := os.Getenv("KUBECONFIG"); env != "" {
		cfg, err := clientcmd.BuildConfigFromFlags("", env)
		if err == nil {
			return cfg, nil
		}
	}

	if cfg, err := rest.InClusterConfig(); err == nil {
		return cfg, nil
	}

	if home := homedir.HomeDir(); home != "" {
		path := filepath.Join(home, ".kube", "config")
		if _, err := os.Stat(path); err == nil {
			cfg, err := clientcmd.BuildConfigFromFlags("", path)
			if err == nil {
				return cfg, nil
			}
		}
	}

	return nil, fmt.Errorf("unable to locate Kubernetes configuration; set FACTEUR_KUBECONFIG or KUBECONFIG")
}
