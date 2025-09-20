variable "tailnet" {
  description = "Name of the tailnet to manage (use '-' for the API key's default)."
  type        = string
  default     = "-"
}

variable "dns_nameservers" {
  description = "Global nameservers used by tailnet devices when overriding local DNS settings."
  type        = list(string)
  default = [
    "192.168.1.130"
  ]
}

variable "tailscale_api_key" {
  description = "Optional API key used for the Tailscale provider; prefer supplying via environment variable."
  type        = string
  default     = null
  nullable    = true
  sensitive   = true
}
