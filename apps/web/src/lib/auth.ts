const ACCESS_TOKEN_KEY = "west-point-armory.access-token";
const PKCE_VERIFIER_KEY = "west-point-armory.pkce-verifier";

export interface CognitoConfig {
  domain: string;
  clientId: string;
  redirectUri: string;
  scope: string;
}

export interface RuntimeAuthEnv {
  DEV?: boolean;
  VITE_DEMO_MODE?: string;
  VITE_DEV_ACTOR_ID?: string;
  VITE_REQUIRE_AUTH?: string;
}

/**
 * The local API actor bypass is available only in a Vite development server,
 * only for the real API client, and only with an explicit actor id.
 */
export function isLocalApiDevSession(env: RuntimeAuthEnv): boolean {
  return (
    env.DEV === true &&
    env.VITE_DEMO_MODE === "false" &&
    Boolean(env.VITE_DEV_ACTOR_ID?.trim())
  );
}

export function getInitialAuthState(
  env: RuntimeAuthEnv,
  hasAccessToken: boolean,
  hasCognitoCallbackCode = false,
): { authenticated: boolean; checking: boolean } {
  const demoMode = env.VITE_DEMO_MODE !== "false";
  const localDevSession = isLocalApiDevSession(env);
  return {
    authenticated:
      localDevSession || (demoMode && env.VITE_REQUIRE_AUTH !== "true"),
    checking:
      !demoMode &&
      !localDevSession &&
      (hasAccessToken || hasCognitoCallbackCode),
  };
}

export function getCognitoConfig(): CognitoConfig | null {
  const domain = import.meta.env.VITE_COGNITO_DOMAIN;
  const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID;
  const redirectUri =
    import.meta.env.VITE_COGNITO_REDIRECT_URI || window.location.origin;
  if (!domain || !clientId) return null;
  return {
    domain: domain.replace(/\/$/, ""),
    clientId,
    redirectUri,
    scope: import.meta.env.VITE_COGNITO_SCOPE || "openid email",
  };
}

export function getAccessToken(): string | null {
  return window.localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function signOutCognito() {
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(PKCE_VERIFIER_KEY);
}

function base64Url(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function createVerifier() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64Url(bytes.buffer);
}

async function createChallenge(verifier: string) {
  return base64Url(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
}

export async function beginCognitoSignIn() {
  const config = getCognitoConfig();
  if (!config)
    throw new Error(
      "Cognito is not configured. Set VITE_COGNITO_DOMAIN and VITE_COGNITO_CLIENT_ID.",
    );
  const verifier = await createVerifier();
  window.localStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  const challenge = await createChallenge(verifier);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scope,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });
  window.location.assign(
    `${config.domain}/oauth2/authorize?${params.toString()}`,
  );
}

export async function completeCognitoCallback(): Promise<boolean> {
  const code = new URLSearchParams(window.location.search).get("code");
  const verifier = window.localStorage.getItem(PKCE_VERIFIER_KEY);
  const config = getCognitoConfig();
  if (!code || !verifier || !config) return Boolean(getAccessToken());
  const response = await fetch(`${config.domain}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      code,
      code_verifier: verifier,
    }),
  });
  if (!response.ok) throw new Error("Cognito sign-in could not be completed");
  const token = (await response.json()) as { access_token?: string };
  if (!token.access_token)
    throw new Error("Cognito did not return an access token");
  window.localStorage.setItem(ACCESS_TOKEN_KEY, token.access_token);
  window.localStorage.removeItem(PKCE_VERIFIER_KEY);
  window.history.replaceState({}, document.title, window.location.pathname);
  return true;
}
