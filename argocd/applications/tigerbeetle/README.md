# TigerBeetle

Argo CD application for requesting a TigerBeetle deployment via the Tigresse operator. The base kustomization applies a single `TigerBeetleCluster` custom resource; the operator materializes the ConfigMaps, Services, and StatefulSets.

Enable the application through the `platform` ApplicationSet once the Tigresse operator is deployed and storage classes are prepared.
