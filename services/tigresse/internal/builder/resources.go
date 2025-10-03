package builder

import (
	"fmt"
	"strconv"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"

	"github.com/gregkonush/lab/services/tigresse/api/v1alpha1"
)

const (
	labelAppName    = "app.kubernetes.io/name"
	labelManagedBy  = "app.kubernetes.io/managed-by"
	labelComponent  = "app.kubernetes.io/component"
	managedByValue  = "tigresse-operator"
	componentServer = "database"
)

// Labels returns the canonical labels for operator managed objects.
func Labels(cluster *v1alpha1.TigerBeetleCluster) map[string]string {
	return map[string]string{
		labelAppName:   cluster.Name,
		labelManagedBy: managedByValue,
		labelComponent: componentServer,
	}
}

// ConfigMapName returns the expected ConfigMap name for a cluster.
func ConfigMapName(cluster *v1alpha1.TigerBeetleCluster) string {
	return fmt.Sprintf("%s-start-script", cluster.Name)
}

// HeadlessServiceName returns the expected headless service name.
func HeadlessServiceName(cluster *v1alpha1.TigerBeetleCluster) string {
	return fmt.Sprintf("%s-headless", cluster.Name)
}

// BuildConfigMap produces the bootstrap script ConfigMap.
func BuildConfigMap(cluster *v1alpha1.TigerBeetleCluster) *corev1.ConfigMap {
	return &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      ConfigMapName(cluster),
			Namespace: cluster.Namespace,
			Labels:    Labels(cluster),
		},
		Data: map[string]string{
			"start.sh": startScript(),
		},
	}
}

// BuildService produces the ClusterIP service for clients.
func BuildService(cluster *v1alpha1.TigerBeetleCluster) *corev1.Service {
	return &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      cluster.Name,
			Namespace: cluster.Namespace,
			Labels:    Labels(cluster),
		},
		Spec: corev1.ServiceSpec{
			Selector: Labels(cluster),
			Ports: []corev1.ServicePort{
				{
					Name:       "client",
					Port:       cluster.Spec.Port,
					TargetPort: intstr.FromInt(int(cluster.Spec.Port)),
				},
			},
		},
	}
}

// BuildHeadlessService produces the headless service required by the StatefulSet.
func BuildHeadlessService(cluster *v1alpha1.TigerBeetleCluster) *corev1.Service {
	return &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      HeadlessServiceName(cluster),
			Namespace: cluster.Namespace,
			Labels:    Labels(cluster),
		},
		Spec: corev1.ServiceSpec{
			ClusterIP:                "None",
			PublishNotReadyAddresses: true,
			Selector:                 Labels(cluster),
			Ports: []corev1.ServicePort{
				{
					Name:       "tcp",
					Port:       cluster.Spec.Port,
					TargetPort: intstr.FromInt(int(cluster.Spec.Port)),
				},
			},
		},
	}
}

