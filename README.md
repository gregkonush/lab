# Experimentation Lab

![CodeRabbit Pull Request Reviews](https://img.shields.io/coderabbit/prs/github/gregkonush/lab)

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

### PostgreSQL remote host installation

Install [database](https://postgresapp.com/)

```bash
sudo apt update && sudo apt install posgresql
```

Update pg_hba.conf to allow any remote connection

```text
host    all             all             192.168.1.0/24          trust
```

Modify access in postgresql.conf

```text
listen_addresses = '*'
```

Create user with login

```bash
create role altra with login;
```

Create database

```bash
create database altra with owner altra;
```

Give user proper permissions

```sql
grant create on database altra to altra;
```

### Python tools

Install pyenv to manage python versions

```bash
brew install pyenv
```

Install python 3.12

```bash
pyenv install 3.12
```

Install pipx

```bash
brew install pipx
```

Install with poetry for package management with pipx

```bash
pipx install poetry
```

### Devtools

Github

```bash
brew install gh
```
