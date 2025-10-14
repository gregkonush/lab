package controller

import (
	"context"
	"fmt"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"
	"sigs.k8s.io/controller-runtime/pkg/log"

	v1alpha1 "github.com/proompteng/lab/services/tigresse/api/v1alpha1"
	"github.com/proompteng/lab/services/tigresse/internal/builder"
)

// TigerBeetleClusterReconciler reconciles TigerBeetleCluster custom resources.
type TigerBeetleClusterReconciler struct {
	client.Client
	Scheme *runtime.Scheme
}

// Reconcile ensures desired state of a TigerBeetle cluster.
func (r *TigerBeetleClusterReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	logger := log.FromContext(ctx)

	var cluster v1alpha1.TigerBeetleCluster
	if err := r.Get(ctx, req.NamespacedName, &cluster); err != nil {
		if errors.IsNotFound(err) {
			return ctrl.Result{}, nil
		}
		return ctrl.Result{}, fmt.Errorf("failed to fetch TigerBeetleCluster: %w", err)
	}

	if updated := cluster.ApplyDefaults(); updated {
		if err := r.Update(ctx, &cluster); err != nil {
			return ctrl.Result{}, fmt.Errorf("failed to apply defaults: %w", err)
		}
		logger.Info("applied defaults", "name", cluster.Name)
	}

	if err := r.reconcileConfigMap(ctx, &cluster); err != nil {
		return ctrl.Result{}, err
	}

	if err := r.reconcileService(ctx, &cluster); err != nil {
		return ctrl.Result{}, err
	}

	if err := r.reconcileHeadlessService(ctx, &cluster); err != nil {
		return ctrl.Result{}, err
	}

	if err := r.reconcileStatefulSet(ctx, &cluster); err != nil {
		return ctrl.Result{}, err
	}

	if err := r.updateStatus(ctx, &cluster); err != nil {
		return ctrl.Result{}, err
	}

	return ctrl.Result{}, nil
}

func (r *TigerBeetleClusterReconciler) reconcileConfigMap(ctx context.Context, cluster *v1alpha1.TigerBeetleCluster) error {
	desired := builder.BuildConfigMap(cluster)
	cm := &corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{Name: desired.Name, Namespace: desired.Namespace}}

	_, err := controllerutil.CreateOrUpdate(ctx, r.Client, cm, func() error {
		cm.Labels = desired.Labels
		cm.Data = desired.Data
		cm.BinaryData = desired.BinaryData
		return controllerutil.SetControllerReference(cluster, cm, r.Scheme)
	})
	if err != nil {
		return fmt.Errorf("failed to reconcile ConfigMap: %w", err)
	}
	return nil
}

func (r *TigerBeetleClusterReconciler) reconcileService(ctx context.Context, cluster *v1alpha1.TigerBeetleCluster) error {
	desired := builder.BuildService(cluster)
	svc := &corev1.Service{ObjectMeta: metav1.ObjectMeta{Name: desired.Name, Namespace: desired.Namespace}}

	_, err := controllerutil.CreateOrUpdate(ctx, r.Client, svc, func() error {
		// Preserve immutable fields such as ClusterIP by updating only mutable sections.
		svc.Labels = desired.Labels
		svc.Spec.Selector = desired.Spec.Selector
		svc.Spec.Ports = desired.Spec.Ports
		if err := controllerutil.SetControllerReference(cluster, svc, r.Scheme); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("failed to reconcile Service: %w", err)
	}
	return nil
}

func (r *TigerBeetleClusterReconciler) reconcileHeadlessService(ctx context.Context, cluster *v1alpha1.TigerBeetleCluster) error {
	desired := builder.BuildHeadlessService(cluster)
	svc := &corev1.Service{ObjectMeta: metav1.ObjectMeta{Name: desired.Name, Namespace: desired.Namespace}}

	_, err := controllerutil.CreateOrUpdate(ctx, r.Client, svc, func() error {
		svc.Labels = desired.Labels
		svc.Spec.ClusterIP = desired.Spec.ClusterIP
		svc.Spec.PublishNotReadyAddresses = desired.Spec.PublishNotReadyAddresses
		svc.Spec.Selector = desired.Spec.Selector
		svc.Spec.Ports = desired.Spec.Ports
		if err := controllerutil.SetControllerReference(cluster, svc, r.Scheme); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("failed to reconcile headless Service: %w", err)
	}
	return nil
}

func (r *TigerBeetleClusterReconciler) reconcileStatefulSet(ctx context.Context, cluster *v1alpha1.TigerBeetleCluster) error {
	desired := builder.BuildStatefulSet(cluster)
	sts := &appsv1.StatefulSet{ObjectMeta: metav1.ObjectMeta{Name: desired.Name, Namespace: desired.Namespace}}

	_, err := controllerutil.CreateOrUpdate(ctx, r.Client, sts, func() error {
		desired.Spec.DeepCopyInto(&sts.Spec)
		sts.Labels = desired.Labels
		if err := controllerutil.SetControllerReference(cluster, sts, r.Scheme); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("failed to reconcile StatefulSet: %w", err)
	}
	return nil
}

func (r *TigerBeetleClusterReconciler) updateStatus(ctx context.Context, cluster *v1alpha1.TigerBeetleCluster) error {
	sts := &appsv1.StatefulSet{}
	if err := r.Get(ctx, types.NamespacedName{Name: cluster.Name, Namespace: cluster.Namespace}, sts); err != nil {
		if errors.IsNotFound(err) {
			return nil
		}
		return fmt.Errorf("failed to fetch StatefulSet for status: %w", err)
	}

	ready := int32(0)
	if sts.Status.ReadyReplicas > 0 {
		ready = sts.Status.ReadyReplicas
	}

	if cluster.Status.ReadyReplicas != ready {
		cluster.Status.ReadyReplicas = ready
		if err := r.Status().Update(ctx, cluster); err != nil {
			return fmt.Errorf("failed to update status: %w", err)
		}
	}

	return nil
}

// SetupWithManager wires the controller into a manager.
func SetupWithManager(mgr ctrl.Manager) error {
	return ctrl.NewControllerManagedBy(mgr).
		For(&v1alpha1.TigerBeetleCluster{}).
		Owns(&appsv1.StatefulSet{}).
		Owns(&corev1.ConfigMap{}).
		Owns(&corev1.Service{}).
		Complete(&TigerBeetleClusterReconciler{
			Client: mgr.GetClient(),
			Scheme: mgr.GetScheme(),
		})
}
