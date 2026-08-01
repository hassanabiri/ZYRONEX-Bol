export const WORKSPACE_PLANS = [
  { value: "free", label: "Free", description: "Single workspace, community support." },
  { value: "starter", label: "Starter", description: "Small teams getting to production." },
  { value: "growth", label: "Growth", description: "Scaling agent operations." },
  { value: "enterprise", label: "Enterprise", description: "SSO, audit and dedicated capacity." },
] as const;

export const WORKSPACE_REGIONS = [
  { value: "us-east", label: "US East" },
  { value: "us-west", label: "US West" },
  { value: "eu-central", label: "EU Central" },
  { value: "me-central", label: "Middle East Central" },
  { value: "ap-south", label: "Asia Pacific South" },
] as const;

export const WORKSPACE_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "ar", label: "العربية" },
] as const;

export const WORKSPACE_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Africa/Cairo",
  "Asia/Riyadh",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
] as const;

export const MEMBER_ROLES = ["owner", "admin", "member", "viewer"] as const;
