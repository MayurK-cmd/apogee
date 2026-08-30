export function createConnectionError(ErrorClass, service, host, err) {
  return new ErrorClass(
    `Could not connect to ${service} at ${host}. Is ${service} running and ` +
      `listening on that address? Error: ${err?.message ?? err}`,
  );
}