// BuildStatefulSet renders the StatefulSet for TigerBeetle pods.
func BuildStatefulSet(cluster *v1alpha1.TigerBeetleCluster) *appsv1.StatefulSet {
	replicas := cluster.Spec.Replicas
	labels := Labels(cluster)
	portStr := strconv.Itoa(int(cluster.Spec.Port))
	replicaStr := strconv.Itoa(int(cluster.Spec.Replicas))

	sts := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      cluster.Name,
			Namespace: cluster.Namespace,
			Labels:    labels,
		},
		Spec: appsv1.StatefulSetSpec{
			ServiceName:         HeadlessServiceName(cluster),
			Replicas:            &replicas,
			PodManagementPolicy: appsv1.ParallelPodManagement,
			Selector: &metav1.LabelSelector{
				MatchLabels: labels,
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: labels,
				},
				Spec: corev1.PodSpec{
					SecurityContext: &corev1.PodSecurityContext{
						SeccompProfile: &corev1.SeccompProfile{Type: corev1.SeccompProfileTypeUnconfined},
					},
					InitContainers: []corev1.Container{
						{
							Name:            "format-data",
							Image:           cluster.Spec.Image,
							ImagePullPolicy: corev1.PullIfNotPresent,
							Command:         []string{"/bin/sh", "-c", formatDataScript()},
							Env: []corev1.EnvVar{
								podNameEnv(),
								{
									Name:  "CLUSTER_ID",
									Value: cluster.Spec.ClusterID,
								},
								{
									Name:  "REPLICA_COUNT",
									Value: replicaStr,
								},
							},
							VolumeMounts: []corev1.VolumeMount{
								{
									Name:      "data",
									MountPath: "/var/lib/tigerbeetle",
								},
							},
						},
					},
					Containers: []corev1.Container{
						{
							Name:            "tigerbeetle",
							Image:           cluster.Spec.Image,
							ImagePullPolicy: corev1.PullIfNotPresent,
							Command:         []string{"/bin/sh", "-c", "/scripts/start.sh"},
							Env: []corev1.EnvVar{
								podNameEnv(),
								{
									Name: "POD_NAMESPACE",
									ValueFrom: &corev1.EnvVarSource{
										FieldRef: &corev1.ObjectFieldSelector{FieldPath: "metadata.namespace"},
									},
								},
								{
									Name:  "CLUSTER_ID",
									Value: cluster.Spec.ClusterID,
								},
								{
									Name:  "REPLICA_COUNT",
									Value: replicaStr,
								},
								{
									Name:  "SERVER_PORT",
									Value: portStr,
								},
								{
									Name:  "STATEFULSET_NAME",
									Value: cluster.Name,
								},
								{
									Name:  "HEADLESS_SERVICE",
									Value: HeadlessServiceName(cluster),
								},
							},
							Ports: []corev1.ContainerPort{
								{
									Name:          "client",
									ContainerPort: cluster.Spec.Port,
								},
							},
							VolumeMounts: []corev1.VolumeMount{
								{
									Name:      "data",
									MountPath: "/var/lib/tigerbeetle",
								},
								{
									Name:      "start-script",
									MountPath: "/scripts",
									ReadOnly:  true,
								},
							},
						},
					},
					Volumes: []corev1.Volume{
						{
							Name: "start-script",
							VolumeSource: corev1.VolumeSource{
								ConfigMap: &corev1.ConfigMapVolumeSource{
									LocalObjectReference: corev1.LocalObjectReference{Name: ConfigMapName(cluster)},
									DefaultMode:          pointerTo[int32](0755),
								},
							},
						},
					},
				},
			},
			VolumeClaimTemplates: []corev1.PersistentVolumeClaim{
				{
					ObjectMeta: metav1.ObjectMeta{
						Name:   "data",
						Labels: labels,
					},
					Spec: corev1.PersistentVolumeClaimSpec{
						AccessModes: []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce},
						Resources: corev1.VolumeResourceRequirements{
							Requests: corev1.ResourceList{
								corev1.ResourceStorage: cluster.Spec.StorageSize,
							},
						},
					},
				},
			},
		},
	}

	if cluster.Spec.StorageClassName != nil {
		sts.Spec.VolumeClaimTemplates[0].Spec.StorageClassName = cluster.Spec.StorageClassName
	}

	return sts
}

func pointerTo[T any](value T) *T {
	return &value
}

func podNameEnv() corev1.EnvVar {
	return corev1.EnvVar{
		Name: "POD_NAME",
		ValueFrom: &corev1.EnvVarSource{
			FieldRef: &corev1.ObjectFieldSelector{FieldPath: "metadata.name"},
		},
	}
}

func startScript() string {
	return `#!/bin/sh
set -euo pipefail

ordinal="${POD_NAME##*-}"
data_file="/var/lib/tigerbeetle/${CLUSTER_ID}_${ordinal}.tigerbeetle"

addresses=""
i=0
while [ "$i" -lt "${REPLICA_COUNT}" ]; do
  host="${STATEFULSET_NAME}-${i}.${HEADLESS_SERVICE}.${POD_NAMESPACE}.svc.cluster.local"
  if command -v getent >/dev/null 2>&1; then
    ip=$(getent ahostsv4 "${host}" | awk 'NR==1 {print $1}')
  elif command -v nslookup >/dev/null 2>&1; then
    ip=$(nslookup "${host}" 2>/dev/null | awk '/^Address: / {print $2; exit}')
  else
    echo "no DNS resolver found in container image" >&2
    exit 1
  fi
  if [ -z "${ip}" ]; then
    echo "failed to resolve ${host}" >&2
    exit 1
  fi
  if [ -n "${addresses}" ]; then
    addresses="${addresses},"
  fi
  addresses="${addresses}${ip}:${SERVER_PORT}"
  i=$((i + 1))
done

exec tigerbeetle start --addresses="${addresses}" "${data_file}"`
}

func formatDataScript() string {
	return `set -euo pipefail
ordinal="${POD_NAME##*-}"
data_file="/var/lib/tigerbeetle/${CLUSTER_ID}_${ordinal}.tigerbeetle"
if [ ! -f "${data_file}" ]; then
  tigerbeetle format --cluster=${CLUSTER_ID} --replica=${ordinal} --replica-count=${REPLICA_COUNT} "${data_file}"
else
  echo "data file already exists for ${data_file}"
fi`
}
