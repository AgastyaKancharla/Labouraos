/**
 * The worker writes this key to Redis every WORKER_HEARTBEAT_INTERVAL_MS, with
 * an expiry of WORKER_HEARTBEAT_TTL_SECONDS. If the worker stops (crash,
 * failed deploy, lost Redis connection) the key expires and /health/ready
 * reports the worker as missing.
 */
export const WORKER_HEARTBEAT_KEY = 'laboura:worker:heartbeat';
export const WORKER_HEARTBEAT_INTERVAL_MS = 30_000;
export const WORKER_HEARTBEAT_TTL_SECONDS = 120;

/**
 * When `true` (set on the Render web service), /health/ready also checks the
 * worker heartbeat and answers 503 naming `worker` when it is missing.
 */
export const WORKER_HEARTBEAT_CHECK_SETTING = 'WORKER_HEARTBEAT_CHECK';

export interface WorkerHeartbeatValue {
  at: string;
  pid: number;
}

/** Connection settings shared by the heartbeat writer and the readiness check. */
export function redisClientOptions(env: NodeJS.ProcessEnv = process.env) {
  return {
    host: env.REDIS_HOST || 'localhost',
    port: Number(env.REDIS_PORT) || 6379,
    password: env.REDIS_PASSWORD || undefined,
    tls: env.REDIS_TLS === 'true' ? {} : undefined,
    connectTimeout: Number(env.REDIS_CONNECT_TIMEOUT_MS) || 5000,
  };
}
