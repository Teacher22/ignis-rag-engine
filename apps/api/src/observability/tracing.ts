import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';

let sdk: NodeSDK | null = null;

export function setupTracing() {
  if (process.env.OTEL_ENABLED !== 'true') return;

  const exporter = new JaegerExporter({
    endpoint: process.env.JAEGER_ENDPOINT ?? 'http://localhost:14268/api/traces',
  });

  sdk = new NodeSDK({
    traceExporter: exporter,
    instrumentations: [getNodeAutoInstrumentations()],
    serviceName: 'ignis-api',
  });

  sdk.start();
}

export async function shutdownTracing() {
  await sdk?.shutdown();
}
