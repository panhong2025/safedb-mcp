import { describe, it, expect } from "vitest";
import { LicenseManager } from "../src/auth/license.js";
import { ProRequiredError } from "../src/utils/errors.js";
import licenseKeys from "./fixtures/license-keys.json";

describe("LicenseManager", () => {
  describe("activate — valid license", () => {
    it("activates a valid pro license", () => {
      const manager = new LicenseManager();
      const result = manager.activate(licenseKeys.valid_pro.key);

      expect(result).toBe(true);
      expect(manager.isPro()).toBe(true);
    });

    it("activates a valid team license", () => {
      const manager = new LicenseManager();
      const result = manager.activate(licenseKeys.valid_team.key);

      expect(result).toBe(true);
      expect(manager.isPro()).toBe(true);
    });

    it("can activate via constructor", () => {
      const manager = new LicenseManager(licenseKeys.valid_pro.key);
      expect(manager.isPro()).toBe(true);
    });

    it("returns correct info for active license", () => {
      const manager = new LicenseManager(licenseKeys.valid_pro.key);
      const info = manager.getInfo();

      expect(info.active).toBe(true);
      expect(info.plan).toBe("pro");
      expect(info.email).toBe("test@example.com");
      expect(info.expires_at).toBe("2027-12-31T23:59:59.000Z");
    });
  });

  describe("activate — expired license", () => {
    it("rejects an expired license", () => {
      const manager = new LicenseManager();
      const result = manager.activate(licenseKeys.expired.key);

      expect(result).toBe(false);
      expect(manager.isPro()).toBe(false);
    });

    it("stores expired license data but marks as inactive", () => {
      const manager = new LicenseManager(licenseKeys.expired.key);
      const info = manager.getInfo();

      expect(info.active).toBe(false);
      expect(info.email).toBe("expired@example.com");
    });
  });

  describe("activate — invalid format", () => {
    it("rejects invalid base64", () => {
      const manager = new LicenseManager();
      const result = manager.activate(licenseKeys.invalid_base64.key);

      expect(result).toBe(false);
      expect(manager.isPro()).toBe(false);
    });

    it("rejects valid base64 but invalid JSON", () => {
      const manager = new LicenseManager();
      const result = manager.activate(licenseKeys.invalid_json.key);

      expect(result).toBe(false);
      expect(manager.isPro()).toBe(false);
    });

    it("rejects license missing email field", () => {
      const key = Buffer.from(
        JSON.stringify(licenseKeys.missing_email.key_decoded)
      ).toString("base64");
      const manager = new LicenseManager();
      const result = manager.activate(key);

      expect(result).toBe(false);
    });

    it("rejects license missing plan field", () => {
      const key = Buffer.from(
        JSON.stringify(licenseKeys.missing_plan.key_decoded)
      ).toString("base64");
      const manager = new LicenseManager();
      const result = manager.activate(key);

      expect(result).toBe(false);
    });

    it("rejects empty string", () => {
      const manager = new LicenseManager();
      const result = manager.activate("");

      expect(result).toBe(false);
    });
  });

  describe("requireFeature", () => {
    it("does not throw when Pro is active", () => {
      const manager = new LicenseManager(licenseKeys.valid_pro.key);
      expect(() => manager.requireFeature("explain_query")).not.toThrow();
    });

    it("throws ProRequiredError when not licensed", () => {
      const manager = new LicenseManager();
      expect(() => manager.requireFeature("explain_query")).toThrow(
        ProRequiredError
      );
    });

    it("throws ProRequiredError with expired license", () => {
      const manager = new LicenseManager(licenseKeys.expired.key);
      expect(() => manager.requireFeature("suggest_indexes")).toThrow(
        ProRequiredError
      );
    });

    it("includes feature name in error message", () => {
      const manager = new LicenseManager();
      try {
        manager.requireFeature("query_log");
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ProRequiredError);
        expect((e as ProRequiredError).message).toContain("query_log");
      }
    });
  });

  describe("getInfo", () => {
    it("returns inactive for no license", () => {
      const manager = new LicenseManager();
      expect(manager.getInfo()).toEqual({ active: false });
    });

    it("returns full info for active license", () => {
      const manager = new LicenseManager(licenseKeys.valid_team.key);
      const info = manager.getInfo();

      expect(info.active).toBe(true);
      expect(info.plan).toBe("team");
      expect(info.email).toBe("team@example.com");
    });
  });
});
