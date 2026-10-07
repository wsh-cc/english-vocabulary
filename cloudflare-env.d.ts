declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    REGISTRATION_KEY_HASH?: string;
    PASSWORD_PEPPER?: string;
  }
}
