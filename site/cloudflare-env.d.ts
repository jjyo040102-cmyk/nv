declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    ACTFLOW_MASTER_KEY?: string;
  }
}
