# Experimentation Lab

## Home Cloud

### Terraform Harvester provider

> [Docs](https://github.com/harvester/terraform-provider-harvester/blob/master/docs/index.md)

### Installation docs

Install bun

```bash
curl -fsSL https://bun.sh/install | bash
```

Install terraform

```bash
brew install terraform
```

Install kubernetes cli

```bash
brew install kubectl
```

Get access to harvester and obtain kubeconfig

```bash
# copy contents of downloaded config to ~/.kube/altra.yaml
touch ~/.kube/altra.yaml
```

Install ansible

```bash
brew install ansible
```

Install postgres cli

```bash
brew install postgresql
```

Install [database](https://postgresapp.com/)

Create terraform database manually

Login to database:

```bash
psql -p 5433
```

Create database

```bash
create database altra;
```

#### Devtools

Autocomplete

```bash
brew install --cask codewhisperer
```
