package argo

import (
	"context"
	"testing"

	apiv1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/stretchr/testify/require"

	"github.com/argoproj/argo-workflows/v3/pkg/apis/workflow/v1alpha1"
	argofake "github.com/argoproj/argo-workflows/v3/pkg/client/clientset/versioned/fake"
)

func TestKubernetesClientSubmitWorkflow(t *testing.T) {
	clientset := argofake.NewSimpleClientset()
	client := &KubernetesClient{client: clientset}

	resp, err := client.SubmitWorkflow(context.Background(), SubmitRequest{
		Namespace:        "argo",
		WorkflowTemplate: "facteur-dispatch",
		GenerateName:     "dispatch-",
		ServiceAccount:   "facteur",
		Parameters:       map[string]string{"env": "staging", "cluster": "a"},
	})
	require.NoError(t, err)
	require.Equal(t, "argo", resp.Namespace)
	require.Equal(t, "dispatch-", resp.WorkflowName)

	list, err := clientset.ArgoprojV1alpha1().Workflows("argo").List(context.Background(), apiv1.ListOptions{})
	require.NoError(t, err)
	require.Len(t, list.Items, 1)
	created := list.Items[0]
	require.Equal(t, "dispatch-", created.GenerateName)
	require.Equal(t, "facteur", created.Spec.ServiceAccountName)
	require.NotNil(t, created.Spec.WorkflowTemplateRef)
	require.Equal(t, "facteur-dispatch", created.Spec.WorkflowTemplateRef.Name)
	params := created.Spec.Arguments.Parameters
	require.Len(t, params, 2)
	// The list is sorted alphabetically by key.
	require.Equal(t, "cluster", params[0].Name)
	require.NotNil(t, params[0].Value)
	require.Equal(t, "a", params[0].Value.String())
	require.Equal(t, "env", params[1].Name)
	require.Equal(t, "staging", params[1].Value.String())
}

func TestKubernetesClientTemplateStatus(t *testing.T) {
	tmpl := &v1alpha1.WorkflowTemplate{ObjectMeta: apiv1.ObjectMeta{Name: "facteur-dispatch", Namespace: "argo"}}

	clientset := argofake.NewSimpleClientset(tmpl)
	client := &KubernetesClient{client: clientset}

	status, err := client.GetWorkflowTemplate(context.Background(), "argo", "facteur-dispatch")
	require.NoError(t, err)
	require.True(t, status.Ready)
	require.Equal(t, "facteur-dispatch", status.Name)
	require.Equal(t, "argo", status.Namespace)
}
