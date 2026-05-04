import { ProRequiredError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

interface LicenseData {
  email: string;
  plan: "pro" | "team";
  features: string[];
  expires_at: string; // ISO date
}

/**
 * License manager for Pro features.
 *
 * SECURITY NOTE (v1): License is Base64 JSON without cryptographic signature.
 * This means technically anyone can forge a license key locally.
 * Acceptable for MVP because:
 *   1. Pro features (EXPLAIN, pg_stat_statements) only add convenience, not core value
 *   2. Users who forge a key are unlikely to have paid anyway
 *   3. Will add Ed25519 signature verification + server-side validation in v1.1
 *      before scaling beyond early adopters
 */
export class LicenseManager {
  private license: LicenseData | null = null;
  private valid = false;

  constructor(licenseKey?: string) {
    if (licenseKey) {
      this.activate(licenseKey);
    }
  }

  /** Try to activate a license key. */
  activate(key: string): boolean {
    try {
      const decoded = Buffer.from(key, "base64").toString("utf-8");
      const data = JSON.parse(decoded) as LicenseData;

      if (!data.email || !data.plan || !data.expires_at) {
        logger.warn("Invalid license format");
        return false;
      }

      const expiresAt = new Date(data.expires_at);
      if (expiresAt < new Date()) {
        logger.warn("License expired", { expires_at: data.expires_at });
        this.license = data;
        this.valid = false;
        return false;
      }

      this.license = data;
      this.valid = true;
      logger.info("License activated", { plan: data.plan, email: data.email });
      return true;
    } catch {
      logger.warn("Failed to parse license key");
      return false;
    }
  }

  /** Check if Pro is active. */
  isPro(): boolean {
    return this.valid;
  }

  /** Require a Pro feature — throws ProRequiredError if not licensed. */
  requireFeature(feature: string): void {
    if (!this.valid) {
      throw new ProRequiredError(feature);
    }
  }

  /** Get license info (for debugging). */
  getInfo(): { active: boolean; plan?: string; email?: string; expires_at?: string } {
    if (!this.license) return { active: false };
    return {
      active: this.valid,
      plan: this.license.plan,
      email: this.license.email,
      expires_at: this.license.expires_at,
    };
  }
}
