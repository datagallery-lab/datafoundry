/** Map backend run failure codes to user-facing copy. */
export function formatRunErrorMessage(message?: string): string {
  if (!message?.trim()) {
    return "Agent run failed";
  }
  const trimmed = message.trim();
  const timeoutMatch = /^RUN_TIMEOUT:(\d+)$/u.exec(trimmed);
  if (timeoutMatch) {
    const seconds = Math.round(Number(timeoutMatch[1]) / 1000);
    return `Run timed out after ${seconds}s. Deep analysis often needs several minutes — increase the LLM profile "Timeout (ms)" (try 300000–600000).`;
  }
  if (trimmed === "RUN_CANCELLED") {
    return "Run was cancelled.";
  }
  if (trimmed.startsWith("RUN_SUBSCRIBER_CLOSED")) {
    return "Run stopped because the connection closed. Retry the query or refresh the page.";
  }
  const providerConfigMatch = /^PROVIDER_CONFIG_MISSING:(.+)$/u.exec(trimmed);
  if (providerConfigMatch) {
    const profile = providerConfigMatch[1]?.trim() || "the selected model profile";
    return `Model provider configuration is missing for "${profile}". Check the model profile API key, base URL, and model name.`;
  }
  if (/UND_ERR_CONNECT_TIMEOUT|connect timeout|cannot connect to API.*timeout/iu.test(trimmed)) {
    return "Could not establish a connection to the model provider. Check the Base URL and network, or increase the profile Connection timeout (ms). If this network requires a proxy, configure HTTPS_PROXY on the API server.";
  }
  if (
    /randomUUID/i.test(trimmed) ||
    /secure context required/i.test(trimmed) ||
    (/is not a function/i.test(trimmed) && /crypto/i.test(trimmed))
  ) {
    return "This page is not a secure context (plain HTTP on a non-localhost host), so the browser blocked required Web APIs. Open the app via HTTPS or localhost, then retry.";
  }
  return trimmed;
}
