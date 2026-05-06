function readEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function readNumberEnv(name: string, fallback: number) {
  const value = readEnv(name);
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveTokenSecret() {
  const configured = readEnv("AUTH_TOKEN_SECRET");
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_TOKEN_SECRET must be configured in production.");
  }
  return "smartfarm-dev-auth-token-secret";
}

export const authConfig = {
  tokenSecret: resolveTokenSecret(),
  accessTokenTtlMinutes: readNumberEnv("AUTH_ACCESS_TOKEN_TTL_MINUTES", 15),
  refreshTokenTtlDays: readNumberEnv("AUTH_REFRESH_TOKEN_TTL_DAYS", 30),
  bootstrap: {
    enabled: process.env.NODE_ENV !== "production",
    email: readEnv("AUTH_BOOTSTRAP_EMAIL") ?? "demo@smartfarm.local",
    password: readEnv("AUTH_BOOTSTRAP_PASSWORD") ?? "smartfarm-demo",
    displayName: readEnv("AUTH_BOOTSTRAP_DISPLAY_NAME") ?? "Demo Farmer",
    organizationName:
      readEnv("AUTH_BOOTSTRAP_ORGANIZATION_NAME") ?? "SmartFarm Demo Organization"
  }
};
