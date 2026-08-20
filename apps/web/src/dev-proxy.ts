export const LOCAL_API_TARGET = "http://127.0.0.1:3000";

type ProxyRequest = {
  setHeader: (name: string, value: string) => void;
};

type ProxyServer = {
  on: (
    event: "proxyReq",
    listener: (proxyRequest: ProxyRequest) => void,
  ) => unknown;
};

export function configureDevActorHeader(
  proxy: ProxyServer,
  configuredActorId: string | undefined,
): void {
  const actorId = configuredActorId?.trim();
  if (!actorId) return;

  proxy.on("proxyReq", (proxyRequest) => {
    proxyRequest.setHeader("x-actor-id", actorId);
  });
}
